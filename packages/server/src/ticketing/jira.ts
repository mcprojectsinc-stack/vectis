import { randomUUID } from 'node:crypto';
import { db, getSetting, setSetting } from '../db';
import { encryptSecret, decryptSecret } from '../crypto';

// Real ITSM integration. The autopilot only ever works LOCAL tickets, so this module
// SYNCS Jira issues into the local tickets table and pushes resolutions back to Jira.
// Inert unless a tenant has configured Jira (base URL + email + API token).

export interface JiraPublic { enabled: boolean; baseUrl: string; email: string; jql: string; hasToken: boolean }
interface JiraStored { enabled?: boolean; baseUrl?: string; email?: string; jql?: string }

function read(tenantId: string): JiraStored {
  try { return JSON.parse(getSetting(tenantId, 'jira', '') || '{}'); } catch { return {}; }
}
export function readJiraPublic(tenantId: string): JiraPublic {
  const s = read(tenantId);
  return {
    enabled: !!s.enabled, baseUrl: s.baseUrl || '', email: s.email || '',
    jql: s.jql || 'statusCategory != Done ORDER BY priority DESC',
    hasToken: !!getSetting(tenantId, 'jira_token', ''),
  };
}
export function writeJira(tenantId: string, input: any): void {
  const cur = read(tenantId);
  setSetting(tenantId, 'jira', JSON.stringify({
    enabled: input.enabled ?? cur.enabled ?? false,
    baseUrl: (input.baseUrl ?? cur.baseUrl ?? '').replace(/\/+$/, ''),
    email: input.email ?? cur.email ?? '',
    jql: input.jql ?? cur.jql ?? '',
  }));
  if (typeof input.token === 'string' && input.token.trim()) setSetting(tenantId, 'jira_token', encryptSecret(input.token.trim()));
}
export function jiraEnabled(tenantId: string): boolean {
  const s = read(tenantId);
  return !!(s.enabled && s.baseUrl && s.email && getSetting(tenantId, 'jira_token', ''));
}

/** Tenant IDs that have Jira settings, for the periodic sync loop. */
export function tenantsWithJira(): string[] {
  const rows = db.prepare("SELECT tenant_id FROM settings WHERE key='jira'").all() as { tenant_id: string }[];
  return rows.map((r) => r.tenant_id).filter(jiraEnabled);
}

function auth(tenantId: string, s: JiraStored): string {
  const token = decryptSecret(getSetting(tenantId, 'jira_token', ''));
  return 'Basic ' + Buffer.from(`${s.email}:${token}`).toString('base64');
}
async function jFetch(url: string, headers: Record<string, string>, init: RequestInit = {}) {
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 20_000);
  try { return await fetch(url, { ...init, headers: { ...headers, accept: 'application/json' }, signal: ctrl.signal }); }
  finally { clearTimeout(t); }
}

const SEV_FROM_PRIORITY: Record<string, string> = { Highest: 'critical', High: 'high', Medium: 'medium', Low: 'low', Lowest: 'low' };
function categoryFor(text: string): string {
  const t = text.toLowerCase();
  if (/disk|storage|/.test(t) && /disk|storage|space/.test(t)) return 'disk';
  if (/nginx|service|down|http|500|crash/.test(t)) return 'service';
  if (/cpu|load/.test(t)) return 'cpu';
  if (/memory|leak|oom|ram/.test(t)) return 'memory';
  if (/network|switch|unreachable|ping|link/.test(t)) return 'network';
  if (/cert|tls|rotate|change|deploy/.test(t)) return 'change';
  return 'other';
}

/** Pull open Jira issues and upsert them into the local tickets table for this tenant. */
export async function syncJiraTenant(tenantId: string): Promise<{ synced: number } | null> {
  if (!jiraEnabled(tenantId)) return null;
  const s = read(tenantId);
  const headers = { authorization: auth(tenantId, s) };
  const jql = encodeURIComponent(s.jql || 'statusCategory != Done ORDER BY priority DESC');
  const res = await jFetch(`${s.baseUrl}/rest/api/3/search?jql=${jql}&maxResults=50&fields=summary,priority,assignee,status,labels,duedate`, headers);
  if (!res.ok) throw new Error(`Jira ${res.status}`);
  const data = await res.json() as { issues?: any[] };
  const issues = data.issues || [];
  // Ensure an integration row exists so the autopilot services this tenant.
  let integ = db.prepare("SELECT id FROM integrations WHERE tenant_id=? AND kind='ticketing' AND provider='jira'").get(tenantId) as { id: string } | undefined;
  if (!integ) {
    const id = randomUUID();
    db.prepare('INSERT INTO integrations (id,tenant_id,kind,provider,config,status,created_at) VALUES (?,?,?,?,?,?,?)').run(id, tenantId, 'ticketing', 'jira', '{}', 'connected', Date.now());
    integ = { id };
  }
  const now = Date.now();
  const upsert = db.prepare(`
    INSERT INTO tickets (id,tenant_id,integration_id,external_key,title,description,severity,priority,category,status,assignee,asset_hint,autopilot_state,sla_due,created_at,updated_at)
    VALUES (@id,@tenant_id,@integration_id,@external_key,@title,@description,@severity,@priority,@category,'open',@assignee,@asset_hint,'queued',@sla_due,@created_at,@created_at)
    ON CONFLICT(id) DO NOTHING
  `);
  // external_key is unique per tenant in practice; find existing by key to avoid dupes.
  const findByKey = db.prepare('SELECT id FROM tickets WHERE tenant_id=? AND external_key=?');
  let synced = 0;
  for (const iss of issues) {
    const key = iss.key as string;
    const f = iss.fields || {};
    const title = f.summary || key;
    const sev = SEV_FROM_PRIORITY[f.priority?.name] || 'medium';
    const assignee = f.assignee?.emailAddress || f.assignee?.displayName || null;
    const asset = (title.match(/\b([a-z0-9-]+\d[a-z0-9-]*)\b/i) || [])[1] || null;
    const existing = findByKey.get(tenantId, key) as { id: string } | undefined;
    if (existing) continue; // already tracked; the autopilot owns its lifecycle locally
    upsert.run({
      id: randomUUID(), tenant_id: tenantId, integration_id: integ.id, external_key: key,
      title, description: `Synced from Jira (${key}).`, severity: sev,
      priority: sev === 'critical' ? 1 : sev === 'high' ? 2 : sev === 'medium' ? 3 : 4,
      category: categoryFor(title), assignee, asset_hint: asset,
      sla_due: f.duedate ? Date.parse(f.duedate) : now + 8 * 3600_000, created_at: now,
    });
    synced++;
  }
  return { synced };
}

/** Push a resolution/escalation back to the Jira issue as a comment (best-effort). */
export async function jiraComment(tenantId: string, externalKey: string, body: string): Promise<void> {
  if (!jiraEnabled(tenantId) || !externalKey) return;
  const s = read(tenantId);
  const headers = { authorization: auth(tenantId, s), 'content-type': 'application/json' };
  await jFetch(`${s.baseUrl}/rest/api/3/issue/${encodeURIComponent(externalKey)}/comment`, headers, {
    method: 'POST',
    body: JSON.stringify({ body: { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text: body }] }] } }),
  }).catch(() => {});
}
