// A ticket as stored locally. Real providers (ServiceNow, Jira SM, Zendesk…)
// sync their tickets into this shape; the autopilot never talks to a vendor API
// directly — only through a TicketProvider.
export interface TicketRow {
  id: string;
  tenant_id: string;
  integration_id: string | null;
  external_key: string | null;
  title: string;
  description: string | null;
  severity: string;
  priority: number | null;
  category: string | null;
  status: string;
  assignee: string | null;
  asset_hint: string | null;
  asset_id: string | null;
  autopilot_state: string;
  sla_due: number | null;
  created_at: number;
  updated_at: number;
  resolved_at: number | null;
  ai_analysis?: string | null;
}

export interface TicketProvider {
  name: string;
  /** Open/in-progress tickets to work. */
  listOpen(tenantId: string): TicketRow[];
  /** Reflect a status change back to the source system. */
  transition(ticketId: string, status: string, resolvedAt?: number | null): void;
}
