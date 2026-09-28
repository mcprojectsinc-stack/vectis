// Central config, all overridable by environment variables.
export const config = {
  port: Number(process.env.PORT ?? 4000),
  jwtSecret: process.env.JWT_SECRET ?? 'dev-secret-change-me',
  dbPath: process.env.DB_PATH ?? './data/td.sqlite',
  metricRetentionHours: Number(process.env.METRIC_RETENTION_HOURS ?? 24),
  // A demo tenant + user is seeded so `npm run dev` shows data immediately.
  demo: {
    orgName: process.env.DEMO_ORG ?? 'Demo Org',
    email: process.env.DEMO_EMAIL ?? 'demo@local',
    password: process.env.DEMO_PASSWORD ?? 'demo1234',
    enrollToken: process.env.DEMO_ENROLL_TOKEN ?? 'dev-enroll-token',
  },
};
