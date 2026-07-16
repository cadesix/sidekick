# @sidekick/web — ⚠️ DEPRECATED (reference only)

**This package is not the product and receives no new features.** It's the
pre-refactor Vite + React DOM implementation, kept temporarily as a *porting
reference* while the universal Expo app (`packages/expo` — iOS **and** browser
via Expo Web) absorbs what's left. It will be deleted (Phase 4 of the refactor).

- Do **not** develop features here. They land in `packages/expo` /
  `@sidekick/core`.
- Do **not** run this when someone says "launch it in the browser" — that
  means Expo Web (`pnpm dev` at the root). Only run this app when explicitly
  asked for the deprecated Vite reference.
- One thing here is still load-bearing: `public/cosmetics/` +
  `public/sidekick-rigged.glb` remain the **canonical asset source** (the
  char-pipeline writes here; expo's `sync-cosmetics.mjs` reads from here).
  See `docs/MONOREPO.md` for the retirement checklist.

Notable reference routes: `/home4` (pre-refactor home), `/sidekick-3d`
(look-dev editor), `/pose`, `/biomes`, plus the onboarding funnel.

## Run it (explicit request only)

```bash
pnpm install                          # at the repo root
pnpm dev:vite                         # from the root (or --filter @sidekick/web dev)
```

Real AI chat replies need `OPENAI_API_KEY` in `.env.local` (used by the dev
proxy in `vite.config.ts` and by `api/chat.js` in production). Without it the
chat endpoint errors and the UI falls back gracefully.

## Deploy

Vercel, with the project's Root Directory set to `packages/web`. `api/chat.js`
is the serverless chat endpoint; `vercel.json` holds the SPA rewrites.

## Layout

- `src/components/sidekick-*.ts` — imperative three.js scene (renderer, shading,
  grass, cosmetics/equipment, interaction, biomes)
- `public/cosmetics/` — canonical cosmetics GLBs + variant textures + `manifest.json`
- `design-system/` — static HTML style-guide pages
- `vite-plugin-sidekick.ts` — the /sidekick-3d studio's dev-server plugin
- `.illustrate/` — the /illustrate skill's style profile (config, character spec,
  reference images) for generating on-brand art; `outDir`/ref paths are relative
  to this package, so run illustrate from `packages/web`

## Funnel lineage

The onboarding funnel in `src/components/funnel/` started as a local-only copy
of the Relic web funnel and has since evolved into Sidekick's own flow. The
step sequence comes from `src/components/funnel/manifest.ts`.
