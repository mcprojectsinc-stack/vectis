// Small inline SVG icon set (no external icon dependency).
export function Logo({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect width="24" height="24" rx="6" fill="#4f46e5" />
      <path d="M6 7l6 10 6-10" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const base = {
  width: 18,
  height: 18,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

export const IconOverview = () => (
  <svg {...base} aria-hidden>
    <rect x="3" y="3" width="7" height="7" rx="1.5" />
    <rect x="14" y="3" width="7" height="7" rx="1.5" />
    <rect x="3" y="14" width="7" height="7" rx="1.5" />
    <rect x="14" y="14" width="7" height="7" rx="1.5" />
  </svg>
);

export const IconTickets = () => (
  <svg {...base} aria-hidden>
    <path d="M4 7a2 2 0 012-2h12a2 2 0 012 2v2a2 2 0 000 6v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2a2 2 0 000-6V7z" />
    <path d="M13 5.5v13" strokeDasharray="2 2" />
  </svg>
);

export const IconIntegrations = () => (
  <svg {...base} aria-hidden>
    <path d="M10 3v5M14 3v5M8 8h8v3a4 4 0 01-8 0V8zM12 15v6" />
  </svg>
);

export const IconAgents = () => (
  <svg {...base} aria-hidden>
    <rect x="3" y="4" width="18" height="7" rx="1.5" />
    <rect x="3" y="13" width="18" height="7" rx="1.5" />
    <path d="M7 7.5h.01M7 16.5h.01" />
  </svg>
);

export const IconBell = () => (
  <svg {...base} aria-hidden>
    <path d="M6 8a6 6 0 1112 0c0 7 3 8 3 8H3s3-1 3-8" />
    <path d="M10.5 21a2 2 0 003 0" />
  </svg>
);

export const IconAssistant = () => (
  <svg {...base} aria-hidden>
    <path d="M4 5.5A1.5 1.5 0 015.5 4h13A1.5 1.5 0 0120 5.5v9A1.5 1.5 0 0118.5 16H9l-4 4v-4H5.5A1.5 1.5 0 014 14.5v-9z" />
    <path d="M12 8.2l.7 1.6 1.6.7-1.6.7-.7 1.6-.7-1.6L9.7 10.5l1.6-.7z" />
  </svg>
);
