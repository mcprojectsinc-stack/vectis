import { useEffect, useState, useCallback } from 'react';
import { api } from '../lib/api';
import { TicketSeverityBadge, TicketStatusBadge, AutopilotBadge } from '../components/badges';

interface AIAnalysis { rootCause: string; steps: string[]; recommendation: string; confidence: string }
interface Ticket {
  id: string; key: string; title: string; description?: string; severity: string; priority?: number;
  category?: string; status: string; assignee?: string; assetHint?: string; autopilotState: string;
  slaDue?: number | null; createdAt: number; resolvedAt?: number | null; aiAnalysis?: AIAnalysis | null;
}
interface TimelineEvent { id: string; ts: number; kind: string; actor: string; message: string; data?: { resolution?: string } | null }
interface TicketDetail extends Ticket { timeline: TimelineEvent[] }

const MODES = [
  { v: 'auto_safe', label: 'Auto-fix safe' },
  { v: 'approve', label: 'Approve to act' },
  { v: 'diagnose', label: 'Diagnose only' },
  { v: 'paused', label: 'Paused' },
];

function sla(due?: number | null): string {
  if (!due) return '—';
  const m = Math.round((due - Date.now()) / 60000);
  if (m < 0) return `breached ${-m}m`;
  if (m < 60) return `${m}m`;
  return `${Math.round(m / 60)}h`;
}

export default function Tickets() {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [selected, setSelected] = useState<string>();
  const [detail, setDetail] = useState<TicketDetail | null>(null);
  const [mode, setMode] = useState('auto_safe');
  const [attached, setAttached] = useState<boolean | null>(null);
  const [demoMsg, setDemoMsg] = useState('');

  const loadList = useCallback(async () => {
    try {
      const t: Ticket[] = await api('/tickets');
      setTickets(t);
      setSelected((prev) => prev ?? t[0]?.id);
    } catch {
      /* transient */
    }
  }, []);

  useEffect(() => {
    api('/autopilot').then((r) => setMode(r.mode)).catch(() => {});
    api('/integrations').then((r: { kind: string }[]) => setAttached(r.some((i) => i.kind === 'ticketing'))).catch(() => setAttached(false));
  }, []);

  useEffect(() => {
    loadList();
    const id = setInterval(loadList, 4000);
    return () => clearInterval(id);
  }, [loadList]);

  useEffect(() => {
    if (!selected) { setDetail(null); return; }
    const load = () => api(`/tickets/${selected}`).then(setDetail).catch(() => {});
    load();
    const id = setInterval(load, 4000);
    return () => clearInterval(id);
  }, [selected]);

  async function changeMode(m: string) {
    setMode(m);
    try { await api('/autopilot', { method: 'POST', body: JSON.stringify({ mode: m }) }); } catch { /* */ }
  }
  async function runNow(id: string) {
    try { await api(`/tickets/${id}/run`, { method: 'POST' }); loadList(); api(`/tickets/${id}`).then(setDetail).catch(() => {}); } catch { /* */ }
  }
  async function approve(id: string) {
    try { await api(`/tickets/${id}/approve`, { method: 'POST' }); loadList(); api(`/tickets/${id}`).then(setDetail).catch(() => {}); } catch { /* */ }
  }
  async function selfHeal() {
    setDemoMsg('Staging a real incident on the agent host…');
    try {
      const r = await api('/demo/self-heal', { method: 'POST' });
      setDemoMsg(`Created a real self-heal ticket on ${r.host}. Open it and click Approve to run the fix on the host.`);
      await loadList();
      setSelected(r.ticketId);
    } catch (e) {
      setDemoMsg((e as Error).message);
    }
  }

  if (attached === false && !tickets.length)
    return (
      <div className="empty-card">
        <h3>No tickets yet</h3>
        <p className="muted">Attach a ticketing system in <b>Integrations</b> for sample ITSM tickets, or run a real, approval-gated self-heal on the agent's own host:</p>
        <button className="primary sm" onClick={selfHeal}>Create self-heal demo</button>
        {demoMsg && <p className="demo-msg" style={{ marginTop: 14 }}>{demoMsg}</p>}
      </div>
    );

  return (
    <div className="tickets-page">
      <div className="tickets-toolbar">
        <div className="muted small">Triage queue — sorted by severity, then precedence, then age.</div>
        <div className="tt-actions">
          <button className="ghost sm" onClick={selfHeal}>Create self-heal demo</button>
          <label className="mode-select">
            Autopilot
            <select value={mode} onChange={(e) => changeMode(e.target.value)}>
              {MODES.map((m) => <option key={m.v} value={m.v}>{m.label}</option>)}
            </select>
          </label>
        </div>
      </div>
      {demoMsg && <div className="demo-msg small">{demoMsg}</div>}
      <div className="tickets-cols">
        <section className="panel grow">
          <div className="table-scroll">
            <table className="assets tickets-table">
              <thead>
                <tr><th>Ticket</th><th>Severity</th><th>Status</th><th>Autopilot</th><th>Assignee</th><th>SLA</th></tr>
              </thead>
              <tbody>
                {tickets.map((t) => (
                  <tr key={t.id} className={selected === t.id ? 'sel' : ''} onClick={() => setSelected(t.id)}>
                    <td><div className="aname">{t.key}</div><div className="muted small tt-title">{t.title}</div></td>
                    <td><TicketSeverityBadge severity={t.severity} /></td>
                    <td><TicketStatusBadge status={t.status} /></td>
                    <td><AutopilotBadge state={t.autopilotState} /></td>
                    <td className="muted small">{t.assignee}</td>
                    <td className="muted small">{sla(t.slaDue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        <section className="panel side ticket-detail">
          {detail ? <Detail t={detail} onRun={runNow} onApprove={approve} /> : <div className="detail empty muted">Select a ticket to see its timeline.</div>}
        </section>
      </div>
    </div>
  );
}

function Detail({ t, onRun, onApprove }: { t: TicketDetail; onRun: (id: string) => void; onApprove: (id: string) => void }) {
  const terminal = t.autopilotState === 'resolved' || t.autopilotState === 'escalated';
  const resolution = t.timeline.find((e) => e.kind === 'resolve')?.data?.resolution;
  return (
    <div className="detail">
      <div className="td-head">
        <div>
          <h3>{t.key}</h3>
          <div className="td-title">{t.title}</div>
        </div>
        <AutopilotBadge state={t.autopilotState} />
      </div>
      <div className="td-badges">
        <TicketSeverityBadge severity={t.severity} />
        <TicketStatusBadge status={t.status} />
        {t.category && <span className="chip">{t.category}</span>}
      </div>
      {t.description && <p className="td-desc muted">{t.description}</p>}
      <div className="td-meta">
        <div><span className="k">Assignee</span><span>{t.assignee || '—'}</span></div>
        <div><span className="k">Asset</span><span>{t.assetHint || '—'}</span></div>
        <div><span className="k">SLA</span><span>{sla(t.slaDue)}</span></div>
      </div>
      {t.aiAnalysis && (
        <div className="ai-analysis">
          <div className="k">AI analysis <span className={`conf ${t.aiAnalysis.confidence}`}>{t.aiAnalysis.confidence} confidence</span></div>
          <p className="ai-cause">{t.aiAnalysis.rootCause}</p>
          {t.aiAnalysis.steps?.length > 0 && (
            <ol className="ai-steps">{t.aiAnalysis.steps.map((s, i) => <li key={i}>{s}</li>)}</ol>
          )}
          <div className="muted small">Recommends: {t.aiAnalysis.recommendation}</div>
        </div>
      )}
      {t.autopilotState === 'awaiting_approval' && <button className="primary sm" onClick={() => onApprove(t.id)}>Approve remediation</button>}
      {!terminal && t.autopilotState !== 'awaiting_approval' && <button className="ghost sm" onClick={() => onRun(t.id)}>Run autopilot now</button>}
      {resolution && (
        <div className="resolution">
          <div className="k">Resolution</div>
          <p>{resolution}</p>
        </div>
      )}
      <div className="tl-head">Autopilot timeline</div>
      <ul className="timeline">
        {t.timeline.length ? (
          t.timeline.map((e) => (
            <li key={e.id} className={`tl ${e.kind}`}>
              <span className="tl-dot" aria-hidden />
              <div className="tl-body">
                <div className="tl-msg"><b className="tl-kind">{e.kind}</b> {e.message}</div>
                <div className="muted small">{new Date(e.ts).toLocaleTimeString()} · {e.actor}</div>
              </div>
            </li>
          ))
        ) : (
          <li className="muted small">Autopilot hasn't started on this ticket yet.</li>
        )}
      </ul>
    </div>
  );
}
