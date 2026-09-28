import { useEffect, useState } from 'react';
import { api } from '../lib/api';

interface Agent { id: string; name: string; os?: string; version?: string; last_seen?: number }

export default function AgentSetup() {
  const [data, setData] = useState<{ tenant: { enrollToken: string }; agents: Agent[] } | null>(null);

  useEffect(() => {
    const load = () => api('/tenant').then(setData).catch(() => {});
    load();
    const id = setInterval(load, 5000);
    return () => clearInterval(id);
  }, []);

  const token = data?.tenant?.enrollToken ?? '…';
  const cmd = `SERVER_URL=http://localhost:4000 ENROLL_TOKEN=${token} npm run start:agent`;

  return (
    <div className="setup">
      <h2>Add an agent</h2>
      <p className="muted">
        Run one command on any host. The agent auto-discovers that host and scans its local subnet, then streams
        everything back here — no per-device setup.
      </p>

      <div className="field">
        <label>Your enrollment token</label>
        <code className="token">{token}</code>
      </div>
      <div className="field">
        <label>Start a local agent (from the repo root)</label>
        <pre className="cmd">{cmd}</pre>
      </div>
      <p className="muted small">
        For the MVP the agent runs from this repo; in production it ships as a prebuilt binary you install with one
        line. Keep this token secret — anyone with it can enroll an agent into your account.
      </p>

      <h3>Connected agents</h3>
      <table className="assets">
        <thead>
          <tr><th>Name</th><th>OS</th><th>Version</th><th>Last seen</th></tr>
        </thead>
        <tbody>
          {(data?.agents ?? []).map((a) => (
            <tr key={a.id}>
              <td>{a.name}</td>
              <td className="muted small">{a.os ?? '—'}</td>
              <td className="muted small">{a.version ?? '—'}</td>
              <td className="muted small">{a.last_seen ? new Date(a.last_seen).toLocaleTimeString() : '—'}</td>
            </tr>
          ))}
          {!data?.agents?.length && (
            <tr><td colSpan={4} className="muted">No agents yet.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
