import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { CliAgent } from './base.js';
import { AgentEvent, AgentId, RunOpts } from '../types.js';

const execFileAsync = promisify(execFile);

/**
 * Gemini CLI adapter.
 * Headless:  gemini -p --output-format stream-json [--model X] [--resume SID] [-y]
 * Prompt is fed on stdin. Auth: Google login inside the Gemini CLI.
 *
 * Note: Gemini's stream-json envelope has changed across versions, so the
 * parser below is defensive — it extracts any text it can find and falls
 * back to treating unknown objects as opaque text.
 */
export class GeminiAgent extends CliAgent {
  readonly id: AgentId = 'gemini';
  readonly displayName = 'Gemini';
  readonly cli = 'gemini';
  readonly models = ['gemini-2.5-pro', 'gemini-2.5-flash'];

  protected buildArgs(opts: RunOpts): string[] {
    const args = ['-p', '--output-format', 'stream-json', '-y'];
    if (opts.model) args.push('--model', opts.model);
    if (opts.resumeSessionId) args.push('--resume', opts.resumeSessionId);
    if (opts.extraArgs) args.push(...opts.extraArgs);
    return args;
  }

  protected parseJsonEvent(obj: any, emit: (e: AgentEvent) => void): void {
    const texts: string[] = [];
    const walk = (node: any, depth: number) => {
      if (!node || depth > 4) return;
      if (typeof node === 'string') return;
      if (Array.isArray(node)) return node.forEach((n) => walk(n, depth + 1));
      if (typeof node === 'object') {
        for (const [k, v] of Object.entries(node)) {
          if ((k === 'text' || k === 'content') && typeof v === 'string' && v.trim()) {
            texts.push(v);
          } else if (k === 'functionCall' || k === 'function_call') {
            emit({
              type: 'tool',
              agentId: this.id,
              tool: String((v as any)?.name ?? 'tool'),
              summary: JSON.stringify((v as any)?.args ?? {}).slice(0, 200),
            });
          } else walk(v, depth + 1);
        }
      }
    };
    walk(obj, 0);
    const kind = String(obj?.type ?? obj?.kind ?? '').toLowerCase();
    if (kind.includes('result') || obj?.isFinal || obj?.final) {
      emit({ type: 'result', agentId: this.id, text: texts.join('\n') });
    } else if (texts.length) {
      for (const t of texts) emit({ type: 'text', agentId: this.id, text: t });
    }
  }

  async checkAuth(): Promise<'ok' | 'auth-missing' | 'offline'> {
    try {
      await execFileAsync(this.cli, ['--version'], { timeout: 8000 });
      return 'ok';
    } catch {
      return 'offline';
    }
  }
}
