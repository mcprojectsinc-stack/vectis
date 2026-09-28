import { Router, type Request, type Response, type NextFunction } from 'express';
import { randomUUID } from 'node:crypto';
import { db } from '../db';
import { evaluateMetric } from '../alerts';
import { onJobResult } from '../autopilot';

export const ingestRouter = Router();

/** Agent enrollment: exchange a tenant enroll token for a per-agent identity. */
ingestRouter.post('/enroll', (req, res) => {
  const { token, name, os, version } = req.body ?? {};
  const tenant = db.prepare('SELECT id,name FROM tenants WHERE enroll_token=?').get(token) as { id: string; name: string } | undefined;
  if (!tenant) return res.status(401).json({ error: 'invalid enrollment token' });
  const id = randomUUID();
  const agentKey = randomUUID().replace(/-/g, '');
  const now = Date.now();
  db.prepare('INSERT INTO agents (id,tenant_id,name,agent_key,os,version,last_seen,created_at) VALUES (?,?,?,?,?,?,?,?)').run(
    id, tenant.id, name || 'agent', agentKey, os || null, version || null, now, now,
  );
  res.json({ agentId: id, agentKey, tenant: { id: tenant.id, name: tenant.name } });
});

function requireAgent(req: Request, res: Response, next: NextFunction) {
  const id = req.headers['x-agent-id'] as string | undefined;
  const key = req.headers['x-agent-key'] as string | undefined;
  if (!id || !key) return res.status(401).json({ error: 'missing agent credentials' });
  const agent = db.prepare('SELECT id,tenant_id,agent_key FROM agents WHERE id=?').get(id) as
    | { id: string; tenant_id: string; agent_key: string }
    | undefined;
  if (!agent || agent.agent_key !== key) return res.status(401).json({ error: 'invalid agent credentials' });
  req.agent = { id: agent.id, tenant_id: agent.tenant_id };
  next();
}

interface IncomingAsset {
  type: string;
  name: string;
  address?: string;
  labels?: Record<string, unknown>;
  status?: string;
  metrics?: { name: string; value: number }[];
}

/** Bulk ingest: upsert assets, store metrics, and evaluate alert rules. */
ingestRouter.post('/ingest', requireAgent, (req, res) => {
  const body = req.body ?? {};
  const assets: IncomingAsset[] = body.assets;
  const tenantId = req.agent!.tenant_id;
  const now: number = body.ts || Date.now();
  if (!Array.isArray(assets)) return res.status(400).json({ error: 'assets array required' });

  const upsert = db.prepare(`
    INSERT INTO assets (id,tenant_id,agent_id,type,name,address,labels,status,discovered_by,first_seen,last_seen)
    VALUES (@id,@tenant_id,@agent_id,@type,@name,@address,@labels,@status,'agent',@now,@now)
    ON CONFLICT(tenant_id,type,address) DO UPDATE SET
      name=excluded.name, status=excluded.status, labels=excluded.labels,
      agent_id=excluded.agent_id, last_seen=excluded.last_seen
  `);
  const findAsset = db.prepare('SELECT id,type,name FROM assets WHERE tenant_id=? AND type=? AND address=?');
  const insMetric = db.prepare('INSERT INTO metrics (tenant_id,asset_id,name,value,ts) VALUES (?,?,?,?,?)');

  let metricCount = 0;
  const tx = db.transaction(() => {
    for (const a of assets) {
      if (!a || !a.type || !a.name) continue;
      const address = a.address ?? a.name;
      upsert.run({
        id: randomUUID(),
        tenant_id: tenantId,
        agent_id: req.agent!.id,
        type: a.type,
        name: a.name,
        address,
        labels: a.labels ? JSON.stringify(a.labels) : null,
        status: a.status ?? 'unknown',
        now,
      });
      const asset = findAsset.get(tenantId, a.type, address) as { id: string; type: string; name: string } | undefined;
      if (!asset) continue;
      for (const m of a.metrics ?? []) {
        if (typeof m.value !== 'number' || !Number.isFinite(m.value)) continue;
        insMetric.run(tenantId, asset.id, m.name, m.value, now);
        evaluateMetric(tenantId, asset, m.name, m.value, now);
        metricCount++;
      }
    }
    db.prepare('UPDATE agents SET last_seen=? WHERE id=?').run(now, req.agent!.id);
  });
  tx();

  res.json({ ok: true, assets: assets.length, metrics: metricCount });
});

/** Remediation jobs the agent should execute on its own host. */
ingestRouter.get('/agent/jobs', requireAgent, (req, res) => {
  const agentId = req.agent!.id;
  const rows = db.prepare("SELECT id,action,params,dry_run FROM jobs WHERE agent_id=? AND status='pending' ORDER BY created_at LIMIT 10").all(agentId) as {
    id: string; action: string; params: string | null; dry_run: number;
  }[];
  const now = Date.now();
  const upd = db.prepare("UPDATE jobs SET status='running', updated_at=? WHERE id=? AND status='pending'");
  const jobs = rows.map((r) => {
    upd.run(now, r.id);
    return { id: r.id, action: r.action, params: r.params ? JSON.parse(r.params) : {}, dryRun: !!r.dry_run };
  });
  res.json({ jobs });
});

/** The agent reports the outcome of a remediation job; the autopilot then verifies + closes. */
ingestRouter.post('/agent/jobs/:id/result', requireAgent, (req, res) => {
  const job = db.prepare('SELECT id,tenant_id,agent_id FROM jobs WHERE id=?').get(req.params.id) as
    | { id: string; tenant_id: string; agent_id: string }
    | undefined;
  if (!job || job.agent_id !== req.agent!.id) return res.status(404).json({ error: 'not found' });
  const status = req.body?.status === 'failed' ? 'failed' : 'done';
  db.prepare('UPDATE jobs SET status=?, result=?, updated_at=? WHERE id=?').run(status, JSON.stringify(req.body?.result ?? {}), Date.now(), job.id);
  try {
    onJobResult(job.tenant_id, job.id);
  } catch (e) {
    console.error('[jobs] onJobResult error:', (e as Error).message);
  }
  res.json({ ok: true });
});
