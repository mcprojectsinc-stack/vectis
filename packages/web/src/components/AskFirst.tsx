import { useEffect, useState, useCallback } from 'react';
import { api } from '../lib/api';

interface AIConfig { provider: string; model: string; enabledEffective: boolean }

const SUGGESTIONS = [
  'What needs my attention right now?',
  'Summarize the health of my infrastructure',
  'Which tickets need approval?',
];

// Answer-first hero for the Overview: leads with an AI (or computed) briefing and an
// "Ask Vectis" box, reflecting the shift from watch-the-dashboard to ask-and-act.
export default function AskFirst({ summary, onAsk }: { summary: any; onAsk: (q: string) => void }) {
  const [cfg, setCfg] = useState<AIConfig | null>(null);
  const [brief, setBrief] = useState('');
  const [loading, setLoading] = useState(false);
  const [val, setVal] = useState('');

  const ready = !!cfg?.enabledEffective;

  const runBrief = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api<{ reply: string }>('/ai/chat', {
        method: 'POST',
        body: JSON.stringify({
          messages: [{
            role: 'user',
            content: 'Give me a 2–3 sentence operations briefing of what needs my attention right now: the most urgent open tickets, any firing alerts, and overall health. If everything is healthy, say so plainly and suggest one proactive next step. Plain prose, no preamble.',
          }],
        }),
      });
      setBrief(r.reply || '');
    } catch (e) {
      setBrief(`⚠️ ${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    api<AIConfig>('/ai/config').then((c) => {
      setCfg(c);
      if (c.enabledEffective) runBrief();
    }).catch(() => setCfg(null));
  }, [runBrief]);

  // Non-AI fallback: a plain-language status line computed from the summary.
  const fallback = (() => {
    if (!summary) return 'Loading your environment…';
    const t = summary.tickets || {};
    const firing = summary.alertsFiring ?? 0;
    const down = summary.assets?.down ?? 0;
    const parts: string[] = [];
    if (firing) parts.push(`${firing} firing alert${firing > 1 ? 's' : ''}`);
    if (down) parts.push(`${down} host${down > 1 ? 's' : ''} down`);
    if (t.open) parts.push(`${t.open} open ticket${t.open > 1 ? 's' : ''}`);
    if (t.escalated) parts.push(`${t.escalated} escalated`);
    if (!parts.length) return 'All clear — no firing alerts, no hosts down, and no open tickets right now.';
    return `Right now: ${parts.join(', ')}. Connect an AI provider in Integrations for automatic root-cause briefings.`;
  })();

  function submit(q: string) {
    const text = q.trim();
    if (text) onAsk(text);
  }

  return (
    <div className="askfirst panel">
      <div className="af-head">
        <div className="af-title">Ask Vectis</div>
        {ready ? (
          <button className="af-refresh" onClick={runBrief} disabled={loading} title="Refresh briefing">
            {loading ? 'Thinking…' : `↻ via ${cfg?.provider}`}
          </button>
        ) : (
          <span className="muted small">AI provider not connected</span>
        )}
      </div>

      <p className="af-brief">{ready ? (loading && !brief ? 'Reading your environment…' : brief || fallback) : fallback}</p>

      <form className="af-ask" onSubmit={(e) => { e.preventDefault(); submit(val); setVal(''); }}>
        <input value={val} onChange={(e) => setVal(e.target.value)} placeholder="Ask about your infrastructure, tickets, or alerts…" />
        <button className="primary" type="submit" disabled={!val.trim()}>Ask</button>
      </form>

      <div className="af-suggest">
        {SUGGESTIONS.map((s) => (
          <button key={s} className="chip clickable" onClick={() => submit(s)}>{s}</button>
        ))}
      </div>
    </div>
  );
}
