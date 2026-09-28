<div align="center">

# Vectis

**Enterprise IT troubleshooting, on autopilot.**

Open-source, plug-and-play. Sign up, drop **one agent** into your environment, connect
**any AI** and your ticketing system, and let the autopilot triage, diagnose, fix, document,
and close infrastructure issues — escalating to a human whenever there is no known-safe fix.

_A product of **MCprojects INC**._

</div>

---

Vectis watches your network, computers, servers, applications, firewalls, and databases,
turns incoming tickets into work the autopilot performs on a timer, and gives your admins an
**ask-first** assistant they can talk to in plain language. It is provider-agnostic on AI,
multi-tenant, and audited end to end.

## Highlights

- **One-agent onboarding.** A single collector agent auto-discovers the local subnet with a
  no-root TCP-connect probe, reports host metrics, and enrolls itself with a token.
- **Ticket autopilot.** Reads open tickets, triages by severity → precedence → age, diagnoses
  against playbooks, remediates safe/reversible issues, verifies, documents, and closes — or
  escalates with evidence. Every step is written to a per-ticket audit timeline.
- **Bring your own AI.** Anthropic, OpenAI, Google Gemini, Azure OpenAI / AI Foundry, GitHub
  Copilot (via an OpenAI-compatible gateway), and any local/OpenAI-compatible endpoint
  (Ollama, vLLM, LM Studio). AI powers diagnosis, the assistant, auto-documentation, and
  natural-language actions. A built-in demo AI needs no key.
- **Ask-first UX.** The Overview opens with a plain-language briefing and an "Ask Vectis" box
  instead of a wall of charts — the current best-practice direction for operational tools.
- **Real integrations.** Slack incoming webhooks and SMTP email for alerts; **Jira Service
  Management** two-way sync (pull open issues into the queue, comment resolutions back).
- **Secure by default.** JWT auth, bcrypt password hashing, per-tenant isolation, login/signup
  rate limiting, a password policy with self-service change-password, hardened HTTP headers,
  and **all provider secrets encrypted at rest** (AES-256-GCM).

## Quickstart (development)

Requires **Node.js 20+** (the production bundle runs on Node 18+).

```bash
npm install
npm run dev
```

Open **http://localhost:5173** and sign in with the seeded demo account:

```
demo@local  /  demo1234
```

`npm run dev` starts the control-plane API (`:4000`), a collector agent, and the Vectis web
app (`:5173`). The agent auto-enrolls, so the **Overview** populates with your host (and any
LAN hosts it finds) within seconds.

To see the autopilot: open **Integrations → Attach** on the _Demo tickets_ card, then open
**Tickets** and watch the queue get worked in real time. To connect a real AI, open
**Integrations → AI provider**, choose a provider, paste a key, and click **Test connection**.

## The three capabilities

### 1. Monitoring & alerting

A single agent collects host metrics (CPU / memory / disk) and auto-discovers the local subnet
with a **no-root TCP-connect probe** (a refused connection still proves a host is up — no
`ping` binary or privileges needed). The control plane stores telemetry, evaluates default
alert rules (CPU/mem/disk > 90%, host unreachable), and the Overview shows a briefing, summary
tiles, active alerts, the asset table, and live charts.

### 2. Ticket autopilot

Attach a ticketing connector and Vectis will, on a timer:

1. **Read** open tickets and **triage** them by severity, then precedence, then age.
2. **Notify** the assignee named on each ticket that it has started work.
3. **Diagnose** the issue and match it to a playbook (AI-assisted when a provider is connected).
4. If a **safe, reversible** playbook applies: **remediate → verify → document → close**,
   notifying the assignee at each step.
5. If not: **escalate** to the assignee with the evidence and a clear reason — it never takes
   an unsafe action.

**Autonomy modes** (per tenant, on the Tickets page):

| Mode | Behavior |
| --- | --- |
| `auto_safe` (default) | Auto-fix safe issues, verify, and auto-close; escalate the rest. |
| `approve` | Diagnose, then wait for an admin to approve remediation and close. |
| `diagnose` | Diagnose and write findings only — never act. |
| `paused` | Stop the autopilot. |

The connector is **pluggable**. The MVP ships a `MockProvider` (seeded sample tickets) and a
real **Jira** sync. A real ServiceNow / Zendesk / Freshservice adapter implements the same
`TicketProvider` interface against the vendor REST API — the autopilot never talks to a vendor
directly.

### 3. Provider-agnostic AI

A tenant configures **one** AI provider in Integrations. Keys live server-side, encrypted at
rest, and are never returned to the browser. The same layer powers:

- **AI-assisted diagnosis** — richer root-cause notes on tickets the autopilot works.
- **Ask Vectis** — an admin chat assistant grounded in your live inventory and tickets.
- **Auto-documentation** — human-readable resolution write-ups on the audit timeline.
- **Natural-language actions** — type a request; Vectis interprets it and files an
  approval-gated ticket that flows through the same safe autopilot.

### Does it repair without human interaction?

Partly — and by design. Triage, notification, diagnosis, verification, documentation, closing,
and escalation are all automatic. The **repair action** splits by whether Vectis actually has
presence on the affected host:

- **The agent's own host → real repair.** When a ticket's asset runs a Vectis agent, an
  approved remediation dispatches a real job to that agent, which runs an **allowlisted,
  reversible** action, reports a real measurement, and the autopilot verifies against it before
  closing. A real change to a real host **always requires one approval click**, regardless of
  autonomy mode. Try it: **Tickets → Create self-heal demo**.
- **Hosts Vectis has no agent on → diagnose + document, then simulate or escalate.** You can't
  safely repair a host you have no presence on, so those remediations are labeled
  `(simulated)` or escalated.

## Project layout

```
packages/
  server/
    src/
      db.ts               SQLite schema, seeds (demo user, alert rules, sample tickets)
      auth.ts             signup / login / JWT / change-password, multi-tenancy
      crypto.ts           AES-256-GCM encrypt/decrypt for secrets at rest
      security.ts         rate limiting + hardened HTTP headers
      alerts.ts           threshold alert-rule evaluation
      autopilot.ts        triage + playbooks + state machine + notifications + Jira sync
      ai/                 provider-agnostic chat layer (Anthropic/OpenAI/Gemini/Azure/…)
      notify/             Slack webhook + SMTP email fan-out
      ticketing/          TicketProvider interface + Mock + Jira sync
      routes/             ingest, dashboard, tickets, integrations, ai/notify/jira
  agent/                  host metrics + no-root subnet discovery + job executor
  web/                    Vectis React app (Overview, Tickets, Integrations, Assistant, Agents)
scripts/build-deploy.sh   builds the single-origin production bundle into deploy/
docs/                     DEPLOY.md (production) and GO-LIVE.md (operator guide)
```

## Configuration

All settings are environment variables (see [`.env.example`](.env.example)).

**Server**

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `4000` | API port. |
| `JWT_SECRET` | `dev-secret-change-me` | **Change in production.** Signs auth tokens. |
| `VECTIS_ENC_KEY` | _(derives from `JWT_SECRET`)_ | Master key for encrypting secrets at rest. Set a strong, stable value in production. |
| `DB_PATH` | `./data/td.sqlite` | SQLite database path. |
| `BASE_PATH` | _(empty)_ | Mount under a subpath, e.g. `/vectis`. |
| `WEB_DIST` | `./public` | Directory of the built UI to serve. |
| `AUTOPILOT_TICK_MS` | `4000` | How often the autopilot advances the queue. |
| `JIRA_SYNC_MS` | `60000` | How often Jira issues are synced. |
| `METRIC_RETENTION_HOURS` | `24` | Telemetry retention. |
| `DEMO_ORG` / `DEMO_EMAIL` / `DEMO_PASSWORD` / `DEMO_ENROLL_TOKEN` | demo values | Seeded demo account (set empties to disable in prod). |

**Agent**

| Variable | Default | Purpose |
| --- | --- | --- |
| `SERVER_URL` | `http://localhost:4000` | Control-plane URL (include `BASE_PATH` if set). |
| `ENROLL_TOKEN` | `dev-enroll-token` | Tenant enrollment token (keep secret). |
| `AGENT_NAME` | _(hostname)_ | Display name for this agent. |
| `DISCOVER` | `true` | Enable subnet discovery. |
| `COLLECT_INTERVAL_MS` | `5000` | Metric collection cadence. |
| `DISCOVER_INTERVAL_MS` | `60000` | Discovery cadence. |
| `JOB_POLL_MS` | `3000` | Remediation job poll cadence. |
| `MANAGED_DIR` | `vectis-managed` | Directory the `reclaim-disk` action manages. |

## Deploy to production

See **[docs/DEPLOY.md](docs/DEPLOY.md)** for the single-origin production build and two paths:
a generic Node host (systemd / PM2) and shared **cPanel** hosting (CloudLinux Passenger). The
bundle serves the API and the built UI from one origin and stores data in SQLite, so it runs on
modest hosting with no external database.

Once it's live, hand your operators **[docs/GO-LIVE.md](docs/GO-LIVE.md)** — a step-by-step
guide to creating a workspace, connecting an AI provider, installing the agent, and wiring up
notifications and Jira.

## Security notes

- Change `JWT_SECRET` and set a strong, stable `VECTIS_ENC_KEY`. Keep enrollment tokens secret.
- Secrets (AI keys, Slack webhook, SMTP password, Jira token) are encrypted at rest with
  AES-256-GCM and never returned to the browser.
- Auth is rate-limited; passwords are bcrypt-hashed with an 8-character minimum and
  self-service change. Discovery and monitoring are read-only; the autopilot only performs
  safe, reversible, allowlisted actions and audits every step.
- Every table is tenant-scoped. Still do a full security review before exposing the control
  plane on the public internet, and terminate TLS at your web server / proxy.

## Contributing

Issues and pull requests are welcome. See **[CONTRIBUTING.md](CONTRIBUTING.md)**. By
contributing you agree your contributions are licensed under the project's Apache-2.0 license.

## License

Licensed under the **Apache License 2.0** — see [LICENSE](LICENSE) and [NOTICE](NOTICE).
Copyright © 2026 **MCprojects INC**.

> If you intend to offer Vectis as a hosted service and want modifications by third-party
> hosts to stay open, AGPL-3.0 is the alternative worth considering; Apache-2.0 is chosen here
> for maximum adoption.
