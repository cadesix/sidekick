# Plan 12 — implementation notes (life integrations)

Boundary rule that shapes the architecture: **mobile bundles `@sidekick/shared`'s
runtime graph** (reminders.tsx + onboarding import values from it). So nothing in
shared may pull in `node:crypto` or node-only `jose`. Therefore:

- **shared/music**: interface + HTTP client + service fns + scripted client +
  resolver seam + prompt guidance. Pure `fetch` + zod + `Database` types only.
- **server/music**: dev-token minting (jose), AES-GCM token encryption
  (node:crypto), taste ingestion, real resolver registration.

## Files
Shared: `health/types.ts`, `memory/render-health.ts`, `music/{client,service,scripted,resolver,prompt}.ts`, tools/{health,music}.ts, index re-exports.
Server: `health/{sync,auto-log}.ts`, `music/{dev-token,encryption,client-factory,taste}.ts`, `memory/ad-window.ts`, routers/{health,location,music}.ts, surgical: routers/index.ts, app.ts, env.ts, services.ts, memory/render.ts, index.ts.
Mobile: `lib/{health,location,music,connections}.ts`, `components/PrePermissionSheet.tsx`, `features/connections/ConnectedSettings.tsx`, surgical: app/settings.tsx, lib/api.ts, package.json, app.json.
Tests: health-sync, ad-projection, location, music-tools, music-devtoken, music-encryption, health-render.

## Precedence (device auto-log)
`progressEvents.source`: device only writes when no event exists for
(actionItem,date) OR the existing one is itself `device`. It never overwrites
`inferred` (log_checkin) / `user_stated` / `manual` → the user's word wins.
`log_checkin` (unchanged) overwrites device unconditionally → later corrections win.
