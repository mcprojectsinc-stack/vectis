// Status/severity use reserved colors AND an icon + text label — never color alone.

function Badge({ cls, icon, label }: { cls: string; icon: string; label: string }) {
  return (
    <span className={`badge ${cls}`}>
      <span className="dot" aria-hidden>{icon}</span>
      {label}
    </span>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { cls: string; icon: string; label: string }> = {
    up: { cls: 'ok', icon: '●', label: 'Up' },
    down: { cls: 'crit', icon: '▼', label: 'Down' },
    unknown: { cls: 'neutral', icon: '○', label: 'Unknown' },
  };
  return <Badge {...(map[status] ?? map.unknown)} />;
}

export function SeverityBadge({ severity }: { severity: string }) {
  const map: Record<string, { cls: string; icon: string; label: string }> = {
    critical: { cls: 'crit', icon: '✕', label: 'Critical' },
    warning: { cls: 'warn', icon: '!', label: 'Warning' },
    info: { cls: 'info', icon: 'i', label: 'Info' },
  };
  return <Badge {...(map[severity] ?? map.info)} />;
}

export function TicketSeverityBadge({ severity }: { severity: string }) {
  const map: Record<string, { cls: string; icon: string; label: string }> = {
    critical: { cls: 'crit', icon: '✕', label: 'Critical' },
    high: { cls: 'high', icon: '▲', label: 'High' },
    medium: { cls: 'warn', icon: '●', label: 'Medium' },
    low: { cls: 'neutral', icon: '▪', label: 'Low' },
  };
  return <Badge {...(map[severity] ?? map.low)} />;
}

export function TicketStatusBadge({ status }: { status: string }) {
  const map: Record<string, { cls: string; icon: string; label: string }> = {
    open: { cls: 'neutral', icon: '○', label: 'Open' },
    in_progress: { cls: 'info', icon: '◐', label: 'In progress' },
    resolved: { cls: 'ok', icon: '✓', label: 'Resolved' },
    closed: { cls: 'ok', icon: '✓', label: 'Closed' },
    escalated: { cls: 'crit', icon: '↥', label: 'Escalated' },
  };
  return <Badge {...(map[status] ?? map.open)} />;
}

export function AutopilotBadge({ state }: { state: string }) {
  const map: Record<string, { cls: string; icon: string; label: string }> = {
    queued: { cls: 'neutral', icon: '•', label: 'Queued' },
    triaged: { cls: 'info', icon: '◇', label: 'Triaged' },
    notified: { cls: 'info', icon: '◇', label: 'Notified' },
    diagnosed: { cls: 'info', icon: '◇', label: 'Diagnosed' },
    awaiting_approval: { cls: 'warn', icon: '◔', label: 'Awaiting approval' },
    remediating: { cls: 'warn', icon: '◐', label: 'Remediating' },
    remediated: { cls: 'warn', icon: '◐', label: 'Remediating' },
    verified: { cls: 'info', icon: '◐', label: 'Verifying' },
    resolved: { cls: 'ok', icon: '✓', label: 'Resolved' },
    escalated: { cls: 'crit', icon: '↥', label: 'Escalated' },
  };
  return <Badge {...(map[state] ?? map.queued)} />;
}
