const STATE_LABEL: Record<string, string> = {
  idle: 'Ready',
  working: 'Working',
  limited: 'On a break',
  offline: 'Offline',
};

export function AgentCard({ agent, onRecover }: { agent: any; onRecover: (id: string) => void }) {
  const state: string = agent.state ?? 'idle';
  const health: string = agent.health ?? 'unknown';

  return (
    <div className="agent-card">
      <div className="agent-top">
        <span className={`status-dot ${state}`} />
        <span className="agent-name">{agent.displayName}</span>
        <span className="agent-state">{STATE_LABEL[state] ?? state}</span>
      </div>

      {agent.currentTask && <div className="agent-task">{agent.currentTask}</div>}

      <div className="agent-foot">
        {health === 'auth-missing' && <span className="pill bad">Login needed</span>}
        {health === 'offline' && <span className="pill bad">Not installed</span>}
        {state === 'limited' && (
          <span className="pill warn" title={agent.limitHint ?? ''}>
            Limit reached
          </span>
        )}
        {state === 'idle' && health === 'ok' && <span className="pill">Available</span>}
        {state === 'limited' && (
          <button className="link-btn" onClick={() => onRecover(agent.id)}>
            Mark recovered
          </button>
        )}
      </div>
    </div>
  );
}
