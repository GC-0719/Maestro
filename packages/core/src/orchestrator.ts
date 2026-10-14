import { randomUUID } from 'node:crypto';
import { CliAgent } from './agents/base.js';
import { ClaudeAgent } from './agents/claude.js';
import { GeminiAgent } from './agents/gemini.js';
import { CodexAgent } from './agents/codex.js';
import {
  AgentEvent,
  AgentId,
  AgentInfo,
  AgentState,
  Mission,
  MissionStatus,
  RoleAssignment,
  TimelineEntry,
} from './types.js';
import { buildHandoffPrompt, chooseNextAgent, handoverSummary } from './handover.js';
import { describeRole, planRoles } from './roles.js';

export interface SubmitMissionOpts {
  title: string;
  objective: string;
  mode?: 'auto' | 'solo' | 'team';
  preferredAgent?: AgentId;
  workdir?: string;
  priority?: AgentId[];
}

type Listener = (entry: TimelineEntry, mission: Mission) => void;

/**
 * Maestro — master orchestrator for the CLI agent fleet.
 *
 * Responsibilities:
 *  - keep a live registry of agents (health, state, quota)
 *  - run missions role-by-role across agents
 *  - detect usage limits mid-run and hand work over cleanly
 *  - let 2-4 agents collaborate on one mission with distinct roles
 *  - narrate everything in plain language for the UI timeline
 */
export class Maestro {
  private agents = new Map<AgentId, { adapter: CliAgent; info: AgentInfo }>();
  private missions = new Map<string, Mission>();
  private listeners = new Set<Listener>();
  readonly version = '0.1.0';

  constructor(workdir = process.cwd()) {
    this.workdir = workdir;
    this.register(new ClaudeAgent());
    this.register(new GeminiAgent());
    this.register(new CodexAgent());
  }

  private workdir: string;

  private register(adapter: CliAgent) {
    this.agents.set(adapter.id, {
      adapter,
      info: {
        id: adapter.id,
        displayName: adapter.displayName,
        cli: adapter.cli,
        models: adapter.models,
        health: 'unknown',
        state: 'idle',
      },
    });
  }

  onEvent(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  snapshot(): { agents: AgentInfo[]; missions: Mission[]; version: string } {
    return {
      agents: [...this.agents.values()].map((a) => ({ ...a.info })),
      missions: [...this.missions.values()].map((m) => ({ ...m })),
      version: this.version,
    };
  }

  getMission(id: string): Mission | undefined {
    return this.missions.get(id);
  }

  /** Probe every CLI for presence/auth. Cheap; safe to call on startup. */
  async refreshHealth(): Promise<void> {
    await Promise.all(
      [...this.agents.values()].map(async ({ adapter, info }) => {
        try {
          info.health = await adapter.checkAuth();
        } catch {
          info.health = 'offline';
        }
        if (info.health === 'offline' || info.health === 'auth-missing') {
          info.state = 'offline';
        } else if (info.state === 'offline') {
          info.state = 'idle';
        }
      }),
    );
  }

  submitMission(opts: SubmitMissionOpts): Mission {
    const available = [...this.agents.values()]
      .filter((a) => a.info.health === 'ok' && a.info.state !== 'limited')
      .map((a) => a.info.id);
    const pool: AgentId[] = available.length ? available : ['claude', 'gemini', 'codex'];

    const mode = opts.mode ?? 'auto';
    const effectiveMode = mode === 'auto' ? (pool.length > 1 ? 'team' : 'solo') : mode;

    const mission: Mission = {
      id: randomUUID().slice(0, 8),
      title: opts.title || this.titleFromObjective(opts.objective),
      objective: opts.objective,
      mode: effectiveMode,
      status: 'queued',
      roles: planRoles({
        objective: opts.objective,
        mode: effectiveMode,
        preferredAgent: opts.preferredAgent,
        available: pool,
      }),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      timeline: [],
    };
    mission.timeline.push({
      at: Date.now(),
      kind: 'info',
      text: `Mission queued: ${mission.title}. ${mission.roles.length} step${mission.roles.length > 1 ? 's' : ''} planned.`,
    });
    this.missions.set(mission.id, mission);

    // Run async — the caller gets the mission immediately and follows the timeline.
    void this.runMission(mission, opts.workdir ?? this.workdir, opts.priority);
    return mission;
  }

  cancelMission(id: string): boolean {
    const m = this.missions.get(id);
    if (!m || m.status === 'done' || m.status === 'failed') return false;
    m.status = 'cancelled';
    m.updatedAt = Date.now();
    this.pushTimeline(m, { kind: 'warning', text: 'Mission cancelled.' });
    return true;
  }

  // ------------------------------------------------------------------ run

  private async runMission(mission: Mission, workdir: string, priority?: AgentId[]) {
    mission.status = 'running';
    this.pushTimeline(mission, {
      kind: 'info',
      text: `Starting "${mission.title}".`,
    });

    for (const role of mission.roles) {
      if (this.isCancelled(mission)) return;
      await this.runRole(mission, role, workdir, priority);
      if (role.status === 'failed') {
        mission.status = 'failed';
        this.pushTimeline(mission, {
          kind: 'error',
          text: `Mission stalled at the "${role.role}" step — every available agent is exhausted or errored. It will resume cleanly once an agent is back.`,
        });
        return;
      }
    }

    mission.status = 'done';
    mission.updatedAt = Date.now();
    this.pushTimeline(mission, {
      kind: 'done',
      text: `Mission complete. ${mission.roles.length} step${mission.roles.length > 1 ? 's' : ''} finished.`,
    });
  }

  private isCancelled(mission: Mission): boolean {
    // Read through the map so external cancellation (via cancelMission)
    // is observed even though TS narrows the local property type.
    return this.missions.get(mission.id)?.status === 'cancelled';
  }

  private async runRole(
    mission: Mission,
    role: RoleAssignment,
    workdir: string,
    priority?: AgentId[],
  ) {
    role.status = 'running';
    let agentId = role.agentId;
    let prompt = this.rolePrompt(mission, role);
    let attempts = 0;

    while (attempts < 4) {
      attempts++;
      const entry = this.agents.get(agentId);
      if (!entry) {
        role.status = 'failed';
        return;
      }
      const { adapter, info } = entry;

      this.setAgentState(agentId, 'working', `${describeRole(role.role)} — ${mission.title}`);
      this.pushTimeline(mission, {
        kind: 'agent',
        agentId,
        text: `${info.displayName} is ${describeRole(role.role)}…`,
        detail: `$ ${adapter.cli} ${'(headless run)'}`,
      });

      const outcome = await this.execute(adapter, {
        prompt,
        workdir,
        model: undefined,
        maxTurns: 25,
        timeoutMs: 20 * 60 * 1000,
      });

      if (outcome.status === 'ok') {
        role.finishedBy = agentId;
        role.status = agentId !== role.agentId ? 'handed-over' : 'done';
        role.result = outcome.text;
        role.sessionId = outcome.sessionId;
        this.setAgentState(agentId, 'idle');
        this.pushTimeline(mission, {
          kind: 'agent',
          agentId,
          text: `${info.displayName} finished ${describeRole(role.role)}.`,
          detail: outcome.text.slice(0, 800),
        });
        return;
      }

      // Limit hit or error — hand over to the next healthy agent.
      const reason =
        outcome.status === 'limit'
          ? outcome.hint
          : `ran into a problem (${outcome.message})`;
      this.setAgentState(agentId, outcome.status === 'limit' ? 'limited' : 'idle');
      if (outcome.status === 'limit') {
        info.limitedAt = Date.now();
        info.limitHint = outcome.hint;
      }

      const next = chooseNextAgent(
        [...this.agents.values()].map((a) => a.info),
        agentId,
        priority,
      );
      if (!next) {
        role.status = 'failed';
        this.setAgentState(agentId, 'idle');
        return;
      }

      prompt = buildHandoffPrompt({
        missionTitle: mission.title,
        objective: mission.objective,
        role: role.role,
        brief: role.brief,
        fromAgent: info.displayName,
        reason,
        partialOutput: outcome.partialText,
        sessionId: outcome.sessionId,
      });
      this.pushTimeline(mission, {
        kind: 'handover',
        agentId: next.id,
        text: handoverSummary(info.displayName, next.displayName, reason),
      });
      agentId = next.id;
    }

    role.status = 'failed';
  }

  private rolePrompt(mission: Mission, role: RoleAssignment): string {
    const previous = mission.roles
      .filter((r) => r.result && r !== role)
      .map((r) => `### ${r.role} (${r.finishedBy ?? r.agentId}):\n${r.result!.slice(0, 3000)}`)
      .join('\n\n');
    return [
      role.brief,
      previous ? `\n\nWork already completed by teammates:\n${previous}` : '',
      `\n\nReply at the end with a short summary of what you did.`,
    ].join('\n');
  }

  private async execute(
    adapter: CliAgent,
    opts: { prompt: string; workdir: string; model?: string; maxTurns?: number; timeoutMs?: number },
  ): Promise<
    | { status: 'ok'; text: string; sessionId?: string }
    | { status: 'limit'; hint: string; partialText: string; sessionId?: string }
    | { status: 'error'; message: string; partialText: string; sessionId?: string }
  > {
    let text = '';
    let sessionId: string | undefined;
    try {
      for await (const ev of adapter.run(opts)) {
        text = this.foldEvent(ev, text);
        if (ev.type === 'started' && ev.sessionId) sessionId = ev.sessionId;
        if (ev.type === 'result' && ev.sessionId) sessionId = ev.sessionId;
        if (ev.type === 'limit') {
          return { status: 'limit', hint: this.hintFor(ev), partialText: text, sessionId };
        }
        if (ev.type === 'error') {
          return { status: 'error', message: ev.message, partialText: text, sessionId };
        }
      }
      return { status: 'ok', text: text.trim(), sessionId };
    } catch (err) {
      return {
        status: 'error',
        message: (err as Error).message,
        partialText: text,
        sessionId,
      };
    }
  }

  private foldEvent(ev: AgentEvent, text: string): string {
    if (ev.type === 'text' || ev.type === 'result') return text + ev.text + '\n';
    return text;
  }

  private hintFor(ev: Extract<AgentEvent, { type: 'limit' }>): string {
    const name = this.agents.get(ev.agentId)?.info.displayName ?? ev.agentId;
    if (ev.kind === 'quota') return `${name}'s usage quota is exhausted`;
    if (ev.kind === 'auth') return `${name} needs a fresh login`;
    return `${name} hit a rate limit`;
  }

  // ------------------------------------------------------------------ misc

  private setAgentState(id: AgentId, state: AgentState, currentTask?: string) {
    const info = this.agents.get(id)?.info;
    if (!info) return;
    info.state = state;
    info.currentTask = currentTask;
    if (state === 'idle') {
      info.currentTask = undefined;
      // A recovered agent clears its limited flag when it starts fresh work.
    }
  }

  /** Mark an agent's quota as recovered (called on successful run or manually). */
  recoverAgent(id: AgentId) {
    const info = this.agents.get(id)?.info;
    if (!info) return;
    if (info.state === 'limited') info.state = 'idle';
    info.limitedAt = undefined;
    info.limitHint = undefined;
  }

  private pushTimeline(mission: Mission, entry: Omit<TimelineEntry, 'at'>) {
    const full: TimelineEntry = { at: Date.now(), ...entry };
    mission.timeline.push(full);
    mission.updatedAt = Date.now();
    for (const fn of this.listeners) {
      try {
        fn(full, mission);
      } catch {
        /* listener errors must never break orchestration */
      }
    }
  }

  private titleFromObjective(objective: string): string {
    const first = objective.split(/[.\n]/)[0].trim();
    return first.length > 60 ? first.slice(0, 57) + '…' : first || 'Untitled mission';
  }
}
