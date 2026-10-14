import { spawn, ChildProcess } from 'node:child_process';
import {
  AgentEvent,
  AgentId,
  LimitSignal,
  RunOpts,
} from '../types.js';
import { detectLimit } from '../limits.js';

/**
 * Base class for CLI-driven agents.
 *
 * Each agent is driven through its CLI's *headless* mode
 * (claude -p, gemini -p, codex exec) with JSON event streams,
 * so the orchestrator never has to scrape an interactive terminal.
 * Subclasses only declare how to build argv and how to normalize
 * one output line into AgentEvents.
 */
export abstract class CliAgent {
  abstract readonly id: AgentId;
  abstract readonly displayName: string;
  abstract readonly cli: string;
  abstract readonly models: string[];

  /** Build argv for a headless run (prompt passed via stdin where supported). */
  protected abstract buildArgs(opts: RunOpts): string[];

  /** Env overrides for the child process (e.g. PATH shims in tests). */
  protected extraEnv(): Record<string, string> {
    return {};
  }

  /**
   * Normalize one stdout line into zero or more events.
   * Default: try JSON, else treat as plain text.
   */
  protected parseStdoutLine(line: string, emit: (e: AgentEvent) => void): void {
    const trimmed = line.trim();
    if (!trimmed) return;
    if (trimmed.startsWith('{')) {
      try {
        const obj = JSON.parse(trimmed);
        this.parseJsonEvent(obj, emit);
        return;
      } catch {
        /* fall through to text */
      }
    }
    emit({ type: 'text', agentId: this.id, text: trimmed });
  }

  /** Normalize one stderr line — mostly used for limit detection. */
  protected parseStderrLine(line: string, emit: (e: AgentEvent) => void): void {
    const signal = this.checkLimit(line);
    if (signal) {
      emit({
        type: 'limit',
        agentId: this.id,
        kind: signal.kind,
        raw: line.trim().slice(0, 500),
      });
    }
  }

  protected parseJsonEvent(_obj: unknown, emit: (e: AgentEvent) => void): void {
    emit({ type: 'text', agentId: this.id, text: JSON.stringify(_obj).slice(0, 500) });
  }

  /** Check a chunk of text for usage-limit signals. Subclasses add their own. */
  checkLimit(text: string): LimitSignal | null {
    return detectLimit(text, this.id);
  }

  /** Best-effort auth check. Subclasses run a cheap, non-mutating command. */
  abstract checkAuth(): Promise<'ok' | 'auth-missing' | 'offline'>;

  /** Run a headless task, yielding normalized events. */
  async *run(opts: RunOpts): AsyncGenerator<AgentEvent> {
    const args = this.buildArgs(opts);
    let child: ChildProcess;
    try {
      child = spawn(this.cli, args, {
        cwd: opts.workdir,
        env: { ...process.env, ...this.extraEnv() },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (err) {
      yield {
        type: 'error',
        agentId: this.id,
        message: `Could not start ${this.cli}: ${(err as Error).message}`,
      };
      return;
    }

    yield { type: 'started', agentId: this.id, pid: child.pid ?? -1 };

    let stderrTail = '';
    let timedOut = false;

    const timer = opts.timeoutMs
      ? setTimeout(() => {
          timedOut = true;
          child.kill('SIGTERM');
        }, opts.timeoutMs)
      : undefined;

    // Feed the prompt on stdin (supported by all three CLIs) to avoid
    // shell-quoting hazards with long prompts.
    child.stdin?.write(opts.prompt);
    child.stdin?.end();

    const pump = (
      stream: NodeJS.ReadableStream,
      onLine: (line: string) => void,
    ) => {
      let buf = '';
      stream.on('data', (chunk: Buffer) => {
        buf += chunk.toString();
        let idx: number;
        while ((idx = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, idx);
          buf = buf.slice(idx + 1);
          onLine(line);
        }
      });
      stream.on('end', () => {
        if (buf.trim()) onLine(buf);
        buf = '';
      });
    };

    const events: AgentEvent[] = [];
    const emit = (e: AgentEvent) => events.push(e);

    child.stdout && pump(child.stdout, (l) => this.parseStdoutLine(l, emit));
    child.stderr &&
      pump(child.stderr, (l) => {
        stderrTail += l + '\n';
        this.parseStderrLine(l, emit);
      });

    const exitCode: number = await new Promise((resolve) => {
      child.on('close', (code) => resolve(code ?? 1));
      child.on('error', () => resolve(1));
    });
    if (timer) clearTimeout(timer);

    for (const e of events) yield e;

    if (timedOut) {
      yield {
        type: 'error',
        agentId: this.id,
        message: `Timed out after ${opts.timeoutMs}ms and was stopped.`,
      };
      return;
    }

    // Non-zero exit without a parsed result: surface stderr tail + limit check.
    const sawResult = events.some((e) => e.type === 'result' || e.type === 'limit');
    if (exitCode !== 0 && !sawResult) {
      const signal = this.checkLimit(stderrTail);
      if (signal) {
        yield { type: 'limit', agentId: this.id, kind: signal.kind, raw: stderrTail.slice(-500) };
      } else {
        yield {
          type: 'error',
          agentId: this.id,
          message: `${this.displayName} exited (code ${exitCode}). ${stderrTail.trim().slice(-300)}`,
        };
      }
    }
  }
}
