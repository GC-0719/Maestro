import { AgentId, Role, RoleAssignment } from './types.js';

/**
 * RolePlanner — turns a mission objective into role assignments.
 *
 * Two strategies:
 *  - solo: one agent does everything (fastest, cheapest).
 *  - team: the mission is split into researcher -> architect ->
 *    implementer -> reviewer, each a different agent where possible.
 *
 * The default agent->role mapping plays to observed strengths, but every
 * assignment is overridable per mission — the user (or the master) decides.
 */
export const DEFAULT_ROLE_AGENT: Record<Role, AgentId> = {
  researcher: 'gemini', // huge context, fast, great at digging up docs
  architect: 'claude', // careful planning, strong reasoning
  implementer: 'codex', // built for code execution
  reviewer: 'claude', // thorough critique
  commander: 'claude', // master-orchestrator decisions
};

const ROLE_BRIEF_PROMPT: Record<Role, string> = {
  researcher: 'Research the topic thoroughly and return concise, sourced findings. No code yet.',
  architect: 'Turn the research into a concrete step-by-step implementation plan. No code yet.',
  implementer: 'Implement the plan. Write real, working code and verify it runs.',
  reviewer: 'Review the implementation critically. List issues found and fix the important ones.',
  commander: 'Coordinate the mission: break it into steps and judge which agent fits each step best.',
};

export interface PlanOpts {
  objective: string;
  mode: 'auto' | 'solo' | 'team';
  preferredAgent?: AgentId;
  available: AgentId[];
  overrides?: Partial<Record<Role, AgentId>>;
}

export function planRoles(opts: PlanOpts): RoleAssignment[] {
  const pick = (role: Role): AgentId => {
    const override = opts.overrides?.[role];
    if (override && opts.available.includes(override)) return override;
    const def = opts.mode === 'solo' && opts.preferredAgent
      ? opts.preferredAgent
      : DEFAULT_ROLE_AGENT[role];
    if (opts.available.includes(def)) return def;
    return opts.available[0];
  };

  if (opts.mode === 'solo') {
    const agentId = pick('implementer');
    return [
      {
        role: 'implementer',
        agentId,
        brief: `Do this end to end: ${opts.objective}`,
        status: 'queued',
      },
    ];
  }

  // team mode: research and architecture can run in parallel in v1 we run
  // them in dependency order for correctness; the orchestrator may
  // parallelize independent roles later.
  const chain: Role[] = ['researcher', 'architect', 'implementer', 'reviewer'];
  return chain.map((role) => ({
    role,
    agentId: pick(role),
    brief: `${ROLE_BRIEF_PROMPT[role]}\n\nMission objective: ${opts.objective}`,
    status: 'queued' as const,
  }));
}

/** Plain-language description of a role for the UI. */
export function describeRole(role: Role): string {
  switch (role) {
    case 'researcher': return 'digging up the facts';
    case 'architect': return 'drawing up the plan';
    case 'implementer': return 'building it';
    case 'reviewer': return 'double-checking the work';
    case 'commander': return 'running the mission';
  }
}
