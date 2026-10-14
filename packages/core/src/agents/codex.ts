import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { CliAgent } from './base.js';
import { AgentEvent, AgentId, RunOpts } from '../types.js';

const execFileAsync = promisify(execFile);

/**
 * OpenAI Codex CLI adapter.
 * Headless:  codex exec --json [--model X] [prompt]   (prompt via stdin)
 * Resume:    codex exec resume <session-id> [--json]
 * Auth: `codex login` (supports ChatGPT Plus/Pro subscription login).
 */
export class CodexAgent extends CliAgent {
  readonly id: AgentId = 'codex';
  readonly displayName = 'Codex';
  readonly cli = 'codex';
  readonly models = ['gpt-5', 'gpt-5-mini'];

  protected buildArgs(opts: RunOpts): string[] {
    if (opts.resumeSessionId) {
      const args = ['exec', 'resume', opts.resumeSessionId, '--json'];
      if (opts.extraArgs) args.push(...opts.extraArgs);
      return args;
    }
    const args = ['exec', '--json'];
    if (opts.model) args.push('--model', opts.model);
    if (opts.extraArgs) args.push(...opts.extraArgs);
    return args;
  }

  protected parseJsonEvent(obj: any, emit: (e: AgentEvent) => void): void {
    const t = String(obj?.type ?? '');
    if (t === 'thread.started' && obj?.thread_id) {
      // lifecycle covered by 'started'
      return;
    }
    if (t === 'item.completed' || t === 'turn.completed') {
      const item = obj?.item ?? obj;
      const content = item?.content ?? item?.text ?? '';
      const text = Array.isArray(content)
        ? content.map((c: any) => c?.text ?? '').join('')
        : String(content);
      if (text.trim()) emit({ type: 'text', agentId: this.id, text: text.trim() });
      if (item?.type === 'function_call' || obj?.tool) {
        emit({
          type: 'tool',
          agentId: this.id,
          tool: String(item?.name ?? obj?.tool ?? 'tool'),
          summary: JSON.stringify(item?.arguments ?? '').slice(0, 200),
        });
      }
      return;
    }
    if (t === 'turn.failed' || t === 'error') {
      emit({
        type: 'error',
        agentId: this.id,
        message: String(obj?.error?.message ?? obj?.message ?? 'Codex reported an error'),
      });
      return;
    }
    // Final text payloads
    const msg = obj?.message ?? obj?.text ?? obj?.output;
    if (typeof msg === 'string' && msg.trim() && t.includes('final')) {
      emit({ type: 'result', agentId: this.id, text: msg.trim() });
    }
  }

  async checkAuth(): Promise<'ok' | 'auth-missing' | 'offline'> {
    try {
      // `codex doctor` reports auth state without spending quota.
      const { stdout } = await execFileAsync(this.cli, ['doctor'], { timeout: 15000 });
      if (/not logged in|login required|not authenticated/i.test(stdout)) return 'auth-missing';
      return 'ok';
    } catch {
      return 'offline';
    }
  }
}
