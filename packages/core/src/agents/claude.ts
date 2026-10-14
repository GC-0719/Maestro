import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { CliAgent } from './base.js';
import { AgentEvent, AgentId, RunOpts } from '../types.js';

const execFileAsync = promisify(execFile);

/**
 * Claude Code adapter.
 * Headless:  claude -p --output-format stream-json [--model X] [--max-turns N] [--resume SID]
 * Prompt is fed on stdin. Auth: `claude` keeps its own login (claude login).
 */
export class ClaudeAgent extends CliAgent {
  readonly id: AgentId = 'claude';
  readonly displayName = 'Claude';
  readonly cli = 'claude';
  readonly models = ['sonnet', 'opus', 'haiku'];

  protected buildArgs(opts: RunOpts): string[] {
    const args = ['-p', '--output-format', 'stream-json'];
    if (opts.model) args.push('--model', opts.model);
    if (opts.maxTurns) args.push('--max-turns', String(opts.maxTurns));
    if (opts.resumeSessionId) args.push('--resume', opts.resumeSessionId);
    if (opts.extraArgs) args.push(...opts.extraArgs);
    return args;
  }

  protected parseJsonEvent(obj: any, emit: (e: AgentEvent) => void): void {
    if (obj?.type === 'assistant' && obj?.message?.content) {
      for (const block of obj.message.content) {
        if (block.type === 'text' && block.text) {
          emit({ type: 'text', agentId: this.id, text: block.text });
        } else if (block.type === 'tool_use') {
          emit({
            type: 'tool',
            agentId: this.id,
            tool: block.name ?? 'tool',
            summary: JSON.stringify(block.input ?? {}).slice(0, 200),
          });
        }
      }
    } else if (obj?.type === 'result') {
      emit({
        type: 'result',
        agentId: this.id,
        text: typeof obj.result === 'string' ? obj.result : JSON.stringify(obj.result ?? ''),
        sessionId: obj.session_id,
      });
    } else if (obj?.type === 'system' && obj?.subtype === 'init') {
      // session id announced; the 'started' event already covers lifecycle.
    }
  }

  async checkAuth(): Promise<'ok' | 'auth-missing' | 'offline'> {
    try {
      // `claude --version` never touches the network; auth state is checked
      // cheaply via a no-op doctor-style probe is overkill — instead we try
      // a trivial print run? That spends quota. Compromise: if the binary
      // exists we report ok; real auth failures surface as limit/auth events.
      await execFileAsync(this.cli, ['--version'], { timeout: 8000 });
      return 'ok';
    } catch {
      return 'offline';
    }
  }
}
