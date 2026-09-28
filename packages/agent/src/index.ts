import os from 'node:os';
import { agentConfig } from './config';
import { loadState, saveState, type AgentState } from './state';
import { collectHost } from './collect';
import { discoverSubnet, primaryIPv4, roleFromPorts } from './discover';
import { runAction } from './remediate';

const agentName = agentConfig.name || os.hostname();
let state: AgentState | null = loadState();
let lastDiscovered: unknown[] = [];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function enroll(): Promise<AgentState> {
  const res = await fetch(`${agentConfig.serverUrl}/api/enroll`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      token: agentConfig.enrollToken,
      name: agentName,
      os: `${os.type()} ${os.release()}`,
      version: agentConfig.version,
    }),
  });
  if (!res.ok) throw new Error(`enroll failed: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { agentId: string; agentKey: string; tenant?: { name: string } };
  const s = { agentId: data.agentId, agentKey: data.agentKey };
  saveState(s);
  console.log(`[agent] enrolled as "${agentName}" into tenant "${data.tenant?.name ?? '?'}"`);
  return s;
}

async function ensureEnrolled(): Promise<AgentState> {
  if (state) return state;
  for (;;) {
    try {
      state = await enroll();
      return state;
    } catch (e) {
      console.error('[agent]', (e as Error).message, '— retrying in 5s');
      await sleep(5000);
    }
  }
}

async function sendIngest(assets: unknown[]): Promise<void> {
  const s = await ensureEnrolled();
  const res = await fetch(`${agentConfig.serverUrl}/api/ingest`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-agent-id': s.agentId, 'x-agent-key': s.agentKey },
    body: JSON.stringify({ ts: Date.now(), assets }),
  });
  if (res.status === 401) {
    console.warn('[agent] credentials rejected — will re-enroll');
    state = null;
    return;
  }
  if (!res.ok) console.error('[agent] ingest failed:', res.status, await res.text());
}

async function collectLoop(): Promise<void> {
  try {
    const host = await collectHost();
    const self = {
      type: 'server',
      name: host.name,
      address: host.address,
      status: 'up',
      labels: { role: 'self', os: host.os },
      metrics: host.metrics,
    };
    await sendIngest([self, ...lastDiscovered]);
  } catch (e) {
    console.error('[agent] collect error:', (e as Error).message);
  }
}

async function discoverLoop(): Promise<void> {
  if (!agentConfig.discoverEnabled) return;
  try {
    const p = primaryIPv4();
    if (!p) {
      console.warn('[agent] no external IPv4 interface found; skipping discovery');
      return;
    }
    console.log(`[agent] scanning ${p.cidrBase}.0/24 ...`);
    const hosts = await discoverSubnet(p.ip);
    lastDiscovered = hosts.map((h) => ({
      type: 'server',
      name: h.address,
      address: h.address,
      status: 'up',
      labels: { role: roleFromPorts(h.openPorts), ports: h.openPorts.join(',') || 'none', discovered: 'subnet-scan' },
      metrics: [
        { name: 'reachable', value: 1 },
        ...(h.latencyMs != null ? [{ name: 'latency.ms', value: h.latencyMs }] : []),
      ],
    }));
    console.log(`[agent] found ${lastDiscovered.length} reachable host(s) on ${p.cidrBase}.0/24`);
  } catch (e) {
    console.error('[agent] discover error:', (e as Error).message);
  }
}

// Poll for remediation jobs and execute allowlisted actions on this host.
async function jobPoll(): Promise<void> {
  const s = state;
  if (!s) return;
  try {
    const res = await fetch(`${agentConfig.serverUrl}/api/agent/jobs`, {
      headers: { 'x-agent-id': s.agentId, 'x-agent-key': s.agentKey },
    });
    if (res.status === 401) { state = null; return; }
    if (!res.ok) return;
    const data = (await res.json()) as { jobs?: { id: string; action: string; params: Record<string, unknown> }[] };
    for (const job of data.jobs ?? []) {
      console.log(`[agent] executing remediation job: ${job.action}`);
      const out = await runAction(job.action, job.params ?? {});
      await fetch(`${agentConfig.serverUrl}/api/agent/jobs/${job.id}/result`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-agent-id': s.agentId, 'x-agent-key': s.agentKey },
        body: JSON.stringify(out),
      });
      console.log(`[agent] job ${job.action} -> ${out.status}`, JSON.stringify(out.result));
    }
  } catch {
    /* transient */
  }
}

async function main(): Promise<void> {
  console.log(`[agent] starting; server=${agentConfig.serverUrl}, discovery=${agentConfig.discoverEnabled}`);
  await ensureEnrolled();
  await discoverLoop(); // first scan before the first metric push
  await collectLoop();
  setInterval(collectLoop, agentConfig.collectIntervalMs);
  setInterval(discoverLoop, agentConfig.discoverIntervalMs);
  setInterval(jobPoll, agentConfig.jobPollMs);
}

main();
