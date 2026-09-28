import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { db } from '../db';
import { requireAuth } from '../auth';
import { autopilotTick } from '../autopilot';
import { AI_PROVIDERS, readAIConfig, readAIConfigFull, writeAIConfig, aiEnabled } from '../ai/config';
import { aiChat, aiPropose, aiPing } from '../ai/tasks';
import type { ChatMsg } from '../ai/providers';
import { readNotifyPublic, writeNotify, testChannel } from '../notify';
import { readJiraPublic, writeJira, syncJiraTenant } from '../ticketing/jira';

export const aiRouter = Router();
aiRouter.use(requireAuth);

/** Provider catalog for the settings UI. */
aiRouter.get('/ai/providers', (_req, res) => res.json(AI_PROVIDERS));

/** Current config (never returns the stored key). */
aiRouter.get('/ai/config', (req, res) => {
  res.json({ ...readAIConfig(req.user!.tid), enabledEffective: aiEnabled(req.user!.tid) });
});

/** Save provider config. Blank apiKey keeps the existing stored key. */
aiRouter.post('/ai/config', (req, res) => {
  const b = req.body ?? {};
  const r = writeAIConfig(req.user!.tid, {
    provider: String(b.provider ?? ''),
    model: b.model != null ? String(b.model) : '',
    baseUrl: b.baseUrl != null ? String(b.baseUrl) : '',
    enabled: b.enabled !== false,
    apiKey: b.apiKey != null ? String(b.apiKey) : undefined,
  });
  if (!r.ok) return res.status(400).json({ error: r.error });
  res.json({ ...readAIConfig(req.user!.tid), enabledEffective: aiEnabled(req.user!.tid) });
});

/** Test connection: uses the just-entered key if present, else the stored one. */
aiRouter.post('/ai/config/test', async (req, res) => {
  const b = req.body ?? {};
  const stored = readAIConfigFull(req.user!.tid);
  const cfg = {
    provider: String(b.provider || stored.provider),
    model: String(b.model || stored.model),
    baseUrl: String(b.baseUrl || stored.baseUrl || ''),
    apiKey: b.apiKey ? String(b.apiKey) : stored.apiKey,
  };
  if (!cfg.provider) return res.status(400).json({ ok: false, error: 'choose a provider first' });
  if (cfg.provider !== 'mock' && cfg.provider !== 'custom' && !cfg.apiKey) return res.status(400).json({ ok: false, error: 'no API key set' });
  if (cfg.provider !== 'mock' && !cfg.model) return res.status(400).json({ ok: false, error: 'enter a model name' });
  try {
    const reply = await aiPing(cfg);
    res.json({ ok: true, reply: (reply || '').slice(0, 120) });
  } catch (e) {
    res.json({ ok: false, error: (e as Error).message });
  }
});

/** Admin chat assistant ("Ask Vectis"). */
aiRouter.post('/ai/chat', async (req, res) => {
  if (!aiEnabled(req.user!.tid)) return res.status(400).json({ error: 'AI is not configured. Set a provider in Integrations.' });
  const msgs = Array.isArray(req.body?.messages) ? (req.body.messages as ChatMsg[]) : [];
  const clean = msgs
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .map((m) => ({ role: m.role, content: m.content.slice(0, 4000) }));
  if (!clean.length) return res.status(400).json({ error: 'no messages' });
  try {
    const reply = await aiChat(req.user!.tid, clean);
    res.json({ reply });
  } catch (e) {
    res.status(502).json({ error: (e as Error).message });
  }
});

/** Natural-language action: interpret, then file an approval-gated ticket. */
aiRouter.post('/ai/command', async (req, res) => {
  const tid = req.user!.tid;
  if (!aiEnabled(tid)) return res.status(400).json({ error: 'AI is not configured. Set a provider in Integrations.' });
  const text = String(req.body?.text ?? '').trim();
  if (!text) return res.status(400).json({ error: 'empty command' });
  let proposal;
  try {
    proposal = await aiPropose(tid, text);
  } catch (e) {
    return res.status(502).json({ error: (e as Error).message });
  }
  if (!proposal) return res.status(502).json({ error: 'could not interpret the request' });

  // File it as a ticket so it flows through the same safe, approval-gated autopilot.
  const now = Date.now();
  const ticketId = randomUUID();
  const email = (db.prepare('SELECT email FROM users WHERE id=?').get(req.user!.uid) as { email: string } | undefined)?.email ?? 'admin';
  db.prepare(`
    INSERT INTO tickets (id,tenant_id,integration_id,external_key,title,description,severity,priority,category,status,assignee,asset_hint,autopilot_state,sla_due,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,'open',?,?, 'queued', ?, ?, ?)
  `).run(
    ticketId, tid, null, 'NL-' + String(now).slice(-5),
    proposal.understood.slice(0, 140),
    `Natural-language request via the assistant: "${text}". AI interpretation: ${proposal.rationale}`,
    'medium', 3, proposal.category, email, proposal.host === 'unspecified' ? null : proposal.host,
    now + 4 * 3600_000, now, now,
  );
  autopilotTick();
  res.json({ proposal, ticketId });
});

/* ----------------------------- Notifications (Slack / email) ----------------------------- */
aiRouter.get('/notify/config', (req, res) => res.json(readNotifyPublic(req.user!.tid)));
aiRouter.post('/notify/config', (req, res) => { writeNotify(req.user!.tid, req.body ?? {}); res.json(readNotifyPublic(req.user!.tid)); });
aiRouter.post('/notify/test', async (req, res) => {
  const r = await testChannel(req.user!.tid, String(req.body?.channel ?? ''), req.body ?? {});
  res.status(r.ok ? 200 : 400).json(r);
});

/* ----------------------------- Jira ticketing ----------------------------- */
aiRouter.get('/jira/config', (req, res) => res.json(readJiraPublic(req.user!.tid)));
aiRouter.post('/jira/config', (req, res) => { writeJira(req.user!.tid, req.body ?? {}); res.json(readJiraPublic(req.user!.tid)); });
aiRouter.post('/jira/sync', async (req, res) => {
  try { const r = await syncJiraTenant(req.user!.tid); res.json(r ?? { error: 'Jira not configured' }); }
  catch (e) { res.status(502).json({ error: (e as Error).message }); }
});
