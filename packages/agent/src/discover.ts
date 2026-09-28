import net from 'node:net';
import os from 'node:os';

export interface DiscoveredHost {
  address: string;
  up: boolean;
  latencyMs: number | null;
  openPorts: number[];
}

// Common service ports we probe. A connection that is accepted OR actively
// refused proves the host is up — no ICMP/ping and no root privileges needed.
const PROBE_PORTS = [22, 80, 443, 3389, 3306, 5432, 8080, 445, 53];
const CONCURRENCY = 32;

export function primaryIPv4(): { ip: string; cidrBase: string } | null {
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const ni of ifaces[name] ?? []) {
      if (ni.family === 'IPv4' && !ni.internal) {
        return { ip: ni.address, cidrBase: ni.address.split('.').slice(0, 3).join('.') };
      }
    }
  }
  return null;
}

type PortResult = 'open' | 'refused' | 'down';

function probePort(host: string, port: number, timeout = 400): Promise<PortResult> {
  return new Promise((resolve) => {
    const sock = new net.Socket();
    let settled = false;
    const finish = (r: PortResult) => {
      if (settled) return;
      settled = true;
      sock.destroy();
      resolve(r);
    };
    sock.setTimeout(timeout);
    sock.once('connect', () => finish('open'));
    sock.once('timeout', () => finish('down'));
    sock.once('error', (err: NodeJS.ErrnoException) => finish(err.code === 'ECONNREFUSED' ? 'refused' : 'down'));
    sock.connect(port, host);
  });
}

export async function probeHost(address: string): Promise<DiscoveredHost> {
  const start = Date.now();
  const results = await Promise.all(PROBE_PORTS.map((p) => probePort(address, p)));
  const up = results.some((r) => r === 'open' || r === 'refused');
  const openPorts = PROBE_PORTS.filter((_, i) => results[i] === 'open');
  return { address, up, latencyMs: up ? Date.now() - start : null, openPorts };
}

/** Sweep the /24 around the agent's own IP and return the hosts that respond. */
export async function discoverSubnet(selfIp: string): Promise<DiscoveredHost[]> {
  const base = selfIp.split('.').slice(0, 3).join('.');
  const targets: string[] = [];
  for (let i = 1; i <= 254; i++) {
    const ip = `${base}.${i}`;
    if (ip !== selfIp) targets.push(ip);
  }
  const found: DiscoveredHost[] = [];
  for (let i = 0; i < targets.length; i += CONCURRENCY) {
    const batch = targets.slice(i, i + CONCURRENCY);
    const res = await Promise.all(batch.map((ip) => probeHost(ip)));
    for (const h of res) if (h.up) found.push(h);
  }
  return found;
}

/** Guess a coarse role from the open ports we saw. */
export function roleFromPorts(ports: number[]): string {
  if (ports.includes(3306) || ports.includes(5432)) return 'database';
  if (ports.includes(80) || ports.includes(443) || ports.includes(8080)) return 'web';
  if (ports.includes(3389)) return 'windows';
  if (ports.includes(445)) return 'file-share';
  if (ports.includes(53)) return 'dns';
  if (ports.includes(22)) return 'ssh-host';
  return 'host';
}
