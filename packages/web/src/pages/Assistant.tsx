import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';

interface Msg { role: 'user' | 'assistant'; content: string }
interface AIConfig { provider: string; model: string; enabledEffective: boolean }
interface AssistantProps { initialQuestion?: string | null; onConsumed?: () => void }

const SUGGESTIONS = [
  'What is the autopilot working on right now?',
  'Summarize the health of my infrastructure.',
  'Which tickets need my approval?',
  'Explain the last incident that was escalated.',
];

export default function Assistant({ initialQuestion, onConsumed }: AssistantProps = {}) {
  const [cfg, setCfg] = useState<AIConfig | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [cmd, setCmd] = useState('');
  const [cmdResult, setCmdResult] = useState<string>('');
  const [cmdBusy, setCmdBusy] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const consumed = useRef(false);

  useEffect(() => { api('/ai/config').then(setCfg).catch(() => setCfg(null)); }, []);
  useEffect(() => { scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' }); }, [msgs, busy]);

  const ready = !!cfg?.enabledEffective;

  // A question routed in from the Overview "Ask Vectis" box: send it once, then clear.
  useEffect(() => {
    if (ready && initialQuestion && !consumed.current) {
      consumed.current = true;
      send(initialQuestion);
      onConsumed?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, initialQuestion]);

  async function send(text: string) {
    const q = text.trim();
    if (!q || busy) return;
    const next = [...msgs, { role: 'user' as const, content: q }];
    setMsgs(next);
    setInput('');
    setBusy(true);
    try {
      const r = await api<{ reply: string }>('/ai/chat', { method: 'POST', body: JSON.stringify({ messages: next }) });
      setMsgs((m) => [...m, { role: 'assistant', content: r.reply || '(no reply)' }]);
    } catch (e) {
      setMsgs((m) => [...m, { role: 'assistant', content: `⚠️ ${(e as Error).message}` }]);
    } finally {
      setBusy(false);
    }
  }

  async function runCommand() {
    const text = cmd.trim();
    if (!text || cmdBusy) return;
    setCmdBusy(true);
    setCmdResult('');
    try {
      const r = await api<{ proposal: { understood: string; action: string; host: string; rationale: string }; ticketId: string }>(
        '/ai/command', { method: 'POST', body: JSON.stringify({ text }) },
      );
      setCmdResult(
        `Understood: ${r.proposal.understood}\nProposed action: ${r.proposal.action} on ${r.proposal.host}\n${r.proposal.rationale}\n\n✓ Filed as a ticket — the autopilot will work it, and any real change waits for your approval on the Tickets page.`,
      );
      setCmd('');
    } catch (e) {
      setCmdResult(`⚠️ ${(e as Error).message}`);
    } finally {
      setCmdBusy(false);
    }
  }

  if (cfg && !ready) {
    return (
      <div className="empty-card">
        <h3>Connect an AI provider</h3>
        <p className="muted">
          The assistant, AI-assisted troubleshooting, auto-documentation, and natural-language actions all run on the
          provider you choose. Open <b>Integrations</b> → <b>AI provider</b> and connect Anthropic, OpenAI, Gemini,
          Azure, a local model, or the built-in demo AI (no key).
        </p>
      </div>
    );
  }

  return (
    <div className="assistant">
      <div className="asst-chat panel">
        <div className="asst-scroll" ref={scroller}>
          {msgs.length === 0 && (
            <div className="asst-welcome">
              <div className="asst-hi">Ask Vectis about your infrastructure</div>
              <div className="muted small">Connected to {cfg?.provider}{cfg?.model ? ` · ${cfg.model}` : ''}. It can see your live assets, tickets and alerts.</div>
              <div className="asst-suggest">
                {SUGGESTIONS.map((s) => (
                  <button key={s} className="chip clickable" onClick={() => send(s)}>{s}</button>
                ))}
              </div>
            </div>
          )}
          {msgs.map((m, i) => (
            <div key={i} className={`bubble ${m.role}`}>{m.content}</div>
          ))}
          {busy && <div className="bubble assistant thinking">Thinking…</div>}
        </div>
        <form
          className="asst-input"
          onSubmit={(e) => { e.preventDefault(); send(input); }}
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask about tickets, alerts, hosts, or what the autopilot did…"
            disabled={busy}
          />
          <button className="primary" type="submit" disabled={busy || !input.trim()}>Send</button>
        </form>
      </div>

      <div className="asst-action panel">
        <div className="aa-head">Natural-language action</div>
        <p className="muted small">
          Describe a fix in plain English (e.g. “reclaim disk space on db-prod-01” or “restart nginx on web-01”). Vectis
          interprets it and files an approval-gated ticket — nothing runs on a real host until you approve it.
        </p>
        <form onSubmit={(e) => { e.preventDefault(); runCommand(); }} className="aa-form">
          <input value={cmd} onChange={(e) => setCmd(e.target.value)} placeholder="e.g. reclaim disk space on db-prod-01" disabled={cmdBusy} />
          <button className="primary sm" type="submit" disabled={cmdBusy || !cmd.trim()}>Propose</button>
        </form>
        {cmdResult && <pre className="aa-result">{cmdResult}</pre>}
      </div>
    </div>
  );
}
