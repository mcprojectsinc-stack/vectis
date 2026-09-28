import { StatusBadge } from './badges';

export interface Asset {
  id: string;
  type: string;
  name: string;
  address: string | null;
  labels: Record<string, unknown>;
  status: string;
  lastSeen: number;
  metrics: Record<string, number>;
}

function UsageCell({ v }: { v?: number }) {
  if (v == null) return <span className="muted">—</span>;
  const tone = v >= 90 ? 'crit' : v >= 75 ? 'warn' : 'ok';
  return <span className={`usage ${tone}`}>{v}%</span>;
}

function ago(ts: number): string {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.round(m / 60)}h ago`;
}

export default function AssetTable({
  assets,
  selected,
  onSelect,
}: {
  assets: Asset[];
  selected?: string;
  onSelect: (id: string) => void;
}) {
  if (!assets.length)
    return <div className="empty muted">No assets yet. Start an agent to auto-discover your infrastructure.</div>;

  return (
    <div className="table-scroll">
      <table className="assets">
        <thead>
          <tr>
            <th>Asset</th>
            <th>Type</th>
            <th>Status</th>
            <th>CPU</th>
            <th>Mem</th>
            <th>Disk</th>
            <th>Role</th>
            <th>Last seen</th>
          </tr>
        </thead>
        <tbody>
          {assets.map((a) => (
            <tr key={a.id} className={selected === a.id ? 'sel' : ''} onClick={() => onSelect(a.id)}>
              <td>
                <div className="aname">{a.name}</div>
                <div className="muted small">{a.address}</div>
              </td>
              <td className="cap">{a.type}</td>
              <td><StatusBadge status={a.status} /></td>
              <td><UsageCell v={a.metrics['cpu.usage']} /></td>
              <td><UsageCell v={a.metrics['mem.usage']} /></td>
              <td><UsageCell v={a.metrics['disk.usage']} /></td>
              <td className="muted small">{String(a.labels?.role ?? '—')}</td>
              <td className="muted small">{ago(a.lastSeen)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
