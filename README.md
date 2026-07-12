# sidekick

pnpm workspace monorepo for the Sidekick apps — a cel-shaded 3D mascot buddy.

```
packages/
  web/            @sidekick/web    — Vite + React web app (canonical dev surface, deploys to Vercel)
  expo/           @sidekick/expo   — Expo SDK 54 React Native app (iOS/Android port of /home4)
  shared/core/    @sidekick/core   — platform-agnostic shared logic (populated incrementally)
  config/
    tsconfig/     @sidekick/tsconfig        — shared TS configs
    tailwind/     @sidekick/tailwind-config — shared Tailwind preset (brand tokens)
```

## Commands

```bash
pnpm install                        # once, at the root
pnpm dev                            # web dev server (alias for --filter @sidekick/web dev)
pnpm --filter @sidekick/expo ios    # build + run the expo dev client
pnpm --filter @sidekick/expo start  # Metro for an existing dev client
pnpm typecheck                      # typecheck every package
pnpm build                          # production web build
```

Conventions: `three` and `@types/three` are pinned workspace-wide via root
`pnpm.overrides` — bump them there, not in a package. `.npmrc` uses
`node-linker=hoisted` for Expo/Metro compatibility; don't change it casually.

## Deploys

Web deploys to Vercel. The app lives in `packages/web`, so the Vercel project's
**Root Directory must be set to `packages/web`** (with "Include source files
outside of Root Directory" enabled so the root lockfile is visible). The
serverless function is `packages/web/api/chat.js`.

## Docs

`docs/MONOREPO.md` — **start here**: how the two apps relate (web = dev
surface, expo = prod surface), the parity contract, asset flow, and roadmap.
`docs/SYNC-PLAN.md` — the web ↔ expo parity/porting playbook (predates the
monorepo; its shared-code endgame is what this structure implements).
`packages/expo/README.md` — expo-gl porting rules and device/simulator gotchas.
