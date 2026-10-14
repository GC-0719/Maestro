/**
 * Maestro core types — the shared vocabulary between the orchestrator,
 * the desktop UI, and any external "master" driving the fleet.
 */

export type AgentId = 'claude' | 'gemini' | 'codex';

export type AgentHealth = 'unknown' | 'ok' | 'auth-missing' | 'offline';
export type AgentState = 'idle' | 'working' | 'limited' | 'offline';

export interface AgentInfo {
  id: AgentId;
  displayName: string;
  cli: string;
  version?: string;
  models: string[];
  health: AgentHealth;
  state: AgentState;
  /** Human-friendly description of what the agent is doing right now. */
  currentTask?: string;
  /** When the agent last hit a usage limit (ms epoch), if known. */
  limitedAt?: number;
  /** Raw hint from the CLI about when quota may reset, if any. */
  limitHint?: string;
}

export type Role = 'researcher' | 'architect' | 'implementer' | 'reviewer' | 'commander';

export interface RoleAssignment {
  role: Role;
  agentId: AgentId;
  /** The brief handed to this agent for its role. */
  brief: string;
  status: 'queued' | 'running' | 'handed-over' | 'done' | 'failed';
  /** Which agent actually finished it (after handovers). */
  finishedBy?: AgentId;
  result?: string;
  sessionId?: string;
}

export type MissionStatus =
  | 'queued'
  | 'running'
  | 'awaiting-input'
  | 'done'
  | 'failed'
  | 'cancelled';

export interface Mission {
  id: string;
  title: string;
  objective: string;
  mode: 'auto' | 'solo' | 'team';
  status: MissionStatus;
  roles: RoleAssignment[];
  createdAt: number;
  updatedAt: number;
  /** Plain-language timeline for the UI feed. */
  timeline: TimelineEntry[];
}

export interface TimelineEntry {
  at: number;
  kind: 'info' | 'agent' | 'handover' | 'warning' | 'done' | 'error';
  /** Human-readable, non-technical summary. */
  text: string;
  /** Collapsible technical detail (raw log excerpt, command, etc.). */
  detail?: string;
  agentId?: AgentId;
}

export type AgentEvent =
  | { type: 'started'; agentId: AgentId; pid: number; sessionId?: string }
  | { type: 'text'; agentId: AgentId; text: string }
  | { type: 'tool'; agentId: AgentId; tool: string; summary: string }
  | { type: 'result'; agentId: AgentId; text: string; sessionId?: string }
  | { type: 'limit'; agentId: AgentId; kind: 'rate' | 'quota' | 'auth'; raw: string }
  | { type: 'error'; agentId: AgentId; message: string };

export interface RunOpts {
  prompt: string;
  model?: string;
  workdir: string;
  resumeSessionId?: string;
  maxTurns?: number;
  timeoutMs?: number;
  /** Extra CLI args appended verbatim (advanced use). */
  extraArgs?: string[];
}

export interface LimitSignal {
  limited: boolean;
  kind: 'rate' | 'quota' | 'auth';
  /** Human-friendly explanation, e.g. "Gemini's free quota is exhausted". */
  hint: string;
}

export interface MaestroSnapshot {
  agents: AgentInfo[];
  missions: Mission[];
  version: string;
}
