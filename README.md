# Maestro 🎛️

Mission control for your fleet of AI coding agents — Claude, Gemini and Codex —
behind one calm, clean UI. No terminal dumps. You describe the mission in plain
words; Maestro picks the right agents, runs the work, and hands over cleanly
when someone hits a limit.

## How it works

- **Agents, not terminals.** Each AI CLI (Claude Code, Gemini CLI, Codex CLI)
  is driven through its headless mode with structured JSON events. You never
  see raw CLI output unless you open "Technical details".
- **Master orchestrator.** Missions are split into roles —
  researcher → architect → implementer → reviewer — and dealt out to the fleet.
  Solo mode sends everything to one agent; Auto lets Maestro decide.
- **Limit-aware handovers.** When an agent hits a rate limit or quota, Maestro
  parks it, summarizes what it had done, and hands the work to the next healthy
  agent with full context. The timeline narrates it in plain language:
  *"Gemini had to stop — Claude is picking up right where it left off."*
- **Luna can drive.** A local master API (`http://127.0.0.1:4317`) and an MCP
  stdio server expose the whole fleet: submit missions, watch timelines, steer.

## Prerequisites

Install the three CLIs (already done on the build VM):

```bash
npm install -g @anthropic-ai/claude-code @google/gemini-cli @openai/codex
```

Then log each one in with **your Pro subscriptions** (one-time, on the machine
that will run Maestro):

| Agent  | Login command | Notes |
|--------|---------------|-------|
| Claude | `claude login` | Uses your Claude Pro/Max subscription |
| Gemini | `gemini` then `/auth` | Sign in with Google (your Gemini Pro) |
| Codex  | `codex login` | Sign in with ChatGPT Plus/Pro |

Maestro never sees your credentials — each CLI keeps its own login.

## Run it

```bash
cd ~/workspace/maestro
npm install
npm run build

# Desktop app
npm run start --workspace=maestro-desktop

# …or just the headless fleet (API + MCP server), no UI:
node packages/core/dist/maestro-mcp.js
```

Master API examples:

```bash
# Submit a mission
curl -X POST 127.0.0.1:4317/api/missions \
  -H 'Content-Type: application/json' \
  -d '{"objective":"Research vector DB options and summarize the tradeoffs","mode":"team"}'

# Watch it live
curl 127.0.0.1:4317/api/events   # Server-Sent Events

# Fleet status
curl 127.0.0.1:4317/api/agents
```

Add the MCP server to any MCP client (Claude Code, Codex, …):

```json
{ "mcpServers": { "maestro": { "command": "node", "args": ["/path/to/maestro/packages/core/dist/maestro-mcp.js"] } } }
```

## Project layout

```
maestro/
  packages/core/        # Orchestrator: agents, limits, handover, roles, API, MCP
    src/agents/         # claude.ts, gemini.ts, codex.ts (headless CLI drivers)
    src/orchestrator.ts # the master brain
    src/handover.ts     # clean limit handovers
    src/masterApi.ts    # local HTTP API + SSE (port 4317)
    src/mcpServer.ts    # MCP stdio server (Luna / any MCP client drives)
    test/               # mocked-CLI verification suite
  apps/desktop/         # Electron + React mission-control UI
```

## Verified so far

- `npm run test --workspace=@maestro/core` — 13 checks pass against mocked
  CLIs: limit detection (rate/quota/auth), handover prompt building, and a full
  team mission where Gemini hits quota mid-research and Claude picks it up.
- `npx tsx test/api-smoke.ts` — same scenario driven purely through the HTTP
  API, the way the desktop UI does it.

## Roadmap

- [ ] Real-login shakedown: run one mission per agent with your logins
- [ ] Parallel roles (research + architecture concurrently)
- [ ] Quota forecasting: learn each agent's reset rhythm, schedule around it
- [ ] Mission templates + saved fleets
- [ ] Packaged installers (electron-builder) for macOS/Windows/Linux
- [ ] Voice of the master: let Luna's routing policy improve from outcomes
