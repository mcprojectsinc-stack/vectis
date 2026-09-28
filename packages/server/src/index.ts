import express from 'express';
import cors from 'cors';
import path from 'node:path';
import fs from 'node:fs';
import { config } from './config';
import { seed, pruneMetrics } from './db';
import { authRouter } from './auth';
import { ingestRouter } from './routes/ingest';
import { dashboardRouter } from './routes/dashboard';
import { ticketsRouter } from './routes/tickets';
import { aiRouter } from './routes/ai';
import { startAutopilot } from './autopilot';
import { securityHeaders } from './security';

seed();

const app = express();
app.use(cors());
app.use(securityHeaders);
app.use(express.json({ limit: '4mb' }));

// Mount everything under an optional base path (e.g. "/vectis" for a subfolder
// deploy; empty for a domain/subdomain root).
const b = (process.env.BASE_PATH || '').replace(/\/+$/, '');

app.get(`${b}/api/health`, (_req, res) => res.json({ ok: true, service: 'td-control-plane', ts: Date.now() }));
app.use(`${b}/api/auth`, authRouter);
app.use(`${b}/api`, ingestRouter); // enroll, ingest, agent jobs
app.use(`${b}/api`, dashboardRouter);
app.use(`${b}/api`, ticketsRouter);
app.use(`${b}/api`, aiRouter);

// Serve the built frontend for single-origin production. Skipped in dev (no build present).
const webDir = process.env.WEB_DIST || path.join(process.cwd(), 'public');
if (fs.existsSync(path.join(webDir, 'index.html'))) {
  app.use(b || '/', express.static(webDir));
  if (b) app.get(b, (_req, res) => res.redirect(`${b}/`));
  app.get(`${b}/*`, (req, res, next) => {
    if (req.path.startsWith(`${b}/api`)) return next();
    res.sendFile(path.join(webDir, 'index.html'));
  });
  console.log(`[server] serving web UI from ${webDir} at ${b || '/'}`);
}

const port = process.env.PORT || config.port;
app.listen(port, () => {
  console.log(`[server] control plane on http://localhost:${port}${b || ''}`);
  console.log(`[server] demo login:  ${config.demo.email} / ${config.demo.password}`);
  console.log(`[server] enroll token: ${config.demo.enrollToken}`);
});

setInterval(pruneMetrics, 10 * 60_000);
startAutopilot();
