import { mkdirSync, readdirSync, statSync, writeFileSync, renameSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { agentConfig } from './config';

// A Vectis-managed working directory the agent is allowed to operate on. Real
// remediation only ever touches this directory — never arbitrary system paths.
const DIR = resolve(agentConfig.managedDir);
const TRASH = join(DIR, '.trash');

function ensure() {
  mkdirSync(DIR, { recursive: true });
  mkdirSync(TRASH, { recursive: true });
}

/** Bytes of active (non-quarantined) files in the managed directory. */
export function managedActiveBytes(): number {
  ensure();
  let total = 0;
  for (const name of readdirSync(DIR)) {
    if (name === '.trash') continue;
    try {
      const st = statSync(join(DIR, name));
      if (st.isFile()) total += st.size;
    } catch {
      /* ignore */
    }
  }
  return total;
}

export function managedActiveMb(): number {
  return Math.round((managedActiveBytes() / 1048576) * 10) / 10;
}

// Only these actions may run on the host. Anything else is refused.
const ALLOWLIST = new Set(['reclaim-disk', 'fill-disk-demo']);

export interface JobResult {
  status: 'done' | 'failed';
  result: Record<string, unknown>;
}

export async function runAction(action: string, params: Record<string, unknown>): Promise<JobResult> {
  if (!ALLOWLIST.has(action)) return { status: 'failed', result: { error: `action '${action}' is not in the agent allowlist` } };
  ensure();
  try {
    if (action === 'fill-disk-demo') {
      const mb = Math.min(Math.max(Number(params?.mb ?? 40), 1), 200);
      const chunk = Buffer.alloc(1048576, 1); // 1 MB
      for (let i = 0; i < mb; i++) writeFileSync(join(DIR, `demo-${Date.now()}-${i}.bin`), chunk);
      return { status: 'done', result: { createdMb: mb, activeMbAfter: managedActiveMb() } };
    }
    if (action === 'reclaim-disk') {
      const before = managedActiveBytes();
      let moved = 0;
      for (const name of readdirSync(DIR)) {
        if (name === '.trash') continue;
        const src = join(DIR, name);
        try {
          if (statSync(src).isFile()) {
            renameSync(src, join(TRASH, `${Date.now()}-${name}`)); // reversible: quarantined, not deleted
            moved++;
          }
        } catch {
          /* ignore */
        }
      }
      const after = managedActiveBytes();
      return {
        status: 'done',
        result: {
          freedMb: Math.round(((before - after) / 1048576) * 10) / 10,
          activeMbAfter: Math.round((after / 1048576) * 10) / 10,
          movedFiles: moved,
        },
      };
    }
    return { status: 'failed', result: { error: 'unhandled action' } };
  } catch (e) {
    return { status: 'failed', result: { error: (e as Error).message } };
  }
}
