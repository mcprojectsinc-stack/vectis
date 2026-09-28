import { db } from '../db';
import { MockProvider } from './mock';
import type { TicketProvider } from './provider';

export type { TicketProvider, TicketRow } from './provider';

/**
 * Resolve the ticketing provider for a tenant. Tickets are stored locally, so a
 * MockProvider always works; a configured integration would pick a real adapter.
 */
export function getTicketProvider(tenantId: string): TicketProvider {
  const integ = db
    .prepare("SELECT provider FROM integrations WHERE tenant_id=? AND kind='ticketing' AND status='connected' ORDER BY created_at LIMIT 1")
    .get(tenantId) as { provider: string } | undefined;
  // Real adapters would be constructed here from the integration's config:
  // if (integ?.provider === 'servicenow') return new ServiceNowProvider(config);
  void integ;
  return new MockProvider();
}

/** Tenants the autopilot should service: any with a ticketing integration OR open tickets. */
export function tenantsWithActiveWork(): string[] {
  const rows = db
    .prepare(
      `SELECT tenant_id FROM integrations WHERE kind='ticketing' AND status='connected'
       UNION
       SELECT tenant_id FROM tickets WHERE status IN ('open','in_progress')`,
    )
    .all() as { tenant_id: string }[];
  return [...new Set(rows.map((r) => r.tenant_id))];
}
