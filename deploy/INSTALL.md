# Deploying Vectis to cPanel (mcprojectsinc.com/vectis)

This bundle is a single-origin production build: one Node process serves both the
API and the built UI. It needs a cPanel plan with **Setup Node.js App** (Passenger),
Node **18+**. If your plan has no "Setup Node.js App" and no Terminal, this app can't
run there — host it on a Node platform instead (see the last section).

## What's in this bundle

```
app.cjs        the whole server, bundled (Passenger startup file)
package.json   one native dependency (better-sqlite3), installed on the host
public/        the built web UI (already points at /vectis/…)
data/          SQLite database is created here at runtime (must stay writable)
INSTALL.md     this file
```

## Steps

### 1. Upload
- cPanel → **File Manager** → create the folder `vectis` in your home directory (`/home/<user>/vectis`).
- Upload this bundle's contents into `/home/<user>/vectis` and **Extract**, so that
  `app.cjs`, `package.json`, and `public/` sit **directly** inside `vectis/`
  (not inside a nested subfolder). Do **not** upload `node_modules`.

### 2. Create the Node.js app
- cPanel → **Setup Node.js App** → **Create Application**:
  - **Node.js version:** 18, 20, or 22
  - **Application mode:** Production
  - **Application root:** `vectis`
  - **Application URL:** choose `mcprojectsinc.com` and enter path `vectis`
  - **Application startup file:** `app.cjs`
- Click **Create**.

### 3. Set environment variables
On the app's page, add (**Add Variable**):
- `BASE_PATH` = `/vectis`
- `JWT_SECRET` = a long random string (**change this** — it signs logins)
- *(optional)* `DEMO_EMAIL`, `DEMO_PASSWORD`, `DEMO_ENROLL_TOKEN` to change the seeded demo login/token

Do **not** set `PORT` — Passenger provides it.

### 4. Install dependencies
- On the same page click **Run NPM Install** (installs `better-sqlite3`). Wait for success.
- If that button errors: copy the "Enter to the virtual environment" command shown on
  the page, run it in cPanel → **Terminal**, then run `npm install`.

### 5. Start
- Click **Restart** (or Start). Then open **https://www.mcprojectsinc.com/vectis**.
- Log in with `demo@local` / `demo1234` (or your `DEMO_*` values).
- Health check: `https://www.mcprojectsinc.com/vectis/api/health` should return JSON.

## Troubleshooting

- **Blank page or 404s on assets/API under /vectis** — your Passenger already strips
  the base path. Fix: **remove** the `BASE_PATH` variable (leave it empty) and
  **Restart**. (The UI is built for `/vectis/` either way, so nothing else changes.)
- **503 / "Application failed to start"** — open the app's stderr log (link on the
  Node.js App page, or `~/vectis/stderr.log`). Usually npm install wasn't run, or the
  startup file isn't `app.cjs`.
- **better-sqlite3 fails to install** — use Node 18 or 20 (they have prebuilt
  binaries); if the host blocks native modules, use the Node-platform option below.

## Notes

- **No agent runs on the web host.** The dashboard, login, and the ticket autopilot
  (working the mock ITSM tickets) all work. To get real host metrics and the real
  self-heal, run the agent on a machine you control, pointed at this server:
  from the full Vectis source, `SERVER_URL=https://www.mcprojectsinc.com/vectis
  ENROLL_TOKEN=<token from the "Add agent" page> npm run start:agent`.
- **Change the demo credentials** before sharing the URL (set `DEMO_*`, or create a
  real account and remove the demo user).

## Prefer a subdomain? (simplest, most robust)

A subdomain root avoids all base-path ambiguity. Create `vectis.mcprojectsinc.com`
(document root `~/vectis`), rebuild the bundle with `scripts/build-deploy.sh /`
(root base), set the Application URL to the subdomain, and leave `BASE_PATH` unset.

## Alternative: no Node on cPanel

If your plan can't run Node, deploy the same bundle to a Node host (Render, Railway,
Fly.io, or a small VPS): run `npm install` then `node app.cjs` with `JWT_SECRET` set
and `BASE_PATH` empty, and point `mcprojectsinc.com/vectis` (a reverse proxy) or a
subdomain at it.
