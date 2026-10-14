import { AgentId, LimitSignal } from './types.js';

interface Pattern {
  re: RegExp;
  kind: LimitSignal['kind'];
  hint: (agent: string) => string;
}

const DISPLAY: Record<AgentId, string> = {
  claude: 'Claude',
  gemini: 'Gemini',
  codex: 'Codex',
};

/**
 * Usage-limit fingerprints. Each CLI reports exhaustion differently;
 * we match generously and let the orchestrator treat "limited" as
 * "park this agent, hand its work to someone else".
 */
const PATTERNS: Pattern[] = [
  {
    re: /rate.?limit|too many requests|\b429\b/i,
    kind: 'rate',
    hint: (a) => `${a} hit a rate limit — it needs a breather before more work.`,
  },
  {
    re: /usage limit|quota|resource.?exhausted|daily limit|weekly limit/i,
    kind: 'quota',
    hint: (a) => `${a}'s usage quota is exhausted for now.`,
  },
  {
    re: /plan limit|subscription limit|credits? (exhausted|depleted)|out of credits/i,
    kind: 'quota',
    hint: (a) => `${a} is out of plan credits.`,
  },
  {
    re: /not (logged|authenticated)|login required|invalid api key|unauthorized|authentication/i,
    kind: 'auth',
    hint: (a) => `${a} needs you to log in again.`,
  },
  // CLI-specific fingerprints
  {
    re: /you've reached your limit/i,
    kind: 'quota',
    hint: (a) => `${a} reached its session limit.`,
  },
  {
    re: /quota exceeded for quota metric/i,
    kind: 'quota',
    hint: (a) => `${a}'s API quota is exceeded.`,
  },
];

export function detectLimit(text: string, agentId: AgentId): LimitSignal | null {
  for (const p of PATTERNS) {
    if (p.re.test(text)) {
      return { limited: true, kind: p.kind, hint: p.hint(DISPLAY[agentId]) };
    }
  }
  return null;
}
