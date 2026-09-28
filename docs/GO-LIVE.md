# Vectis go-live guide

A step-by-step walkthrough for taking a fresh Vectis instance live: create your workspace,
connect an AI provider, put an agent on your infrastructure, and wire up notifications and
ticketing. Takes about 15 minutes.

Assumes Vectis is already deployed and reachable (see [DEPLOY.md](DEPLOY.md)). Examples use a
subfolder deploy at `https://www.example.com/vectis`; drop the `/vectis` if you deployed at a
domain/subdomain root.

---

## 1. Create your workspace

1. Open your Vectis URL and click **Create your workspace**.
2. Enter your organization name, a work email, and a password (**8+ characters**).
3. You land in your own tenant — isolated from every other workspace on the instance.

> The instance may ship with a seeded demo login. Before you share the URL, disable it: set the
> `DEMO_*` environment variables to empty strings (see DEPLOY.md) and restart.

Change your password any time under **Integrations → Account & security**.

## 2. Connect an AI provider

AI powers assisted diagnosis, the **Ask Vectis** assistant, auto-documentation, and
natural-language actions. It is optional — a built-in demo AI works with no key — but a real
provider is what makes the assistant genuinely useful.

1. Go to **Integrations → AI provider**.
2. Pick your provider and fill in what it asks for:

   | Provider | You provide |
   | --- | --- |
   | **Anthropic (Claude)** | API key + model (e.g. `claude-sonnet-4-5`) |
   | **OpenAI** | API key + model (e.g. `gpt-4o-mini`) |
   | **Google Gemini** | API key + model (e.g. `gemini-1.5-flash`) |
   | **Azure OpenAI / AI Foundry** | API key + endpoint URL + your deployment name |
   | **GitHub Copilot** | Base URL of an OpenAI-compatible Copilot gateway (see below) |
   | **Local / OpenAI-compatible** | Base URL (e.g. Ollama `http://localhost:11434/v1`) + model |
   | **Built-in demo AI** | nothing — no key needed |

3. Click **Test connection**. A green result means Vectis reached the provider.
4. Tick **Enabled** and **Save**.

Your key is stored **encrypted at rest** on the server and is never sent back to the browser.

**GitHub Copilot note:** GitHub retired its direct Models API, so Copilot is reached by running
an OpenAI-compatible Copilot gateway (it uses your Copilot subscription) and pointing **Base
URL** at it, e.g. `http://localhost:4141/v1`. Azure AI Foundry works too — just pick "Azure
OpenAI / AI Foundry".

## 3. Put an agent on your infrastructure

The control plane runs without an agent, but real host metrics, subnet discovery, and the real
self-heal path come from the **collector agent**. Run one agent per network segment you want to
see; it discovers the rest of the subnet itself.

1. Go to **Agents** (or **Add agent**) and copy your **enrollment token**. Keep it secret —
   anyone with it can enroll an agent into your workspace.
2. On a machine you control (Node 18+), from the Vectis source:

   ```bash
   SERVER_URL=https://www.example.com/vectis \
   ENROLL_TOKEN=<your token> \
   AGENT_NAME=edge-01 \
   npm run start:agent
   ```

   Use your real base URL (include `/vectis` if you deployed to a subfolder). The agent
   enrolls, starts reporting CPU/memory/disk, and probes the local subnet with a no-root
   TCP-connect scan.
3. Within seconds the **Overview** shows the host and any LAN neighbors it found, with live
   charts and any threshold alerts.

**Keep it running** with systemd or PM2 the same way as the server (see DEPLOY.md), setting the
three environment variables above. To turn off discovery on a sensitive segment, add
`DISCOVER=false`.

## 4. Turn on notifications (optional)

Under **Integrations → Notifications**, wire up where the autopilot sends resolution and
escalation alerts. Both channels are optional and independent.

- **Slack** — paste an [incoming webhook URL](https://api.slack.com/messaging/webhooks), tick
  Slack, **Save**, then **Test Slack** to post a test message to the channel.
- **Email** — tick Email and fill in SMTP host, port, username, password, and a From address
  (use port 465 with "Use TLS on connect", or 587 without). **Save**, then **Test email** to
  verify the credentials.

Webhook URLs and SMTP passwords are encrypted at rest and never returned to the browser.

## 5. Connect ticketing

The autopilot works a **ticket queue**. Choose one:

**Jira Service Management (two-way sync).** Under **Integrations → Jira Service Management**:

1. Create an API token at `id.atlassian.com → Security → API tokens`.
2. Enter your **Base URL** (`https://your-org.atlassian.net`), the **account email** that owns
   the token, the **token**, and an optional **JQL filter** (default: open issues by priority).
3. Tick **Enabled**, **Save**, then **Sync now**.

Vectis pulls matching open issues into its queue every minute; the autopilot works them and
**comments the resolution or escalation back to the Jira issue**.

**Just trying it out?** Skip Jira — open **Integrations → Ticketing** and click **Attach** on
the _Demo tickets_ card for a realistic seeded queue.

## 6. Watch the autopilot work

Open **Tickets**. On a timer, Vectis triages by severity → precedence → age, notifies the
assignee, diagnoses (AI-assisted when a provider is connected), and then either fixes → verifies
→ documents → closes, or escalates with evidence. Every step is written to a per-ticket audit
timeline.

Set the **autonomy mode** (top-right, per workspace) to match your comfort level:

| Mode | Behavior |
| --- | --- |
| `auto_safe` (default) | Auto-fix safe issues, verify, and auto-close; escalate the rest. |
| `approve` | Diagnose, then wait for an admin to approve remediation and close. |
| `diagnose` | Diagnose and write findings only — never act. |
| `paused` | Stop the autopilot. |

A **real** change to a real host (a ticket whose asset runs your agent) always requires one
approval click, whatever the mode. Try the whole loop end-to-end with **Tickets → Create
self-heal demo**: it stages a real disk condition on the agent host, files a ticket, and — after
you click **Approve** — the agent genuinely quarantines the files and the ticket closes on a
verified measurement.

You can also just **ask**: use **Ask Vectis** (top of the Overview, or the Assistant page) to
type a request in plain language. Vectis interprets it and files an approval-gated ticket that
flows through the same safe autopilot.

## Going-public checklist

- [ ] `JWT_SECRET` and `VECTIS_ENC_KEY` set to strong, stable values.
- [ ] Demo login disabled (`DEMO_*` empty) once you have a real account.
- [ ] TLS terminated at your web server / proxy; only HTTPS exposed.
- [ ] Enrollment token treated as a secret; rotated if it ever leaked.
- [ ] An AI provider connected and **Test connection** green (or demo AI intentionally kept).
- [ ] At least one agent running and reporting on the Overview.
- [ ] Notifications tested (Slack and/or email) if you rely on them.
- [ ] Ticketing connected (Jira synced, or demo tickets attached).
- [ ] Autonomy mode set to your intended level.

---

_Vectis — a product of MCprojects INC. Licensed under Apache-2.0._
