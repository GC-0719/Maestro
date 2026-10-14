import { useState } from 'react';

const KIND_ICON: Record<string, string> = {
  info: '💡',
  agent: '🤖',
  handover: '🔄',
  warning: '⚠️',
  done: '✅',
  error: '❌',
};

function timeOf(ts: number) {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function ActivityFeed({ entries }: { entries: any[] }) {
  const [open, setOpen] = useState<Set<number>>(new Set());

  if (!entries.length) {
    return (
      <div className="feed-empty">
        Nothing happening yet.<br />
        Describe a task above and your fleet will get to work.
      </div>
    );
  }

  const toggle = (at: number) => {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(at)) next.delete(at);
      else next.add(at);
      return next;
    });
  };

  return (
    <div className="feed">
      {[...entries].reverse().map((e) => (
        <div key={e.at + e.text} className={`entry ${e.kind}`}>
          <span className="entry-icon">{KIND_ICON[e.kind] ?? '•'}</span>
          <div className="entry-body">
            <div className="entry-text">{e.text}</div>
            <div className="entry-time">{timeOf(e.at)}</div>
            {e.detail && (
              <details open={open.has(e.at)} onToggle={() => toggle(e.at)}>
                <summary>Technical details</summary>
                <pre>{e.detail}</pre>
              </details>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
