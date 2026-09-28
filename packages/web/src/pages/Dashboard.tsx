import { useEffect, useState, useCallback } from 'react';
import { api } from '../lib/api';
import SummaryTiles from '../components/SummaryTiles';
import AlertsPanel, { type Alert } from '../components/AlertsPanel';
import AssetTable, { type Asset } from '../components/AssetTable';
import AssetDetail from '../components/AssetDetail';
import AskFirst from '../components/AskFirst';

export default function Dashboard({ onAsk }: { onAsk: (q: string) => void }) {
  const [summary, setSummary] = useState<any>(null);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [selected, setSelected] = useState<string>();

  const load = useCallback(async () => {
    try {
      const [s, a, al] = await Promise.all([api('/summary'), api('/assets'), api('/alerts?state=open')]);
      setSummary(s);
      setAssets(a);
      setAlerts(al);
      // Default to the agent's own host (continuous series), else any host with
      // usage metrics, else the first asset — so the live chart draws on load.
      setSelected(
        (prev) =>
          prev ??
          a.find((x: any) => x.labels?.role === 'self')?.id ??
          a.find((x: any) => x.metrics?.['cpu.usage'] != null)?.id ??
          a[0]?.id,
      );
    } catch {
      /* transient poll error */
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 5000);
    return () => clearInterval(id);
  }, [load]);

  const selectedAsset = assets.find((a) => a.id === selected) ?? null;

  return (
    <div className="dash">
      <AskFirst summary={summary} onAsk={onAsk} />

      <SummaryTiles s={summary} />

      {summary?.ticketingAttached && (
        <div className="ap-strip">
          <div className="ap-title">
            <span className="ap-live" aria-hidden /> Autopilot · <b>{apModeLabel(summary.autopilotMode)}</b>
          </div>
          <div className="ap-stats">
            <span><b>{summary.tickets?.open ?? 0}</b> open</span>
            <span className="ok"><b>{summary.tickets?.resolved ?? 0}</b> auto-resolved</span>
            <span className="crit"><b>{summary.tickets?.escalated ?? 0}</b> escalated</span>
          </div>
          <div className="muted small ap-hint">Open <b>Tickets</b> for the full queue and per-ticket timelines.</div>
        </div>
      )}

      <section className="panel">
        <h2>Active alerts</h2>
        <AlertsPanel alerts={alerts} onChange={load} />
      </section>

      <div className="cols">
        <section className="panel grow">
          <h2>
            Infrastructure <span className="muted small">({assets.length})</span>
          </h2>
          <AssetTable assets={assets} selected={selected} onSelect={setSelected} />
        </section>
        <section className="panel side">
          <h2>Live metrics</h2>
          <AssetDetail asset={selectedAsset} />
        </section>
      </div>
    </div>
  );
}

function apModeLabel(mode?: string): string {
  const m: Record<string, string> = { auto_safe: 'auto-fix safe', approve: 'approve to act', diagnose: 'diagnose only', paused: 'paused' };
  return m[mode ?? 'auto_safe'] ?? String(mode);
}
