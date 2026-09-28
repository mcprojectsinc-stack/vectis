import { useEffect, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { api } from '../lib/api';

// Fixed categorical order (validated for CVD separation). Identity is always
// carried by the legend text, not by color alone.
const SERIES = [
  { key: 'cpu', metric: 'cpu.usage', color: '#2563eb', label: 'CPU %' },
  { key: 'mem', metric: 'mem.usage', color: '#f59e0b', label: 'Memory %' },
  { key: 'disk', metric: 'disk.usage', color: '#14b8a6', label: 'Disk %' },
];

const fmtTime = (ts: number) =>
  new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

export default function UsageChart({ assetId }: { assetId: string }) {
  const [data, setData] = useState<Record<string, number>[]>([]);

  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const results = await Promise.all(
          SERIES.map((s) => api(`/assets/${assetId}/metrics?name=${s.metric}&minutes=30`)),
        );
        const byTs: Record<number, Record<string, number>> = {};
        results.forEach((r: { points: { ts: number; value: number }[] }, i: number) => {
          for (const p of r.points) (byTs[p.ts] ??= { ts: p.ts })[SERIES[i].key] = p.value;
        });
        const merged = Object.values(byTs).sort((a, b) => a.ts - b.ts);
        if (alive) setData(merged);
      } catch {
        /* transient */
      }
    }
    load();
    const id = setInterval(load, 5000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [assetId]);

  if (!data.length) return <div className="chart-empty muted">Waiting for metrics… (host agents report CPU/memory/disk)</div>;

  return (
    <ResponsiveContainer width="100%" height={230}>
      <LineChart data={data} margin={{ top: 8, right: 18, bottom: 4, left: -18 }}>
        <CartesianGrid stroke="var(--grid)" vertical={false} />
        <XAxis dataKey="ts" tickFormatter={fmtTime} stroke="var(--ink-muted)" fontSize={11} tickLine={false} minTickGap={48} />
        <YAxis domain={[0, 100]} stroke="var(--ink-muted)" fontSize={11} tickLine={false} width={40} unit="%" />
        <Tooltip
          contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid var(--border)' }}
          labelFormatter={fmtTime}
          formatter={(v: number, n: string) => [`${v}%`, n]}
        />
        <Legend />
        {SERIES.map((s) => (
          <Line
            key={s.key}
            type="monotone"
            dataKey={s.key}
            name={s.label}
            stroke={s.color}
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
            connectNulls
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}
