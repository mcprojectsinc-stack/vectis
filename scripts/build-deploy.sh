#!/usr/bin/env bash
# Build a single-origin production bundle for cPanel "Setup Node.js App".
# Usage: scripts/build-deploy.sh [BASE]
#   BASE defaults to /vectis/  (use  /  for a subdomain/root deploy)
set -euo pipefail
BASE="${1:-/vectis/}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "==> Building frontend (base=$BASE)"
VITE_BASE="$BASE" npm -w @td/web run build

echo "==> Bundling server (external: better-sqlite3)"
npx --yes esbuild packages/server/src/index.ts \
  --bundle --platform=node --target=node18 --format=cjs \
  --external:better-sqlite3 --outfile=deploy/app.cjs

echo "==> Assembling deploy/"
rm -rf deploy/public
mkdir -p deploy/public deploy/data
cp -r packages/web/dist/* deploy/public/

cat > deploy/package.json <<'JSON'
{
  "name": "vectis",
  "version": "0.2.0",
  "private": true,
  "description": "Vectis control plane — production bundle (serves the API and the built UI).",
  "main": "app.cjs",
  "scripts": { "start": "node app.cjs" },
  "dependencies": { "better-sqlite3": "^11.8.1" },
  "engines": { "node": ">=18" }
}
JSON

echo "==> Done. Bundle is in deploy/ — see deploy/INSTALL.md"
