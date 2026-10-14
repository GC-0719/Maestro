/**
 * Maestro core verification — runs against mocked CLIs (test/mockbin),
 * so no logins or network are needed.
 *
 * Scenarios:
 *  1. Limit detection: gemini mock emits a quota error -> detected as limit.
 *  2. Handover: a team mission where the researcher (gemini) hits quota ->
 *     work hands over to the next healthy agent and the mission completes.
 *  3. Solo mission on claude completes directly.
 *  4. Unit checks: detectLimit, buildHandoffPrompt, chooseNextAgent.
 */
import { Maestro } from '../src/index.js';
import { detectLimit } from '../src/limits.js';
import { buildHandoffPrompt, chooseNextAgent } from '../src/handover.js';
import { AgentInfo } from '../src/types.js';

let failures = 0;
function check(name: string, cond: boolean, extra = '') {
  if (cond) {
    console.log(`  PASS  ${name}`);
  } else {
    failures++;
    console.log(`  FAIL  ${name} ${extra}`);
  }
}

async function waitFor(m: Maestro, id: string, timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const mission = m.getMission(id);
    if (mission && (mission.status === 'done' || mission.status === 'failed' || mission.status === 'cancelled')) {
      return mission;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`timed out waiting for mission ${id}`);
}

async function main() {
  console.log('\n[1] limit detection');
  const sig = detectLimit("Quota exceeded for quota metric 'xyz'", 'gemini');
  check('quota error detected', sig?.limited === true && sig?.kind === 'quota');
  check('rate limit detected', detectLimit('Rate limit reached, retry later', 'claude')?.kind === 'rate');
  check('auth detected', detectLimit('Error: not logged in. Run login first.', 'codex')?.kind === 'auth');
  check('clean text not flagged', detectLimit('All done, great success', 'claude') === null);

  console.log('\n[2] handover helpers');
  const prompt = buildHandoffPrompt({
    missionTitle: 'Demo',
    objective: 'Build a thing',
    role: 'researcher',
    brief: 'Research it',
    fromAgent: 'Gemini',
    reason: "Gemini's usage quota is exhausted",
    partialOutput: 'partial findings...',
  });
  check('handoff prompt mentions handover + partial output',
    prompt.includes('handed over') && prompt.includes('partial findings...'));
  const agents: AgentInfo[] = (['claude', 'gemini', 'codex'] as const).map((id) => ({
    id, displayName: id, cli: id, models: [], health: 'ok',
    state: id === 'gemini' ? 'limited' : 'idle',
  }));
  const next = chooseNextAgent(agents, 'gemini');
  check('skips limited agent', next?.id === 'claude');

  console.log('\n[3] orchestrator with mocked CLIs');
  const maestro = new Maestro(process.cwd());
  // Pretend all agents are healthy (mocks, not real logins).
  for (const id of ['claude', 'gemini', 'codex'] as const) {
    const snap = maestro.snapshot().agents.find((a) => a.id === id)!;
    void snap;
  }
  // Force health ok via refreshHealth override: mocks respond to --version? They don't
  // handle --version, so set health directly through a test seam.
  (maestro as any).agents.get('claude').info.health = 'ok';
  (maestro as any).agents.get('gemini').info.health = 'ok';
  (maestro as any).agents.get('codex').info.health = 'ok';

  const timeline: string[] = [];
  maestro.onEvent((entry) => timeline.push(`[${entry.kind}] ${entry.text}`));

  // Team mission: researcher defaults to gemini -> hits quota -> hands over.
  const team = maestro.submitMission({
    title: 'Mock team mission',
    objective: 'Research and summarize mock findings',
    mode: 'team',
  });
  const done = await waitFor(maestro, team.id);
  check('team mission completes despite quota hit', done.status === 'done', `got ${done.status}`);
  check('handover appears in timeline',
    timeline.some((t) => t.includes('picking up right where it left off')));
  check('gemini marked limited',
    maestro.snapshot().agents.find((a) => a.id === 'gemini')?.state === 'limited');
  const researcherRole = done.roles.find((r) => r.role === 'researcher')!;
  check('researcher role finished by another agent',
    researcherRole.status === 'handed-over' && researcherRole.finishedBy !== 'gemini',
    JSON.stringify({ status: researcherRole.status, by: researcherRole.finishedBy }));

  console.log('\n[4] solo mission');
  const solo = maestro.submitMission({
    title: 'Mock solo mission',
    objective: 'Do a quick mock task',
    mode: 'solo',
    preferredAgent: 'claude',
  });
  const soloDone = await waitFor(maestro, solo.id);
  check('solo mission completes', soloDone.status === 'done');
  check('solo result captured', (soloDone.roles[0].result ?? '').includes('MOCK-CLAUDE'));

  console.log('\n--- timeline sample ---');
  timeline.slice(0, 12).forEach((t) => console.log('  ' + t));

  console.log(failures === 0 ? '\nALL TESTS PASSED' : `\n${failures} TEST(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('TEST CRASH:', e);
  process.exit(1);
});
