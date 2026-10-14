import { Maestro, startMasterApi, startMcpServer } from './index.js';

/** Launches Maestro as an MCP stdio server. */
const maestro = new Maestro(process.cwd());
// In production the desktop app calls refreshHealth(); here we keep it lazy.
startMasterApi(maestro, Number(process.env.MAESTRO_PORT ?? 4317));
startMcpServer(maestro);
console.error('[maestro] mcp server on stdio, api on :' + (process.env.MAESTRO_PORT ?? 4317));
