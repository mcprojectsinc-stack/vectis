import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { db, seedSampleTickets, getSetting, setSetting } from '../db';
import { requireAuth } from '../auth';
import { runToCompletion, approveTicket, autopilotTick, SEV_RANK } from '../autopilot';
import type { TicketRow } from '../ticketing/provider';

export const ticketsRouter = Router();
ticketsRouter.use(requireAuth);

const mapTicket = (t: TicketRow) => ({
  id: t.id,
  key: t.external_key,
  title: t.title,
  description: t.description,
  severity: t.severity,
  priority: t.priority,
  category: t.category,
  status: t.status,
  assignee: t.assignee,
  assetHint: t.asset_hint,
  assetId: t.asset_id,
  autopilotState: t.autopilot_state,
  slaDue: t.sla_due,
  createdAt: t.created_at,
  updatedAt: t.updated_at,
  resolvedAt: t.resolved_at,
  aiAnalysis: (() => { try { return t.ai_analysis ? JSON.parse(t.ai_analysis) : null; } catch { return null; } })(),
});

/** Triage queue — sorted by severity, then precedence, then age. */
ticketsRouter.get('/tickets', (req, res) => {
  const tid = req.user!.tid;
  let rows = db.prepare('SELECT * FROM tickets WHERE tenant_id=?').all(tid) as TicketRow[];
  if (req.query.status) rows = rows.filter((r) => r.status === req.query.status);
  rows.sort(
    (a, b) =>
      (SEV_RANK[a.severity] ?? 9) - (SEV_RANK[b.severity] ?? 9) ||
      (a.priority ?? 99) - (b.priority ?? 99) ||
      a.created_at - b.created_at,
  );
  res.json(rows.map(mapTicket));
});

/** Ticket detail + the autopilot timeline. */
ticketsRouter.get('/tickets/:id', (req, res) => {
  const tid = req.user!.tid;
  const t = db.prepare('SELECT * FROM tickets WHERE id=? AND tenant_id=?').get(req.params.id, tid) as TicketRow | undefined;
  if (!t) return res.status(404).json({ error: 'not found' });
  const events = (
    db.prepare('SELECT id,ts,kind,actor,message,data FROM ticket_events WHERE ticket_id=? ORDER BY ts').all(t.id) as {
      id: string; ts: number; kind: string; actor: string; message: string; data: string | null;
    }[]
  ).map((e) => ({ ...e, data: e.data ? JSON.parse(e.data) : null }));
  res.json({ ...mapTicket(t), timeline: events });
});

/** Manually fast-forward the autopilot on one ticket. */
ticketsRouter.post('/tickets/:id/run', (req, res) => {
  const tid = req.user!.tid;
  const t = db.prepare('SELECT id FROM tickets WHERE id=? AND tenant_id=?').get(req.params.id, tid);
  if (!t) return res.status(404).json({ error: 'not found' });
  runToCompletion(tid, req.params.id, getSetting(tid, 'autopilot_mode', 'auto_safe') === 'diagnose' ? 'diagnose' : 'auto_safe');
  res.json({ ok: true });
});

/** Approve a ticket that was waiting for sign-off (approve mode). */
ticketsRouter.post('/tickets/:id/approve', (req, res) => {
  const tid = req.user!.tid;
  res.json({ ok: approveTicket(tid, req.params.id) });
});

/** Integrations (ticketing connectors). */
ticketsRouter.get('/integrations', (req, res) => {
  const tid = req.user!.tid;
  const rows = db.prepare('SELECT id,kind,provider,status,created_at FROM integrations WHERE tenant_id=? ORDER BY created_at').all(tid);
  res.json(rows);
});

/** Attach the (mock) ticketing connector and seed sample tickets. */
ticketsRouter.post('/integrations/ticketing', (req, res) => {
  const tid = req.user!.tid;
  const provider = String(req.body?.provider ?? 'mock');
  const existing = db.prepare("SELECT id FROM integrations WHERE tenant_id=? AND kind='ticketing'").get(tid) as { id: string } | undefined;
  if (existing) return res.json({ id: existing.id, provider, alreadyAttached: true });
  const id = randomUUID();
  db.prepare('INSERT INTO integrations (id,tenant_id,kind,provider,config,status,created_at) VALUES (?,?,?,?,?,?,?)').run(
    id, tid, 'ticketing', provider, JSON.stringify({ demo: true }), 'connected', Date.now(),
  );
  const seeded = seedSampleTickets(tid, id);
  setSetting(tid, 'autopilot_mode', getSetting(tid, 'autopilot_mode', 'auto_safe'));
  autopilotTick(); // kick off the first step immediately
  res.json({ id, provider, seeded });
});

/** Detach ticketing and clear its tickets/timeline (clean reset for the demo). */
ticketsRouter.delete('/integrations/:id', (req, res) => {
  const tid = req.user!.tid;
  db.prepare('DELETE FROM ticket_events WHERE tenant_id=? AND ticket_id IN (SELECT id FROM tickets WHERE integration_id=?)').run(tid, req.params.id);
  db.prepare('DELETE FROM notifications WHERE tenant_id=? AND ticket_id IN (SELECT id FROM tickets WHERE integration_id=?)').run(tid, req.params.id);
  db.prepare('DELETE FROM tickets WHERE tenant_id=? AND integration_id=?').run(tid, req.params.id);
  db.prepare('DELETE FROM integrations WHERE tenant_id=? AND id=?').run(tid, req.params.id);
  res.json({ ok: true });
});

/** Notifications feed. */
ticketsRouter.get('/notifications', (req, res) => {
  const tid = req.user!.tid;
  const rows = db.prepare('SELECT id,ticket_id,recipient,channel,message,created_at,read FROM notifications WHERE tenant_id=? ORDER BY created_at DESC LIMIT 50').all(tid);
  res.json(rows);
});

ticketsRouter.post('/notifications/read', (req, res) => {
  db.prepare('UPDATE notifications SET read=1 WHERE tenant_id=?').run(req.user!.tid);
  res.json({ ok: true });
});

/** Autopilot mode (auto_safe | approve | diagnose | paused). */
ticketsRouter.get('/autopilot', (req, res) => {
  res.json({ mode: getSetting(req.user!.tid, 'autopilot_mode', 'auto_safe') });
});

ticketsRouter.post('/autopilot', (req, res) => {
  const mode = String(req.body?.mode ?? 'auto_safe');
  if (!['auto_safe', 'approve', 'diagnose', 'paused'].includes(mode)) return res.status(400).json({ error: 'invalid mode' });
  setSetting(req.user!.tid, 'autopilot_mode', mode);
  res.json({ ok: true, mode });
});

/**
 * Stage a REAL, self-contained incident on the agent's own host: fill the agent's
 * managed working directory (via a real job), then file a ticket for it. Approving
 * that ticket triggers a real, verified cleanup on the host.
 */
ticketsRouter.post('/demo/self-heal', (req, res) => {
  const tid = req.user!.tid;
  const agent = db.prepare('SELECT id,name FROM agents WHERE tenant_id=? ORDER BY last_seen DESC LIMIT 1').get(tid) as { id: string; name: string } | undefined;
  if (!agent) return res.status(400).json({ error: 'No agent is running yet. Start the agent, then try again.' });
  const asset = db.prepare("SELECT id,name FROM assets WHERE tenant_id=? AND agent_id=? AND json_extract(labels,'$.role')='self' LIMIT 1").get(tid, agent.id) as { id: string; name: string } | undefined;
  if (!asset) return res.status(400).json({ error: "The agent hasn't reported its host yet. Wait a few seconds and try again." });

  const email = (db.prepare('SELECT email FROM users WHERE id=?').get(req.user!.uid) as { email: string } | undefined)?.email ?? 'admin';
  const now = Date.now();

  // Real job: fill the managed dir on the agent host so there is genuinely something to reclaim.
  db.prepare('INSERT INTO jobs (id,tenant_id,agent_id,ticket_id,action,params,dry_run,status,created_at,updated_at) VALUES (?,?,?,?,?,?,0,?,?,?)').run(
    randomUUID(), tid, agent.id, null, 'fill-disk-demo', JSON.stringify({ mb: 40 }), 'pending', now, now,
  );

  const ticketId = randomUUID();
  db.prepare(`
    INSERT INTO tickets (id,tenant_id,integration_id,external_key,title,description,severity,priority,category,status,assignee,asset_hint,asset_id,autopilot_state,sla_due,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,'open',?,?,?, 'queued', ?, ?, ?)
  `).run(
    ticketId, tid, null, 'INC-SELF-' + String(now).slice(-4),
    `Managed disk pressure on ${asset.name}`,
    `The Vectis-managed working directory on ${asset.name} is filling up with reclaimable files. This host has a live agent, so the fix runs for real (after approval).`,
    'high', 2, 'managed-disk', email, asset.name, asset.id, now + 2 * 3600_000, now, now,
  );
  autopilotTick();
  res.json({ ticketId, host: asset.name });
});
