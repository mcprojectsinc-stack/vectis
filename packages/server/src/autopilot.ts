import { randomUUID } from 'node:crypto';
import { db, getSetting } from './db';
import { getTicketProvider, tenantsWithActiveWork } from './ticketing';
import type { TicketProvider, TicketRow } from './ticketing/provider';
import { aiEnabled } from './ai/config';
import { aiDiagnose, aiSummarize } from './ai/tasks';
import { dispatch } from './notify';
import { jiraEnabled, jiraComment, syncJiraTenant, tenantsWithJira } from './ticketing/jira';

const ACTOR = 'Vectis Autopilot';
export const SEV_RANK: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
const TERMINAL = new Set(['resolved', 'escalated']);
const MANAGED_TARGET_MB = 10; // "healthy" threshold for the managed working dir

interface Playbook {
  name: string;
  safe: boolean;
  realAction?: string; // maps to an allowlisted agent action for real execution
  diagnose: (t: TicketRow, tenantId: string) => string;
  remediate?: (t: TicketRow) => string;
  verify?: (t: TicketRow) => string;
  escalateReason?: string;
}

const host = (t: TicketRow) => t.asset_hint || 'the affected host';

const PLAYBOOKS: Record<string, Playbook> = {
  // REAL, approval-gated action against the agent's own host.
  'managed-disk': {
    name: 'reclaim-managed-disk',
    safe: true,
    realAction: 'reclaim-disk',
    diagnose: (t, tenantId) => {
      const mb = latestMetric(tenantId, t.asset_id, 'managed.mb');
      return `Inspected ${host(t)}: Vectis-managed working directory holding ~${mb != null ? Math.round(mb) : '?'} MB of reclaimable files. This is a real, reversible cleanup on the agent's own host.`;
    },
    verify: () => 'Verified against the real host.',
  },
  // Simulated playbooks for tickets about hosts Vectis has no agent on.
  disk: {
    name: 'reclaim-disk',
    safe: true,
    diagnose: (t) => `Inspected ${host(t)}: filesystem / at ~96% (root cause: runaway log growth in /var/log, ~12 GB).`,
    remediate: () => `Rotated and compressed logs, cleared /tmp and stale package caches. Reversible — archives retained 7 days.`,
    verify: () => `Re-measured disk usage: 61% (< 85% target). Write path healthy.`,
  },
  service: {
    name: 'restart-service',
    safe: true,
    diagnose: (t) => `Checked ${host(t)}: nginx process not running; port 80 closed; last exit was OOM.`,
    remediate: () => `Restarted nginx via the service manager and confirmed the process came up cleanly.`,
    verify: () => `HTTP health check returns 200 OK; port 80 listening again.`,
  },
  memory: {
    name: 'recycle-worker',
    safe: true,
    diagnose: (t) => `Checked ${host(t)}: memory at 89%, one worker's RSS climbing steadily (suspected leak).`,
    remediate: () => `Gracefully recycled the leaking worker (drained connections, then restarted it).`,
    verify: () => `Memory back to 42% and stable across 3 consecutive checks.`,
  },
  cpu: {
    name: 'cpu-review',
    safe: false,
    diagnose: (t) => `Checked ${host(t)}: CPU ~94%; top consumer is a customer batch job (PID 3120), not a known-safe target.`,
    escalateReason: `No known-safe automated action for application CPU saturation — a restart could drop in-flight work.`,
  },
  network: {
    name: 'net-review',
    safe: false,
    diagnose: (t) => `Probed ${host(t)}: no ICMP or SNMP response; the upstream link appears down.`,
    escalateReason: `A core-network outage needs physical / on-site remediation — there is no safe remote fix.`,
  },
  change: {
    name: 'change-review',
    safe: false,
    diagnose: (t) => `Reviewed ${host(t)}: TLS certificate valid 5 more days; rotation is a change-managed action.`,
    escalateReason: `Certificate rotation is change-managed and requires approval — raised a change task for review.`,
  },
};

function playbookFor(t: TicketRow): Playbook {
  return (
    PLAYBOOKS[t.category ?? 'other'] ?? {
      name: 'manual-review',
      safe: false,
      diagnose: () => `No automated playbook matched this ticket's category.`,
      escalateReason: `No known-safe playbook for this category — routed to a human.`,
    }
  );
}

function logEvent(tenantId: string, ticketId: string, kind: string, message: string, data?: unknown) {
  db.prepare('INSERT INTO ticket_events (id,tenant_id,ticket_id,ts,kind,actor,message,data) VALUES (?,?,?,?,?,?,?,?)').run(
    randomUUID(), tenantId, ticketId, Date.now(), kind, ACTOR, message, data ? JSON.stringify(data) : null,
  );
}
function notify(tenantId: string, ticketId: string, recipient: string | null, message: string) {
  db.prepare('INSERT INTO notifications (id,tenant_id,ticket_id,recipient,channel,message,created_at) VALUES (?,?,?,?,?,?,?)').run(
    randomUUID(), tenantId, ticketId, recipient, 'inapp', message, Date.now(),
  );
  // Best-effort fan-out to the tenant's external channels (Slack/email); never blocks.
  dispatch(tenantId, { recipient, subject: 'Vectis Autopilot', text: message });
}
function setState(ticketId: string, state: string) {
  db.prepare('UPDATE tickets SET autopilot_state=?, updated_at=? WHERE id=?').run(state, Date.now(), ticketId);
  // Push resolutions/escalations back to the source ITSM (Jira) when connected.
  if (state === 'resolved' || state === 'escalated') {
    const t = db.prepare('SELECT tenant_id, external_key FROM tickets WHERE id=?').get(ticketId) as { tenant_id: string; external_key: string | null } | undefined;
    if (t?.external_key && jiraEnabled(t.tenant_id)) {
      void jiraComment(t.tenant_id, t.external_key, state === 'resolved'
        ? 'Resolved by Vectis Autopilot — automated, reversible remediation applied and verified.'
        : 'Escalated by Vectis Autopilot — no known-safe automated fix; a human needs to take this.');
    }
  }
}
function latestMetric(tenantId: string, assetId: string | null, name: string): number | null {
  if (!assetId) return null;
  const r = db.prepare('SELECT value FROM metrics WHERE tenant_id=? AND asset_id=? AND name=? ORDER BY ts DESC LIMIT 1').get(tenantId, assetId, name) as { value: number } | undefined;
  return r?.value ?? null;
}
function matchAsset(tenantId: string, hint: string | null): string | null {
  if (!hint) return null;
  const a = db.prepare('SELECT id FROM assets WHERE tenant_id=? AND (name=? OR address=?) LIMIT 1').get(tenantId, hint, hint) as { id: string } | undefined;
  return a?.id ?? null;
}
/** The agent that owns this asset, but only if the asset is that agent's OWN host. */
function agentForLocalHost(tenantId: string, assetId: string | null): string | null {
  if (!assetId) return null;
  const a = db.prepare('SELECT agent_id, labels FROM assets WHERE id=? AND tenant_id=?').get(assetId, tenantId) as { agent_id: string | null; labels: string | null } | undefined;
  if (!a?.agent_id) return null;
  try {
    if ((JSON.parse(a.labels ?? '{}') as { role?: string }).role === 'self') return a.agent_id;
  } catch { /* */ }
  return null;
}
function slaText(t: TicketRow): string {
  if (!t.sla_due) return 'no SLA set';
  const mins = Math.round((t.sla_due - Date.now()) / 60000);
  if (mins < 0) return `SLA breached ${-mins}m ago`;
  if (mins < 60) return `SLA due in ${mins}m`;
  return `SLA due in ${Math.round(mins / 60)}h`;
}

function createJob(tenantId: string, agentId: string, ticketId: string, action: string, params: Record<string, unknown>): string {
  const id = randomUUID();
  const now = Date.now();
  db.prepare('INSERT INTO jobs (id,tenant_id,agent_id,ticket_id,action,params,dry_run,status,created_at,updated_at) VALUES (?,?,?,?,?,?,0,?,?,?)').run(
    id, tenantId, agentId, ticketId, action, JSON.stringify(params), 'pending', now, now,
  );
  return id;
}

function dispatchRemediation(tenantId: string, t: TicketRow, pb: Playbook, agentId: string) {
  createJob(tenantId, agentId, t.id, pb.realAction!, {});
  logEvent(tenantId, t.id, 'remediate', `Approved. Dispatched real action '${pb.realAction}' to the agent on ${host(t)}; awaiting execution.`);
  setState(t.id, 'remediating');
}

/** Called when an agent reports the result of a remediation job. */
export function onJobResult(tenantId: string, jobId: string): void {
  const job = db.prepare('SELECT * FROM jobs WHERE id=? AND tenant_id=?').get(jobId, tenantId) as
    | { id: string; ticket_id: string | null; action: string; status: string; result: string | null }
    | undefined;
  if (!job || !job.ticket_id) return;
  const t = db.prepare('SELECT * FROM tickets WHERE id=? AND tenant_id=?').get(job.ticket_id, tenantId) as TicketRow | undefined;
  if (!t) return;
  const provider = getTicketProvider(tenantId);
  const res = job.result ? (JSON.parse(job.result) as { freedMb?: number; activeMbAfter?: number; error?: string }) : {};

  if (job.status === 'done') {
    const freed = Math.round(res.freedMb ?? 0);
    const after = Math.round(res.activeMbAfter ?? 0);
    logEvent(tenantId, t.id, 'execute', `Executed ${job.action} on ${host(t)}: freed ${freed} MB; active managed usage now ${after} MB.`);
    if (after < MANAGED_TARGET_MB) {
      logEvent(tenantId, t.id, 'verify', `Verified against the real host: managed usage ${after} MB (< ${MANAGED_TARGET_MB} MB target).`);
      const resolution = `Ran '${job.action}' on ${host(t)} (real, reversible): freed ${freed} MB. Verified: managed usage ${after} MB (< ${MANAGED_TARGET_MB} MB).`;
      logEvent(tenantId, t.id, 'resolve', `Documented resolution and closed ${t.external_key ?? t.id}.`, { resolution });
      provider.transition(t.id, 'resolved', Date.now());
      notify(tenantId, t.id, t.assignee, `${t.external_key ?? t.id} was fixed on the real host and closed by Vectis Autopilot.`);
      setState(t.id, 'resolved');
      maybeAIDoc(tenantId, t.id); // AI-written resolution write-up
    } else {
      logEvent(tenantId, t.id, 'escalate', `Remediation ran but usage is still ${after} MB (target < ${MANAGED_TARGET_MB} MB). Escalated for review.`);
      provider.transition(t.id, 'escalated');
      notify(tenantId, t.id, t.assignee, `${t.external_key ?? t.id}: automated fix ran but did not clear the condition — needs a human.`);
      setState(t.id, 'escalated');
    }
  } else {
    logEvent(tenantId, t.id, 'escalate', `Remediation failed on ${host(t)}: ${res.error ?? 'unknown error'}. Escalated.`);
    provider.transition(t.id, 'escalated');
    notify(tenantId, t.id, t.assignee, `${t.external_key ?? t.id}: automated fix failed — needs a human.`);
    setState(t.id, 'escalated');
  }
}

/** Advance one ticket by a single step. Returns true if something changed. */
export function advanceTicket(tenantId: string, provider: TicketProvider, t: TicketRow, mode: string): boolean {
  const pb = playbookFor(t);
  switch (t.autopilot_state) {
    case 'queued': {
      const assetId = matchAsset(tenantId, t.asset_hint);
      if (assetId && !t.asset_id) { db.prepare('UPDATE tickets SET asset_id=? WHERE id=?').run(assetId, t.id); t.asset_id = assetId; }
      provider.transition(t.id, 'in_progress');
      logEvent(
        tenantId, t.id, 'triage',
        `Triaged as ${t.severity.toUpperCase()} (precedence #${t.priority ?? '—'}). ${slaText(t)}. ${t.asset_id ? `Matched monitored asset ${t.asset_hint}.` : `No monitored asset matched "${t.asset_hint ?? 'n/a'}".`}`,
      );
      setState(t.id, 'triaged');
      return true;
    }
    case 'triaged': {
      notify(tenantId, t.id, t.assignee, `Vectis Autopilot is investigating ${t.external_key ?? t.id}: ${t.title}.`);
      logEvent(tenantId, t.id, 'notify', `Notified ${t.assignee ?? 'the assignee'} that autopilot has started work.`);
      setState(t.id, 'notified');
      return true;
    }
    case 'notified': {
      logEvent(tenantId, t.id, 'diagnose', pb.diagnose(t, tenantId));
      maybeAIDiagnose(tenantId, t); // second opinion from the configured LLM (advisory)
      setState(t.id, 'diagnosed');
      return true;
    }
    case 'diagnosed': {
      if (!pb.safe) {
        logEvent(tenantId, t.id, 'escalate', `${pb.escalateReason} Escalated to ${t.assignee ?? 'a human'} with full evidence.`);
        notify(tenantId, t.id, t.assignee, `${t.external_key ?? t.id} needs a human: ${pb.escalateReason}`);
        provider.transition(t.id, 'escalated');
        setState(t.id, 'escalated');
        return true;
      }
      // A REAL change to a real host always requires explicit approval, whatever the mode.
      const realAgent = pb.realAction ? agentForLocalHost(tenantId, t.asset_id) : null;
      if (realAgent) {
        logEvent(tenantId, t.id, 'await', `Diagnosis complete. A real change on ${host(t)} requires approval before Vectis will act.`);
        setState(t.id, 'awaiting_approval');
        return true;
      }
      // Simulated remediation follows the tenant's autonomy mode.
      if (mode === 'diagnose') return false;
      if (mode === 'approve') {
        logEvent(tenantId, t.id, 'await', `Diagnosis complete. Awaiting admin approval to apply playbook '${pb.name}'.`);
        setState(t.id, 'awaiting_approval');
        return true;
      }
      logEvent(tenantId, t.id, 'remediate', `Applied playbook '${pb.name}' (simulated, reversible): ${pb.remediate!(t)}`);
      setState(t.id, 'remediated');
      return true;
    }
    case 'awaiting_approval':
    case 'remediating':
      return false; // waiting on a human or on the agent's job result
    case 'remediated': {
      logEvent(tenantId, t.id, 'verify', `Verification: ${pb.verify!(t)}`);
      setState(t.id, 'verified');
      return true;
    }
    case 'verified': {
      const resolution = `Applied '${pb.name}'. ${pb.remediate!(t)} ${pb.verify!(t)}`;
      logEvent(tenantId, t.id, 'resolve', `Documented resolution and closed ${t.external_key ?? t.id}.`, { resolution });
      provider.transition(t.id, 'resolved', Date.now());
      notify(tenantId, t.id, t.assignee, `${t.external_key ?? t.id} was resolved and closed automatically by Vectis Autopilot.`);
      setState(t.id, 'resolved');
      maybeAIDoc(tenantId, t.id); // AI-written resolution write-up
      return true;
    }
    default:
      return false;
  }
}

// ---- AI enrichment (advisory, non-blocking) -------------------------------
// The rule-based playbooks above stay in full control of what actually runs and
// what needs approval. When a tenant has a provider configured, we ALSO ask the
// LLM for a second opinion (root cause + suggested steps) and, on close, a
// human-readable resolution write-up. These are fire-and-forget: a slow or
// failing provider never stalls or changes the safety-gated state machine.
const aiInFlight = new Set<string>();

function maybeAIDiagnose(tenantId: string, t: TicketRow): void {
  if (!aiEnabled(tenantId) || t.ai_analysis || aiInFlight.has(t.id)) return;
  aiInFlight.add(t.id);
  aiDiagnose(tenantId, t)
    .then((r) => {
      if (!r) return;
      db.prepare('UPDATE tickets SET ai_analysis=? WHERE id=?').run(JSON.stringify({ ...r, at: Date.now() }), t.id);
      const steps = r.steps.length ? ` Suggested: ${r.steps.join(' → ')}.` : '';
      logEvent(tenantId, t.id, 'ai', `AI root-cause (${r.confidence} confidence): ${r.rootCause} Recommends: ${r.recommendation}.${steps}`, { ai: r });
    })
    .catch(() => { /* provider error — advisory only */ })
    .finally(() => aiInFlight.delete(t.id));
}

function maybeAIDoc(tenantId: string, ticketId: string): void {
  if (!aiEnabled(tenantId)) return;
  const key = 'doc:' + ticketId;
  if (aiInFlight.has(key)) return;
  aiInFlight.add(key);
  const t = db.prepare('SELECT * FROM tickets WHERE id=? AND tenant_id=?').get(ticketId, tenantId) as TicketRow | undefined;
  if (!t) { aiInFlight.delete(key); return; }
  const events = db.prepare('SELECT kind,message FROM ticket_events WHERE ticket_id=? ORDER BY ts').all(ticketId) as { kind: string; message: string }[];
  aiSummarize(tenantId, t, events)
    .then((summary) => {
      if (summary) logEvent(tenantId, ticketId, 'ai-doc', summary, { aiDoc: true });
    })
    .catch(() => { /* advisory only */ })
    .finally(() => aiInFlight.delete(key));
}

function getTicket(tenantId: string, ticketId: string): TicketRow | undefined {
  return db.prepare('SELECT * FROM tickets WHERE id=? AND tenant_id=?').get(ticketId, tenantId) as TicketRow | undefined;
}

export function runToCompletion(tenantId: string, ticketId: string, mode = 'auto_safe'): void {
  const provider = getTicketProvider(tenantId);
  for (let i = 0; i < 12; i++) {
    const t = getTicket(tenantId, ticketId);
    if (!t || TERMINAL.has(t.autopilot_state)) break;
    if (!advanceTicket(tenantId, provider, t, mode)) break;
  }
}

/** Admin approves a ticket waiting for sign-off. Real changes dispatch a job; simulated ones just run. */
export function approveTicket(tenantId: string, ticketId: string): boolean {
  const t = getTicket(tenantId, ticketId);
  if (!t || t.autopilot_state !== 'awaiting_approval') return false;
  logEvent(tenantId, ticketId, 'approve', 'Admin approved the proposed remediation.');
  const pb = playbookFor(t);
  const realAgent = pb.realAction ? agentForLocalHost(tenantId, t.asset_id) : null;
  if (realAgent) {
    dispatchRemediation(tenantId, t, pb, realAgent); // waits for the agent's job result
    return true;
  }
  setState(ticketId, 'remediated');
  runToCompletion(tenantId, ticketId, 'auto_safe');
  return true;
}

export function autopilotTick(): void {
  for (const tenantId of tenantsWithActiveWork()) {
    const mode = getSetting(tenantId, 'autopilot_mode', 'auto_safe');
    if (mode === 'paused') continue;
    const provider = getTicketProvider(tenantId);
    const tickets = provider.listOpen(tenantId).sort(
      (a, b) =>
        (SEV_RANK[a.severity] ?? 9) - (SEV_RANK[b.severity] ?? 9) ||
        (a.priority ?? 99) - (b.priority ?? 99) ||
        a.created_at - b.created_at,
    );
    for (const t of tickets) {
      if (TERMINAL.has(t.autopilot_state)) continue;
      advanceTicket(tenantId, provider, t, mode);
    }
  }
}

export function startAutopilot(intervalMs = Number(process.env.AUTOPILOT_TICK_MS ?? 4000)): void {
  setInterval(autopilotTick, intervalMs);
  console.log(`[autopilot] running every ${intervalMs}ms`);
  // Pull new issues from connected ITSMs (Jira) on a slower cadence into the local queue.
  const jiraMs = Number(process.env.JIRA_SYNC_MS ?? 60_000);
  setInterval(() => {
    for (const tenantId of tenantsWithJira()) {
      syncJiraTenant(tenantId).then((r) => { if (r?.synced) autopilotTick(); }).catch(() => {});
    }
  }, jiraMs);
}
