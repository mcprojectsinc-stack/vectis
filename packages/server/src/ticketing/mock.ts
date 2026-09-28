import { db } from '../db';
import type { TicketProvider, TicketRow } from './provider';

// Demo provider: the "source system" is our own tickets table, seeded with
// samples. Swap for a ServiceNow/Jira adapter by implementing this interface
// against the vendor REST API (list open, post comment, transition/close).
export class MockProvider implements TicketProvider {
  name = 'mock';

  listOpen(tenantId: string): TicketRow[] {
    return db
      .prepare("SELECT * FROM tickets WHERE tenant_id=? AND status IN ('open','in_progress')")
      .all(tenantId) as TicketRow[];
  }

  transition(ticketId: string, status: string, resolvedAt: number | null = null): void {
    db.prepare('UPDATE tickets SET status=?, resolved_at=COALESCE(?, resolved_at), updated_at=? WHERE id=?').run(
      status,
      resolvedAt,
      Date.now(),
      ticketId,
    );
  }
}
