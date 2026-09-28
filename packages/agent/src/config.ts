// Agent configuration, all overridable by environment variables.
export const agentConfig = {
  serverUrl: process.env.SERVER_URL ?? 'http://localhost:4000',
  enrollToken: process.env.ENROLL_TOKEN ?? 'dev-enroll-token',
  name: process.env.AGENT_NAME ?? '', // defaults to the hostname at runtime
  collectIntervalMs: Number(process.env.COLLECT_INTERVAL_MS ?? 5000),
  discoverIntervalMs: Number(process.env.DISCOVER_INTERVAL_MS ?? 60000),
  discoverEnabled: (process.env.DISCOVER ?? 'true') !== 'false',
  statePath: process.env.AGENT_STATE_PATH ?? '.agent-state.json',
  managedDir: process.env.MANAGED_DIR ?? 'vectis-managed',
  jobPollMs: Number(process.env.JOB_POLL_MS ?? 3000),
  version: '0.2.0',
};
