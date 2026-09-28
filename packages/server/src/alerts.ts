import { randomUUID } from 'node:crypto';
import { db } from './db';

interface Rule {
  id: string;
  name: string;
  asset_type: string;
  metric: string;
  op: string;
  threshold: number;
  severity: string;
}

function isBreach(op: string, value: number, threshold: number): boolean {
  if (op === 'gt') return value > threshold;
  if (op === 'lt') return value < threshold;
  if (op === 'eq') return value === threshold;
  if (op === 'gte') return value >= threshold;
  if (op === 'lte') return value <= threshold;
  return false;
}

function symbol(op: string): string {
  return { gt: '>', lt: '<', eq: '=', gte: '>=', lte: '<=' }[op] ?? op;
}

const round = (v: number) => Math.round(v * 10) / 10;

/**
 * Evaluate every matching rule for one incoming metric point and open/resolve
 * alerts accordingly. Called for each metric on ingest.
 */
export function evaluateMetric(
  tenantId: string,
  asset: { id: string; type: string; name: string },
  metric: string,
  value: number,
  ts: number,
) {
  const rules = db
    .prepare(
      'SELECT * FROM alert_rules WHERE enabled=1 AND asset_type=? AND metric=? AND (tenant_id IS NULL OR tenant_id=?)',
    )
    .all(asset.type, metric, tenantId) as Rule[];

  for (const rule of rules) {
    const open = db
      .prepare("SELECT id FROM alerts WHERE tenant_id=? AND asset_id=? AND rule_id=? AND state IN ('firing','acknowledged')")
      .get(tenantId, asset.id, rule.id) as { id: string } | undefined;

    if (isBreach(rule.op, value, rule.threshold)) {
      const message = `${rule.name} on ${asset.name}: ${metric} = ${round(value)} (threshold ${symbol(rule.op)} ${rule.threshold})`;
      if (!open) {
        db.prepare(
          'INSERT INTO alerts (id,tenant_id,rule_id,asset_id,severity,state,message,value,started_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
        ).run(randomUUID(), tenantId, rule.id, asset.id, rule.severity, 'firing', message, value, ts, ts);
      } else {
        db.prepare('UPDATE alerts SET value=?, message=?, updated_at=? WHERE id=?').run(value, message, ts, open.id);
      }
    } else if (open) {
      db.prepare("UPDATE alerts SET state='resolved', resolved_at=?, updated_at=?, value=? WHERE id=?").run(ts, ts, value, open.id);
    }
  }
}
