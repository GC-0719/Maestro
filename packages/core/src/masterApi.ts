import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { Maestro } from './orchestrator.js';

/**
 * Local HTTP API — the "remote control" for Maestro.
 *
 * This is how Luna (or any external master) drives the fleet:
 *   GET  /api/agents            -> agent registry snapshot
 *   GET  /api/missions          -> all missions
 *   POST /api/missions          -> { title, objective, mode, preferredAgent }
 *   GET  /api/missions/:id      -> one mission with timeline
 *   POST /api/missions/:id/cancel
 *   POST /api/agents/:id/recover -> clear a "limited" flag
 *   GET  /api/events            -> Server-Sent Events stream of timeline entries
 *
 * Binds to 127.0.0.1 only by default. Never expose this port to the open
 * internet — it can spend your agents' quotas.
 */
export function startMasterApi(maestro: Maestro, port = 4317) {
  const sseClients = new Set<ServerResponse>();
  const off = maestro.onEvent((entry, mission) => {
    const payload = `data: ${JSON.stringify({ missionId: mission.id, entry })}\n\n`;
    for (const res of sseClients) {
      try {
        res.write(payload);
      } catch {
        sseClients.delete(res);
      }
    }
  });

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') {
      res.writeHead(204).end();
      return;
    }

    const json = (code: number, body: unknown) => {
      res.writeHead(code, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    const readBody = () =>
      new Promise<any>((resolve) => {
        let buf = '';
        req.on('data', (c) => (buf += c));
        req.on('end', () => {
          try {
            resolve(buf ? JSON.parse(buf) : {});
          } catch {
            resolve({});
          }
        });
      });

    try {
      if (url.pathname === '/api/agents' && req.method === 'GET') {
        return json(200, maestro.snapshot().agents);
      }
      if (url.pathname === '/api/missions' && req.method === 'GET') {
        return json(200, maestro.snapshot().missions);
      }
      if (url.pathname === '/api/missions' && req.method === 'POST') {
        const body = await readBody();
        if (!body.objective) return json(400, { error: 'objective is required' });
        const mission = maestro.submitMission({
          title: body.title,
          objective: body.objective,
          mode: body.mode,
          preferredAgent: body.preferredAgent,
          workdir: body.workdir,
        });
        return json(201, mission);
      }
      const missionMatch = url.pathname.match(/^\/api\/missions\/([\w-]+)(\/cancel)?$/);
      if (missionMatch && req.method === 'GET' && !missionMatch[2]) {
        const m = maestro.getMission(missionMatch[1]);
        return m ? json(200, m) : json(404, { error: 'not found' });
      }
      if (missionMatch && missionMatch[2] && req.method === 'POST') {
        const ok = maestro.cancelMission(missionMatch[1]);
        return json(200, { cancelled: ok });
      }
      const recoverMatch = url.pathname.match(/^\/api\/agents\/(\w+)\/recover$/);
      if (recoverMatch && req.method === 'POST') {
        maestro.recoverAgent(recoverMatch[1] as any);
        return json(200, { recovered: true });
      }
      if (url.pathname === '/api/events' && req.method === 'GET') {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        });
        res.write(': connected\n\n');
        sseClients.add(res);
        req.on('close', () => sseClients.delete(res));
        return;
      }
      return json(404, { error: 'not found' });
    } catch (err) {
      return json(500, { error: (err as Error).message });
    }
  });

  server.listen(port, '127.0.0.1', () => {
    // stderr, not stdout: this module also runs inside the MCP stdio server,
    // where stdout is reserved for JSON-RPC.
    console.error(`[maestro] master API listening on http://127.0.0.1:${port}`);
  });

  return {
    close() {
      off();
      server.close();
    },
  };
}
