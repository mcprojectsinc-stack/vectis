# Deploying Vectis to production

Vectis builds into a **single-origin bundle**: one Node process serves both the API and the
built web UI, storing data in SQLite. That runs comfortably on a small VPS, a Node PaaS, or
shared cPanel hosting — no external database required.

## 1. Build the bundle

From the repo root:

```bash
npm install
scripts/build-deploy.sh            # base path = /vectis  (subfolder deploy)
# or:
scripts/build-deploy.sh /          # base path = /         (domain / subdomain root)
```

This produces `deploy/`:

```
deploy/
  app.cjs                    the whole server, bundled by esbuild (startup file)
  package.json               declares the one external dependency (better-sqlite3)
  public/                    the built UI (already prefixed with your base path)
  data/                      SQLite DB is created here at runtime (keep writable)
  better-sqlite3-shim.js     WASM fallback driver (see §4 — only needed on old-glibc hosts)
```

The base path is **baked into the UI at build time**, so pick it before building. A subdomain
root (`/`) is the simplest, most robust choice; a subfolder (`/vectis`) is fine too.

## 2. Set the environment

Copy [`.env.example`](../.env.example) and set at minimum:

- `JWT_SECRET` — a long random string (**required**; signs logins).
- `VECTIS_ENC_KEY` — a strong, **stable** key for encrypting stored secrets. If you skip it,
  a key is derived from `JWT_SECRET`; either way, do not change it later or stored provider
  secrets become undecryptable and must be re-entered.
- `BASE_PATH` — `/vectis` for a subfolder deploy, empty for a root/subdomain deploy.
- Set the `DEMO_*` values to empty strings to disable the seeded demo login before going public.

## 3. Path A — a Node host (VPS / PaaS) — recommended

On any host with **Node 18+** and a modern glibc (Ubuntu 20.04+, Debian 11+, most PaaS), the
native SQLite driver installs from a prebuilt binary and you need nothing special.

```bash
cd deploy
npm install                        # installs better-sqlite3 (prebuilt)
JWT_SECRET=... VECTIS_ENC_KEY=... BASE_PATH= node app.cjs
```

Put it behind your web server for TLS and keep it running with **systemd** or **PM2**:

```ini
# /etc/systemd/system/vectis.service
[Unit]
Description=Vectis
After=network.target
[Service]
WorkingDirectory=/opt/vectis/deploy
ExecStart=/usr/bin/node app.cjs
Environment=JWT_SECRET=change-me
Environment=VECTIS_ENC_KEY=change-me-too
Environment=BASE_PATH=
Restart=always
User=vectis
[Install]
WantedBy=multi-user.target
```

```nginx
# reverse proxy (subdomain root)
server {
  server_name vectis.example.com;
  location / { proxy_pass http://127.0.0.1:4000; proxy_set_header Host $host; }
}
```

Then `systemctl enable --now vectis` and point DNS + TLS at it. Health check:
`https://…/api/health` returns JSON.

## 4. Path B — shared cPanel hosting (CloudLinux Passenger)

Needs a plan with **Setup Node.js App** (Passenger), Node **18+**.

1. **Upload.** File Manager → create `~/vectis`, upload the contents of `deploy/` into it and
   **Extract**, so `app.cjs`, `package.json`, and `public/` sit directly inside `vectis/`.
   Do **not** upload `node_modules`.
2. **Create the app.** Setup Node.js App → Create Application → Application root `vectis`,
   Application URL your domain (+ path `vectis` for a subfolder), Startup file `app.cjs`,
   mode Production.
3. **Environment.** Add `JWT_SECRET`, `VECTIS_ENC_KEY`, and `BASE_PATH=/vectis` (omit
   `BASE_PATH` if Passenger already strips the subpath — see Troubleshooting). Do **not** set
   `PORT`; Passenger provides it.
4. **Dependencies.** Click **Run NPM Install** to install `better-sqlite3`, then **Restart**.

### If `better-sqlite3` fails to build (old glibc)

Many shared hosts run an older glibc than the prebuilt `better-sqlite3` binary needs — the
symptom is a startup error like `GLIBC_2.29 not found`, or a native build that fails because
the host's Python/toolchain is too old. Vectis ships a **pure-WASM fallback** that is a
drop-in for `better-sqlite3` and needs no native build. Install it once, from cPanel →
**Terminal**, after entering the app's virtual environment (the "Enter to the virtual
environment" command is shown on the Node.js App page):

```bash
cd ~/vectis
# 1. install the WASM SQLite engine as a real dependency
npm install node-sqlite3-wasm
# 2. put the shim where require('better-sqlite3') will find it
mkdir -p node_modules/better-sqlite3
cp better-sqlite3-shim.js node_modules/better-sqlite3/index.js
cat > node_modules/better-sqlite3/package.json <<'JSON'
{ "name": "better-sqlite3", "version": "0.0.0-wasm-shim", "main": "index.js" }
JSON
```

Then restart Passenger:

```bash
mkdir -p ~/vectis/tmp && touch ~/vectis/tmp/restart.txt
```

The shim (`better-sqlite3-shim.js`) implements the small slice of the `better-sqlite3` API
Vectis uses, backed by `node-sqlite3-wasm`, and clears any stale write-lock left by a killed
process on startup. Behavior is identical; performance is more than sufficient for this
workload.

> On some cPanel setups `node_modules` is a symlink into a per-app virtualenv. If so, the
> steps above still work — just don't delete that directory. To **update** the app later,
> replace only `app.cjs` and `public/`; leave `node_modules/` and `data/` in place so the DB
> and the driver survive the upgrade.

## 5. Updating a live deploy

Rebuild, then ship **only** `app.cjs` and `public/` (leave `data/` and `node_modules/`
untouched), and restart:

```bash
# on the host, after uploading the new app.cjs + public/
rm -rf ~/vectis/public.old && mv ~/vectis/public ~/vectis/public.old
# …extract the new public/ and app.cjs…
mkdir -p ~/vectis/tmp && touch ~/vectis/tmp/restart.txt   # cPanel/Passenger
# or: systemctl restart vectis                            # systemd
```

## Troubleshooting

- **Blank page / 404 on assets under a subpath** — Passenger is already stripping the base
  path. Remove the `BASE_PATH` variable (leave it empty) and restart. The UI is built for its
  base either way.
- **503 / "Application failed to start"** — check `~/vectis/stderr.log`. Usually deps weren't
  installed or the startup file isn't `app.cjs`.
- **"database is locked" after a crash** — the WASM engine's lock dir was orphaned; the shim
  clears it on startup, so just restart. (Native `better-sqlite3` doesn't have this case.)
- **Secrets won't decrypt after a redeploy** — `VECTIS_ENC_KEY` (or `JWT_SECRET`, if you rely
  on derivation) changed. Set it back, or re-enter the provider keys in Integrations.

## No agent runs on the web host

The dashboard, auth, AI, integrations, and the ticket autopilot all run on the control plane.
To get **real** host metrics and the real self-heal path, run the collector agent on machines
you control, pointed at this server — see **[GO-LIVE.md](GO-LIVE.md)**.
