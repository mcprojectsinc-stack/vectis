import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { config } from './config';

mkdirSync(dirname(config.dbPath), { recursive: true });

export const db = new Database(config.dbPath);
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS tenants (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  enroll_token TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'owner',
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  name TEXT NOT NULL,
  agent_key TEXT NOT NULL,
  os TEXT,
  version TEXT,
  last_seen INTEGER,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS assets (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  agent_id TEXT,
  type TEXT NOT NULL,
  name TEXT NOT NULL,
  address TEXT,
  labels TEXT,
  status TEXT NOT NULL DEFAULT 'unknown',
  discovered_by TEXT,
  first_seen INTEGER NOT NULL,
  last_seen INTEGER NOT NULL,
  UNIQUE(tenant_id, type, address)
);
CREATE TABLE IF NOT EXISTS metrics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  asset_id TEXT NOT NULL,
  name TEXT NOT NULL,
  value REAL NOT NULL,
  ts INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_metrics_lookup ON metrics(tenant_id, asset_id, name, ts);
CREATE TABLE IF NOT EXISTS alert_rules (
  id TEXT PRIMARY KEY,
  tenant_id TEXT,
  name TEXT NOT NULL,
  asset_type TEXT NOT NULL,
  metric TEXT NOT NULL,
  op TEXT NOT NULL,
  threshold REAL NOT NULL,
  severity TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS alerts (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  rule_id TEXT NOT NULL,
  asset_id TEXT NOT NULL,
  severity TEXT NOT NULL,
  state TEXT NOT NULL,
  message TEXT NOT NULL,
  value REAL,
  started_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  resolved_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_alerts_open ON alerts(tenant_id, asset_id, rule_id, state);

CREATE TABLE IF NOT EXISTS integrations (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  provider TEXT NOT NULL,
  config TEXT,
  status TEXT NOT NULL DEFAULT 'connected',
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (
  tenant_id TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT,
  PRIMARY KEY (tenant_id, key)
);
CREATE TABLE IF NOT EXISTS tickets (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  integration_id TEXT,
  external_key TEXT,
  title TEXT NOT NULL,
  description TEXT,
  severity TEXT NOT NULL,
  priority INTEGER,
  category TEXT,
  status TEXT NOT NULL,
  assignee TEXT,
  asset_hint TEXT,
  asset_id TEXT,
  autopilot_state TEXT NOT NULL DEFAULT 'queued',
  sla_due INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  resolved_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_tickets_tenant ON tickets(tenant_id, status);
CREATE TABLE IF NOT EXISTS ticket_events (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  ticket_id TEXT NOT NULL,
  ts INTEGER NOT NULL,
  kind TEXT NOT NULL,
  actor TEXT NOT NULL,
  message TEXT NOT NULL,
  data TEXT
);
CREATE INDEX IF NOT EXISTS idx_events_ticket ON ticket_events(ticket_id, ts);
CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  ticket_id TEXT,
  recipient TEXT,
  channel TEXT NOT NULL DEFAULT 'inapp',
  message TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  read INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_notifs_tenant ON notifications(tenant_id, created_at);

CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  ticket_id TEXT,
  action TEXT NOT NULL,
  params TEXT,
  dry_run INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',
  result TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_jobs_agent ON jobs(agent_id, status);
`);

// Lightweight, idempotent migrations for databases created before a column existed.
for (const stmt of [
  'ALTER TABLE tickets ADD COLUMN ai_analysis TEXT',
]) {
  try { db.exec(stmt); } catch { /* column already exists */ }
}

// Global default alert rules (tenant_id = NULL applies to every tenant).
const DEFAULT_RULES: [string, string, string, string, number, string][] = [
  ['High CPU usage', 'server', 'cpu.usage', 'gt', 90, 'warning'],
  ['High memory usage', 'server', 'mem.usage', 'gt', 90, 'warning'],
  ['Disk almost full', 'server', 'disk.usage', 'gt', 90, 'critical'],
  ['Host unreachable', 'server', 'reachable', 'lt', 1, 'critical'],
];

export function seed() {
  const now = Date.now();

  const haveRules = (db.prepare('SELECT COUNT(*) c FROM alert_rules WHERE tenant_id IS NULL').get() as { c: number }).c;
  if (!haveRules) {
    const ins = db.prepare(
      'INSERT INTO alert_rules (id,tenant_id,name,asset_type,metric,op,threshold,severity,enabled) VALUES (?,NULL,?,?,?,?,?,?,1)',
    );
    for (const [name, type, metric, op, threshold, severity] of DEFAULT_RULES) {
      ins.run(randomUUID(), name, type, metric, op, threshold, severity);
    }
  }

  let demoTenant = db.prepare('SELECT id FROM tenants WHERE enroll_token=?').get(config.demo.enrollToken) as { id: string } | undefined;
  if (!demoTenant) {
    const id = randomUUID();
    db.prepare('INSERT INTO tenants (id,name,enroll_token,created_at) VALUES (?,?,?,?)').run(id, config.demo.orgName, config.demo.enrollToken, now);
    demoTenant = { id };
  }
  const demoUser = db.prepare('SELECT id FROM users WHERE email=?').get(config.demo.email);
  if (!demoUser) {
    db.prepare('INSERT INTO users (id,tenant_id,email,password_hash,role,created_at) VALUES (?,?,?,?,?,?)').run(
      randomUUID(), demoTenant.id, config.demo.email, bcrypt.hashSync(config.demo.password, 10), 'owner', now,
    );
  }
}

export function pruneMetrics() {
  const cutoff = Date.now() - config.metricRetentionHours * 3600_000;
  db.prepare('DELETE FROM metrics WHERE ts < ?').run(cutoff);
}

export function getSetting(tenantId: string, key: string, fallback: string): string {
  const row = db.prepare('SELECT value FROM settings WHERE tenant_id=? AND key=?').get(tenantId, key) as { value: string } | undefined;
  return row?.value ?? fallback;
}

export function setSetting(tenantId: string, key: string, value: string): void {
  db.prepare('INSERT INTO settings (tenant_id,key,value) VALUES (?,?,?) ON CONFLICT(tenant_id,key) DO UPDATE SET value=excluded.value').run(tenantId, key, value);
}

const HOUR = 3600_000;

// Sample tickets so the autopilot has something to work the moment the mock
// ticketing connector is attached. Mixed severities and categories: some have a
// safe playbook (auto-resolved), others must escalate to a human.
export function seedSampleTickets(tenantId: string, integrationId: string): number {
  const now = Date.now();
  const samples: {
    key: string; title: string; description: string; severity: string; priority: number;
    category: string; assignee: string; assetHint: string; ageH: number; slaH: number;
  }[] = [
    { key: 'INC-1042', title: 'Database disk almost full on db-prod-01', description: 'Monitoring shows / at 96% on db-prod-01. Risk of write failures.', severity: 'critical', priority: 1, category: 'disk', assignee: 'ops@vectis.io', assetHint: 'db-prod-01', ageH: 1, slaH: 2 },
    { key: 'INC-1051', title: 'Core switch 10.0.0.1 unreachable', description: 'Core switch not responding to SNMP or ping. Possible link/hardware fault.', severity: 'critical', priority: 1, category: 'network', assignee: 'neteng@vectis.io', assetHint: '10.0.0.1', ageH: 0.5, slaH: 1 },
    { key: 'INC-1039', title: 'nginx service down on web-01', description: 'HTTP health check failing on web-01; nginx appears stopped.', severity: 'high', priority: 2, category: 'service', assignee: 'web-team@vectis.io', assetHint: 'web-01', ageH: 2, slaH: 4 },
    { key: 'CHG-208', title: 'Rotate expiring TLS certificate on api-gw', description: 'Certificate on api-gw expires in 5 days. Change request to rotate.', severity: 'medium', priority: 3, category: 'change', assignee: 'secops@vectis.io', assetHint: 'api-gw', ageH: 20, slaH: 96 },
    { key: 'INC-1033', title: 'Sustained high CPU on app-02', description: 'app-02 CPU pinned >90% for 30m. Cause unclear.', severity: 'medium', priority: 3, category: 'cpu', assignee: 'app-team@vectis.io', assetHint: 'app-02', ageH: 3, slaH: 8 },
    { key: 'INC-1060', title: 'Memory creep on cache-01', description: 'cache-01 memory slowly climbing; suspected leak in worker.', severity: 'low', priority: 4, category: 'memory', assignee: 'ops@vectis.io', assetHint: 'cache-01', ageH: 6, slaH: 24 },
  ];
  const ins = db.prepare(`
    INSERT INTO tickets (id,tenant_id,integration_id,external_key,title,description,severity,priority,category,status,assignee,asset_hint,autopilot_state,sla_due,created_at,updated_at)
    VALUES (@id,@tenant_id,@integration_id,@external_key,@title,@description,@severity,@priority,@category,'open',@assignee,@asset_hint,'queued',@sla_due,@created_at,@created_at)
  `);
  const tx = db.transaction(() => {
    for (const s of samples) {
      const created = now - s.ageH * HOUR;
      ins.run({
        id: randomUUID(), tenant_id: tenantId, integration_id: integrationId, external_key: s.key,
        title: s.title, description: s.description, severity: s.severity, priority: s.priority,
        category: s.category, assignee: s.assignee, asset_hint: s.assetHint,
        sla_due: created + s.slaH * HOUR, created_at: created,
      });
    }
  });
  tx();
  return samples.length;
}
