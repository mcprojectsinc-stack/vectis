import si from 'systeminformation';
import os from 'node:os';
import { managedActiveMb } from './remediate';

export interface HostSample {
  name: string;
  address: string;
  os: string;
  metrics: { name: string; value: number }[];
}

const clamp = (v: number) => Math.max(0, Math.min(100, Number.isFinite(v) ? v : 0));
const round = (v: number) => Math.round(v * 10) / 10;

/** Collect CPU / memory / disk usage for the host the agent runs on. */
export async function collectHost(): Promise<HostSample> {
  const [load, mem, fs] = await Promise.all([si.currentLoad(), si.mem(), si.fsSize()]);

  const cpu = clamp(load.currentLoad);
  // (total - available) is the most portable "really used" figure.
  const memUsage = clamp(((mem.total - mem.available) / mem.total) * 100);

  let diskUsage = 0;
  const real = fs.filter((f) => f.size > 0);
  const root = real.find((f) => f.mount === '/' || f.mount === 'C:') ?? real.sort((a, b) => b.size - a.size)[0];
  if (root) diskUsage = clamp(root.use);

  return {
    name: os.hostname(),
    address: os.hostname(),
    os: `${os.type()} ${os.release()}`,
    metrics: [
      { name: 'cpu.usage', value: round(cpu) },
      { name: 'mem.usage', value: round(memUsage) },
      { name: 'disk.usage', value: round(diskUsage) },
      { name: 'managed.mb', value: managedActiveMb() },
    ],
  };
}
