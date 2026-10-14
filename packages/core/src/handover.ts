import { AgentId, AgentInfo, RoleAssignment } from './types.js';

export interface HandoverContext {
  missionTitle: string;
  objective: string;
  role: RoleAssignment['role'];
  brief: string;
  fromAgent: string;
  reason: string;
  /** What the previous agent produced before stopping (may be partial). */
  partialOutput: string;
  sessionId?: string;
}

/**
 * Builds the prompt that continues a task on a fresh agent after the
 * previous one hit a limit or failed. The goal: the user should feel
 * like one continuous worker, not a restart.
 */
export function buildHandoffPrompt(ctx: HandoverContext): string {
  const partial = ctx.partialOutput.trim()
    ? `\n\nHere is everything the previous agent produced before stopping (it may be incomplete — treat it as a draft, not gospel):\n---\n${ctx.partialOutput.slice(0, 6000)}\n---`
    : `\n\nThe previous agent produced no usable output before stopping, so start fresh.`;

  return [
    `You are picking up a task that was handed over to you mid-flight.`,
    ``,
    `Mission: ${ctx.missionTitle}`,
    `Overall objective: ${ctx.objective}`,
    `Your role in this mission: ${ctx.role}`,
    `Your brief: ${ctx.brief}`,
    ``,
    `Handover note: the previous worker (${ctx.fromAgent}) had to stop because ${ctx.reason}.`,
    `Do NOT ask the user what to do — continue the work directly. If the draft below is useful, build on it; if it is wrong, redo it properly.`,
    partial,
    ``,
    `When you are done, summarize what you completed in a few short sentences.`,
  ].join('\n');
}

/**
 * Pick the next healthy agent, excluding the exhausted one.
 * Priority order is configurable; defaults to claude -> codex -> gemini.
 */
export function chooseNextAgent(
  agents: AgentInfo[],
  exclude: AgentId,
  priority: AgentId[] = ['claude', 'codex', 'gemini'],
): AgentInfo | null {
  const healthy = (a: AgentInfo) =>
    a.id !== exclude && a.health === 'ok' && a.state !== 'limited' && a.state !== 'offline';
  for (const id of priority) {
    const found = agents.find((a) => a.id === id && healthy(a));
    if (found) return found;
  }
  return agents.find(healthy) ?? null;
}

/** Human-friendly one-liner for the UI timeline when a handover happens. */
export function handoverSummary(from: string, to: string, reason: string): string {
  return `${from} had to stop (${reason}) — ${to} is picking up right where it left off.`;
}
