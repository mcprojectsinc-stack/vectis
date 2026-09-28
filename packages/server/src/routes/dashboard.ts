import { Router } from 'express';
import { db, getSetting } from '../db';
import { requireAuth } from '../auth';

export const dashboardRouter = Router();
dashboardRouter.use(requireAuth);

/** Tenant info + agents — used by the "Add agent" page. */
dashboardRouter.get('/tenant', (req, res) => {
  const t = db.prepare('SELECT id,name,enroll_token FROM tenants WHERE id=?').get(req.user!.tid) as { id: string; name: string; enroll_token: string };
  const agents = db.prepare('SELECT id,name,os,version,last_seen FROM agents WHERE tenant_id=? ORDER BY created_at').all(req.user!.tid);
  res.json({ tenant: { id: t.id, name: t.name, enrollToken: t.enroll_token }, agents });
});

/** Headline counters for the summary tiles. */
dashboardRouter.get('/summary', (req, res) => {
  const tid = req.user!.tid;
  const rows = db.prepare('SELECT status, COUNT(*) c FROM assets WHERE tenant_id=? GROUP BY status').all(tid) as { status: string; c: number }[];
  const assets = { total: 0, up: 0, down: 0, unknown: 0 };
  for (const r of rows) {
    assets.total += r.c;
    if (r.status === 'up') assets.up += r.c;
    else if (r.status === 'down') assets.down += r.c;
    else assets.unknown += r.c;
  }
  const alertsFiring = (db.prepare("SELECT COUNT(*) c FROM alerts WHERE tenant_id=? AND state IN ('firing','acknowledged')").get(tid) as { c: number }).c;
  const agents = (db.prepare('SELECT COUNT(*) c FROM agents WHERE tenant_id=?').get(tid) as { c: number }).c;

  const tRows = db.prepare('SELECT status, COUNT(*) c FROM tickets WHERE tenant_id=? GROUP BY status').all(tid) as { status: string; c: number }[];
  const tickets = { total: 0, open: 0, resolved: 0, escalated: 0 };
  for (const r of tRows) {
    tickets.total += r.c;
    if (r.status === 'open' || r.status === 'in_progress') tickets.open += r.c;
    else if (r.status === 'resolved' || r.status === 'closed') tickets.resolved += r.c;
    else if (r.status === 'escalated') tickets.escalated += r.c;
  }
  const unreadNotifications = (db.prepare('SELECT COUNT(*) c FROM notifications WHERE tenant_id=? AND read=0').get(tid) as { c: number }).c;
  const ticketingAttached = !!db.prepare("SELECT 1 FROM integrations WHERE tenant_id=? AND kind='ticketing' AND status='connected'").get(tid);

  res.json({ assets, alertsFiring, agents, tickets, unreadNotifications, ticketingAttached, autopilotMode: getSetting(tid, 'autopilot_mode', 'auto_safe') });
});

/** All assets with their latest metric values. */
dashboardRouter.get('/assets', (req, res) => {
  const tid = req.user!.tid;
  const assets = db.prepare('SELECT id,type,name,address,labels,status,last_seen FROM assets WHERE tenant_id=? ORDER BY type,name').all(tid) as {
    id: string; type: string; name: string; address: string | null; labels: string | null; status: string; last_seen: number;
  }[];
  const latest = db
    .prepare(`
      SELECT m.asset_id, m.name, m.value FROM metrics m
      JOIN (SELECT asset_id, name, MAX(ts) mx FROM metrics WHERE tenant_id=? GROUP BY asset_id, name) t
        ON m.asset_id=t.asset_id AND m.name=t.name AND m.ts=t.mx
      WHERE m.tenant_id=?
    `)
    .all(tid, tid) as { asset_id: string; name: string; value: number }[];
  const byAsset: Record<string, Record<string, number>> = {};
  for (const r of latest) (byAsset[r.asset_id] ??= {})[r.name] = r.value;

  res.json(
    assets.map((a) => ({
      id: a.id,
      type: a.type,
      name: a.name,
      address: a.address,
      labels: a.labels ? JSON.parse(a.labels) : {},
      status: a.status,
      lastSeen: a.last_seen,
      metrics: byAsset[a.id] ?? {},
    })),
  );
});

/** Time-series for one metric of one asset (for charts). */
dashboardRouter.get('/assets/:id/metrics', (req, res) => {
  const tid = req.user!.tid;
  const asset = db.prepare('SELECT id FROM assets WHERE id=? AND tenant_id=?').get(req.params.id, tid);
  if (!asset) return res.status(404).json({ error: 'not found' });
  const name = String(req.query.name ?? 'cpu.usage');
  const minutes = Math.min(Number(req.query.minutes ?? 30) || 30, 1440);
  const since = Date.now() - minutes * 60_000;
  const points = db
    .prepare('SELECT ts, value FROM metrics WHERE tenant_id=? AND asset_id=? AND name=? AND ts>=? ORDER BY ts')
    .all(tid, req.params.id, name, since);
  res.json({ name, points });
});

/** Alerts list — state=open for firing/acknowledged, otherwise recent history. */
dashboardRouter.get('/alerts', (req, res) => {
  const tid = req.user!.tid;
  const base = 'SELECT a.*, s.name asset_name, s.type asset_type FROM alerts a JOIN assets s ON a.asset_id=s.id WHERE a.tenant_id=?';
  const rows =
    req.query.state === 'open'
      ? db.prepare(`${base} AND a.state IN ('firing','acknowledged') ORDER BY a.updated_at DESC`).all(tid)
      : db.prepare(`${base} ORDER BY a.updated_at DESC LIMIT 100`).all(tid);
  res.json(rows);
});

/** Acknowledge a firing alert. */
dashboardRouter.post('/alerts/:id/ack', (req, res) => {
  const info = db
    .prepare("UPDATE alerts SET state='acknowledged', updated_at=? WHERE id=? AND tenant_id=? AND state='firing'")
    .run(Date.now(), req.params.id, req.user!.tid);
  res.json({ ok: true, changed: info.changes });
});
