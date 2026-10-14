import { useCallback, useEffect, useRef, useState } from 'react';
import './app.css';
import { AgentCard } from './components/AgentCard';
import { MissionComposer } from './components/MissionComposer';
import { ActivityFeed } from './components/ActivityFeed';

interface Snapshot {
  agents: any[];
  missions: any[];
  version: string;
}

const DEMO_AGENTS = [
  { id: 'claude', displayName: 'Claude', state: 'idle', health: 'ok', currentTask: undefined },
  { id: 'gemini', displayName: 'Gemini', state: 'idle', health: 'ok', currentTask: undefined },
  { id: 'codex', displayName: 'Codex', state: 'idle', health: 'ok', currentTask: undefined },
];

export default function App() {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [activeMissionId, setActiveMissionId] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const pollRef = useRef<number | null>(null);

  const bridge = typeof window !== 'undefined' ? window.maestro : undefined;

  const refresh = useCallback(async () => {
    if (!bridge) return;
    try {
      const s = await bridge.snapshot();
      setSnap(s);
      setConnected(true);
      if (!activeMissionId && s.missions.length) {
        setActiveMissionId(s.missions[s.missions.length - 1].id);
      }
    } catch {
      setConnected(false);
    }
  }, [bridge, activeMissionId]);

  useEffect(() => {
    if (!bridge) {
      // Browser preview without Electron: show the shape of the UI.
      setSnap({ agents: DEMO_AGENTS, missions: [], version: '0.1.0' });
      return;
    }
    refresh();
    pollRef.current = window.setInterval(refresh, 2500);
    const off = bridge.onTimeline(() => refresh());
    return () => {
      if (pollRef.current) window.clearInterval(pollRef.current);
      off();
    };
  }, [bridge, refresh]);

  const submit = async (opts: { objective: string; mode: 'auto' | 'solo' | 'team' }) => {
    if (!bridge) return;
    const m = await bridge.submit(opts);
    setActiveMissionId(m.id);
    refresh();
  };

  const cancel = async () => {
    if (!bridge || !activeMissionId) return;
    await bridge.cancel(activeMissionId);
    refresh();
  };

  const recover = async (id: string) => {
    if (!bridge) return;
    await bridge.recover(id);
    refresh();
  };

  const active = snap?.missions.find((m) => m.id === activeMissionId) ?? null;
  const busy = snap?.missions.some((m) => m.status === 'running' || m.status === 'queued') ?? false;

  const progress = (m: any) => {
    if (!m.roles.length) return 0;
    const done = m.roles.filter((r: any) => r.status === 'done' || r.status === 'handed-over').length;
    return Math.round((done / m.roles.length) * 100);
  };

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">🎛️</div>
          <div>
            <h1>Maestro</h1>
            <p>Fleet command for AI agents</p>
          </div>
        </div>

        <h2>Agents</h2>
        {(snap?.agents ?? []).map((a) => (
          <AgentCard key={a.id} agent={a} onRecover={recover} />
        ))}

        <div className="sidebar-foot">
          {connected ? (
            <>
              Master API live at <code>127.0.0.1:4317</code>
              <br />
              Luna can drive the fleet from here.
            </>
          ) : (
            <>Preview mode — run the desktop app to connect your agents.</>
          )}
        </div>
      </aside>

      <main className="main">
        <MissionComposer onSubmit={submit} busy={busy} />

        {(snap?.missions.length ?? 0) > 0 && (
          <div className="missions">
            {snap!.missions.map((m) => (
              <button
                key={m.id}
                className={`mission-chip ${m.id === activeMissionId ? 'active' : ''}`}
                onClick={() => setActiveMissionId(m.id)}
              >
                <div className="t">{m.title}</div>
                <div className="s">
                  {m.status} · {m.roles.length} step{m.roles.length === 1 ? '' : 's'}
                </div>
                <div className="bar">
                  <i style={{ width: `${progress(m)}%` }} />
                </div>
              </button>
            ))}
            {active && (active.status === 'running' || active.status === 'queued') && (
              <button className="cancel-btn" onClick={cancel}>
                Cancel mission
              </button>
            )}
          </div>
        )}

        <div className="feed-wrap">
          <div className="feed-head">
            <h2>Activity</h2>
            {active && <span className="mission-title">{active.title}</span>}
          </div>
          <ActivityFeed entries={active?.timeline ?? []} />
        </div>
      </main>
    </div>
  );
}
