/**
 * Full-stack smoke test: Maestro + HTTP master API, mocked CLIs.
 *  1. boots Maestro, forces agent health ok (mocks)
 *  2. starts master API on 4319
 *  3. POSTs a team mission, polls until done
 *  4. asserts handover happened via the API (not internals)
 */
import { Maestro, startMasterApi } from '../src/index.js';

const PORT = 4319;
const BASE = `http://127.0.0.1:${PORT}`;

async function main() {
  const maestro = new Maestro(process.cwd());
  for (const id of ['claude', 'gemini', 'codex'] as const) {
    (maestro as any).agents.get(id).info.health = 'ok';
  }
  const api = startMasterApi(maestro, PORT);
  await new Promise((r) => setTimeout(r, 300));

  const post = await fetch(`${BASE}/api/missions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: 'API smoke mission',
      objective: 'Verify the master API drives handovers',
      mode: 'team',
    }),
  });
  const created: any = await post.json();
  console.log('created mission:', created.id, '-> roles:', created.roles.map((r: any) => `${r.role}:${r.agentId}`).join(', '));

  let mission: any = null;
  for (let i = 0; i < 100; i++) {
    await new Promise((r) => setTimeout(r, 300));
    const res = await fetch(`${BASE}/api/missions/${created.id}`);
    mission = await res.json();
    if (mission.status === 'done' || mission.status === 'failed') break;
  }
  console.log('final status:', mission.status);

  const texts = mission.timeline.map((t: any) => t.text).join('\n');
  const checks: [string, boolean][] = [
    ['mission done', mission.status === 'done'],
    ['handover in timeline', texts.includes('picking up right where it left off')],
    ['plain language (no raw CLI dumps)', !texts.includes('stream-json')],
  ];
  let fail = 0;
  for (const [name, ok] of checks) {
    console.log(ok ? `  PASS  ${name}` : `  FAIL  ${name}`);
    if (!ok) fail++;
  }

  const agentsRes: any = await (await fetch(`${BASE}/api/agents`)).json();
  console.log('agent states:', agentsRes.map((a: any) => `${a.id}:${a.state}`).join(', '));

  api.close();
  console.log(fail === 0 ? 'API SMOKE PASSED' : 'API SMOKE FAILED');
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
