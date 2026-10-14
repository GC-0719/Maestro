import { createInterface } from 'node:readline';
import { Maestro } from './orchestrator.js';

/**
 * Minimal MCP-compatible stdio server (JSON-RPC 2.0).
 *
 * Lets any MCP client — Claude Code, Codex, or Luna herself — drive the
 * fleet with tools:
 *   maestro.submit_mission  { title?, objective, mode?, preferredAgent? }
 *   maestro.mission_status  { id }
 *   maestro.list_agents     {}
 *   maestro.cancel_mission  { id }
 *
 * Run:  node dist/mcpServer.js   (stdio transport)
 */
export function startMcpServer(maestro: Maestro) {
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: false });

  const tools = [
    {
      name: 'maestro.submit_mission',
      description:
        'Submit a mission to the agent fleet. The master orchestrator plans roles, picks agents, and handles limit handovers automatically.',
      inputSchema: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          objective: { type: 'string', description: 'What the fleet should accomplish, in plain language.' },
          mode: { type: 'string', enum: ['auto', 'solo', 'team'] },
          preferredAgent: { type: 'string', enum: ['claude', 'gemini', 'codex'] },
        },
        required: ['objective'],
      },
    },
    {
      name: 'maestro.mission_status',
      description: 'Get a mission with its plain-language timeline.',
      inputSchema: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      },
    },
    {
      name: 'maestro.list_agents',
      description: 'List fleet agents with health, state, and quota status.',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'maestro.cancel_mission',
      description: 'Cancel a running mission.',
      inputSchema: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      },
    },
  ];

  const send = (obj: unknown) => process.stdout.write(JSON.stringify(obj) + '\n');

  const callTool = (name: string, args: any) => {
    switch (name) {
      case 'maestro.submit_mission': {
        const m = maestro.submitMission({
          title: args.title,
          objective: args.objective,
          mode: args.mode,
          preferredAgent: args.preferredAgent,
        });
        return { missionId: m.id, title: m.title, status: m.status, roles: m.roles.map((r) => ({ role: r.role, agent: r.agentId })) };
      }
      case 'maestro.mission_status': {
        const m = maestro.getMission(args.id);
        if (!m) throw new Error(`mission ${args.id} not found`);
        return m;
      }
      case 'maestro.list_agents':
        return maestro.snapshot().agents;
      case 'maestro.cancel_mission':
        return { cancelled: maestro.cancelMission(args.id) };
      default:
        throw new Error(`unknown tool ${name}`);
    }
  };

  rl.on('line', (line) => {
    let msg: any;
    try {
      msg = JSON.parse(line);
    } catch {
      return;
    }
    const respond = (result: unknown) =>
      send({ jsonrpc: '2.0', id: msg.id ?? null, result });
    const fail = (message: string) =>
      send({ jsonrpc: '2.0', id: msg.id ?? null, error: { code: -32000, message } });

    try {
      if (msg.method === 'initialize') {
        return respond({
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: 'maestro', version: maestro.version },
        });
      }
      if (msg.method === 'notifications/initialized') return;
      if (msg.method === 'tools/list') return respond({ tools });
      if (msg.method === 'tools/call') {
        const out = callTool(msg.params?.name, msg.params?.arguments ?? {});
        return respond({ content: [{ type: 'text', text: JSON.stringify(out, null, 2) }] });
      }
      if (msg.method === 'ping') return respond({});
      return fail(`unknown method ${msg.method}`);
    } catch (err) {
      return fail((err as Error).message);
    }
  });
}
