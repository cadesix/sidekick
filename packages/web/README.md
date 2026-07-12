# @sidekick/web

Vite + React + TypeScript + Tailwind web app for Sidekick — the canonical dev
surface (fast iteration + look-dev editor) that the expo app ports from.

Notable routes: `/home4` (current home), `/sidekick-3d` (look-dev editor),
`/pose`, `/biomes`, plus the onboarding funnel.

## Run it

```bash
pnpm install                          # at the repo root
pnpm --filter @sidekick/web dev       # or `pnpm dev` from the root
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
