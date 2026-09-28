import { SeverityBadge } from './badges';
import { api } from '../lib/api';

export interface Alert {
  id: string;
  severity: string;
  state: string;
  message: string;
  asset_name: string;
  started_at: number;
}

export default function AlertsPanel({ alerts, onChange }: { alerts: Alert[]; onChange: () => void }) {
  async function ack(id: string) {
    try {
      await api(`/alerts/${id}/ack`, { method: 'POST' });
      onChange();
    } catch {
      /* ignore */
    }
  }

  if (!alerts.length)
    return (
      <div className="allclear">
        <span className="check" aria-hidden>✓</span> All clear — no active alerts
      </div>
    );

  return (
    <ul className="alerts">
      {alerts.map((a) => (
        <li key={a.id} className={`alert ${a.severity}`}>
          <SeverityBadge severity={a.severity} />
          <div className="alert-body">
            <div className="alert-msg">{a.message}</div>
            <div className="muted small">
              {new Date(a.started_at).toLocaleString()}
              {a.state === 'acknowledged' ? ' · acknowledged' : ''}
            </div>
          </div>
          {a.state === 'firing' && (
            <button className="ghost small" onClick={() => ack(a.id)}>Ack</button>
          )}
        </li>
      ))}
    </ul>
  );
}
