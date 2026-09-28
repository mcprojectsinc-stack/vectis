import { db } from '../db';
import type { TicketRow } from '../ticketing/provider';
import { providerChat, type ChatMsg } from './providers';
import { readAIConfigFull, aiEnabled } from './config';

// Pull just enough JSON out of an LLM reply, tolerating ```json fences / prose.
function parseJSON<T = any>(raw: string): T | null {
  if (!raw) return null;
  const fenced = raw.replace(/```(?:json)?/gi, '').trim();
  const s = fenced.indexOf('{');
  const e = fenced.lastIndexOf('}');
  if (s === -1 || e === -1 || e < s) return null;
  try { return JSON.parse(fenced.slice(s, e + 1)) as T; } catch { return null; }
}

function metricsFor(tenantId: string, assetId: string | null): string {
  if (!assetId) return 'no monitored asset matched';
  const rows = db
    .prepare('SELECT name, value, ts FROM metrics WHERE tenant_id=? AND asset_id=? ORDER BY ts DESC LIMIT 12')
    .all(tenantId, assetId) as { name: string; value: number; ts: number }[];
  if (!rows.length) return 'no recent metrics';
  const latest: Record<string, number> = {};
  for (const r of rows) if (!(r.name in latest)) latest[r.name] = r.value;
  return Object.entries(latest).map(([k, v]) => `${k}=${Math.round(v * 100) / 100}`).join(', ');
}

function ticketBrief(tenantId: string, t: TicketRow): string {
  return [
    `key: ${t.external_key ?? t.id}`,
    `title: ${t.title}`,
    `description: ${t.description ?? ''}`,
    `severity: ${t.severity}  priority: ${t.priority ?? '-'}  category: ${t.category ?? '-'}`,
    `host: ${t.asset_hint ?? 'unknown'}`,
    `recent metrics: ${metricsFor(tenantId, t.asset_id)}`,
  ].join('\n');
}

export interface AIDiagnosis { rootCause: string; steps: string[]; recommendation: string; confidence: string }

export async function aiDiagnose(tenantId: string, t: TicketRow): Promise<AIDiagnosis | null> {
  if (!aiEnabled(tenantId)) return null;
  const cfg = readAIConfigFull(tenantId);
  const system =
    'You are Vectis, an expert SRE/IT incident troubleshooter. Analyze the incident and reply with ONLY compact root-cause JSON: ' +
    '{"rootCause": string, "steps": string[], "recommendation": "auto-remediate"|"escalate", "confidence": "high"|"medium"|"low"}. ' +
    'Prefer safe, reversible steps. Recommend "escalate" when no known-safe automated fix exists (e.g. hardware/network outage, CPU saturation from business jobs, change-controlled work).';
  const raw = await providerChat(cfg, { system, messages: [{ role: 'user', content: ticketBrief(tenantId, t) }], maxTokens: 600 });
  const j = parseJSON<AIDiagnosis>(raw);
  if (!j || !j.rootCause) return null;
  return {
    rootCause: String(j.rootCause),
    steps: Array.isArray(j.steps) ? j.steps.map(String).slice(0, 6) : [],
    recommendation: /escal/i.test(String(j.recommendation)) ? 'escalate' : 'auto-remediate',
    confidence: ['high', 'medium', 'low'].includes(String(j.confidence)) ? String(j.confidence) : 'medium',
  };
}

export async function aiSummarize(tenantId: string, t: TicketRow, events: { kind: string; message: string }[]): Promise<string | null> {
  if (!aiEnabled(tenantId)) return null;
  const cfg = readAIConfigFull(tenantId);
  const system = 'You are Vectis. Write a concise resolution summary / runbook entry (3-5 sentences) for the closed incident: what was wrong, what was done, how it was verified, and one preventive follow-up. Plain prose, no markdown headings.';
  const log = events.map((e) => `- ${e.kind}: ${e.message}`).join('\n');
  const raw = await providerChat(cfg, {
    system,
    messages: [{ role: 'user', content: `${ticketBrief(tenantId, t)}\n\nAutopilot actions:\n${log}` }],
    maxTokens: 400,
  });
  return raw?.trim() || null;
}

function infraContext(tenantId: string): string {
  const assets = db.prepare('SELECT type,name,status FROM assets WHERE tenant_id=? ORDER BY type,name LIMIT 40').all(tenantId) as { type: string; name: string; status: string }[];
  const openT = db.prepare("SELECT external_key,title,severity,autopilot_state FROM tickets WHERE tenant_id=? AND status IN ('open','in_progress') ORDER BY created_at DESC LIMIT 20").all(tenantId) as { external_key: string; title: string; severity: string; autopilot_state: string }[];
  const alerts = db.prepare("SELECT COUNT(*) c FROM alerts WHERE tenant_id=? AND state IN ('firing','acknowledged')").get(tenantId) as { c: number };
  const a = assets.length ? assets.map((x) => `${x.type}/${x.name}(${x.status})`).join(', ') : 'none discovered yet';
  const tk = openT.length ? openT.map((x) => `${x.external_key} [${x.severity}] ${x.title} — autopilot:${x.autopilot_state}`).join('\n') : 'none open';
  return `Assets (${assets.length}): ${a}\nFiring alerts: ${alerts.c}\nOpen tickets:\n${tk}`;
}

export async function aiChat(tenantId: string, messages: ChatMsg[]): Promise<string> {
  const cfg = readAIConfigFull(tenantId);
  const system =
    'You are the Vectis assistant, embedded in an IT troubleshooting dashboard. Answer questions about the infrastructure, tickets, alerts and what the autopilot is doing, using the live context below. ' +
    'Be concise and practical. If asked to change something, explain that real changes run through the approval-gated autopilot.\n\n--- LIVE CONTEXT ---\n' +
    infraContext(tenantId);
  return providerChat(cfg, { system, messages: messages.slice(-12), maxTokens: 700 });
}

export interface AIProposal { understood: string; action: string; host: string; category: string; rationale: string }

export async function aiPropose(tenantId: string, text: string): Promise<AIProposal | null> {
  if (!aiEnabled(tenantId)) return null;
  const cfg = readAIConfigFull(tenantId);
  const system =
    'You map a natural-language IT request to ONE remediation action and reply with ONLY JSON (propose an action): ' +
    '{"understood": string, "action": "reclaim-disk"|"restart-service"|"recycle-worker"|"investigate", "host": string, "category": "disk"|"service"|"memory"|"other", "rationale": string}. ' +
    'Pick "investigate" if unclear. The action will run through an approval-gated autopilot, never immediately.';
  const raw = await providerChat(cfg, { system, messages: [{ role: 'user', content: text }], maxTokens: 300 });
  const j = parseJSON<AIProposal>(raw);
  if (!j || !j.action) return null;
  const action = ['reclaim-disk', 'restart-service', 'recycle-worker', 'investigate'].includes(j.action) ? j.action : 'investigate';
  const category = action === 'reclaim-disk' ? 'disk' : action === 'restart-service' ? 'service' : action === 'recycle-worker' ? 'memory' : 'other';
  return { understood: String(j.understood || text), action, host: String(j.host || 'unspecified'), category, rationale: String(j.rationale || '') };
}

/** A minimal round-trip used by the "Test connection" button. */
export async function aiPing(cfg: { provider: string; model: string; baseUrl?: string; apiKey?: string }): Promise<string> {
  return providerChat(cfg, { system: 'Reply with the single word: ok', messages: [{ role: 'user', content: 'ping' }], maxTokens: 8 });
}
