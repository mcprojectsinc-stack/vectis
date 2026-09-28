interface Summary {
  assets: { total: number; up: number; down: number; unknown: number };
  alertsFiring: number;
  agents: number;
}

export default function SummaryTiles({ s }: { s: Summary | null }) {
  const tiles: { label: string; value: number | string; sub: string; tone?: string }[] = [
    { label: 'Assets', value: s?.assets.total ?? '—', sub: 'discovered' },
    { label: 'Up', value: s?.assets.up ?? '—', sub: 'reachable', tone: 'ok' },
    { label: 'Down', value: s?.assets.down ?? '—', sub: 'unreachable', tone: (s?.assets.down ?? 0) > 0 ? 'crit' : '' },
    { label: 'Active alerts', value: s?.alertsFiring ?? '—', sub: 'firing', tone: (s?.alertsFiring ?? 0) > 0 ? 'warn' : '' },
    { label: 'Agents', value: s?.agents ?? '—', sub: 'connected' },
  ];
  return (
    <div className="tiles">
      {tiles.map((t) => (
        <div className={`tile ${t.tone ?? ''}`} key={t.label}>
          <div className="tile-value">{t.value}</div>
          <div className="tile-label">{t.label}</div>
          <div className="tile-sub muted small">{t.sub}</div>
        </div>
      ))}
    </div>
  );
}
