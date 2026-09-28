# Contributing to Vectis

Thanks for your interest in improving Vectis — a product of MCprojects INC.

## Getting set up

```bash
npm install
npm run dev
```

This runs the control plane (`:4000`), a collector agent, and the web app (`:5173`) together.
See the [README](README.md) for the seeded demo login and a tour of the features.

## Ground rules

- **Node.js 20+** for development. The production bundle targets Node 18+.
- Keep the server bundle-able by `esbuild` — the only native/external dependency is the SQLite
  driver. Prefer the global `fetch` (Node 18+) over adding HTTP client dependencies.
- **Never log or return secrets.** AI keys, webhook URLs, SMTP passwords, and Jira tokens are
  encrypted at rest and must never be sent to the browser or written to logs.
- Every database query is **tenant-scoped**. New tables and routes must carry `tenant_id` and
  go through `requireAuth`.
- The autopilot must only ever perform **safe, reversible, allowlisted** actions, and must
  audit every step. Anything else escalates to a human.

## Adding a ticketing connector

Implement the `TicketProvider` interface in `packages/server/src/ticketing/` (`listOpen`,
`transition`), following the Jira sync as a reference: pull open items into the local `tickets`
table and push resolutions back. The autopilot only ever works local tickets.

## Adding an AI provider

Add an adapter in `packages/server/src/ai/` behind the existing `providerChat()` shape and
register it in the provider catalog (`ai/config.ts`). Providers are reached over `fetch`; no
vendor SDK is required.

## Pull requests

1. Fork and branch from `main`.
2. Keep changes focused; include a clear description and testing notes.
3. Run `npm run build:web` and a server type-check before opening the PR.

By submitting a contribution you agree it is licensed under the project's **Apache-2.0**
license.
