import { useState } from 'react';

export function MissionComposer({
  onSubmit,
  busy,
}: {
  onSubmit: (opts: { title?: string; objective: string; mode: 'auto' | 'solo' | 'team' }) => void;
  busy: boolean;
}) {
  const [text, setText] = useState('');
  const [mode, setMode] = useState<'auto' | 'solo' | 'team'>('auto');

  const submit = () => {
    const objective = text.trim();
    if (!objective || busy) return;
    onSubmit({ objective, mode });
    setText('');
  };

  return (
    <div className="composer">
      <label>What should the team do?</label>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="e.g. Research the best way to add dark mode to my React app, then implement it and double-check the result."
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit();
        }}
      />
      <div className="composer-row">
        <div className="seg" role="tablist" aria-label="Mission mode">
          {(['auto', 'solo', 'team'] as const).map((m) => (
            <button
              key={m}
              className={mode === m ? 'active' : ''}
              onClick={() => setMode(m)}
              title={
                m === 'auto'
                  ? 'Maestro decides: one agent or the whole team'
                  : m === 'solo'
                    ? 'One agent does everything'
                    : 'Researcher, architect, builder and reviewer collaborate'
              }
            >
              {m === 'auto' ? '✨ Auto' : m === 'solo' ? '🧍 Solo' : '👥 Team'}
            </button>
          ))}
        </div>
        <button className="primary-btn" onClick={submit} disabled={!text.trim() || busy}>
          {busy ? 'Working…' : 'Start mission'}
        </button>
      </div>
    </div>
  );
}
