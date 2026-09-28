import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { agentConfig } from './config';

export interface AgentState {
  agentId: string;
  agentKey: string;
}

// The agent persists its identity so it enrolls only once, then reuses it.
export function loadState(): AgentState | null {
  try {
    if (existsSync(agentConfig.statePath)) {
      return JSON.parse(readFileSync(agentConfig.statePath, 'utf8')) as AgentState;
    }
  } catch {
    /* ignore corrupt state, re-enroll */
  }
  return null;
}

export function saveState(state: AgentState): void {
  try {
    writeFileSync(agentConfig.statePath, JSON.stringify(state, null, 2));
  } catch (e) {
    console.error('[agent] could not persist state:', (e as Error).message);
  }
}
