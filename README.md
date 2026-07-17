# sidekick

pnpm workspace monorepo for Sidekick — a cel-shaded 3D mascot buddy.

**One universal Expo app is the product.** `packages/expo` runs on iOS **and**
in the browser (Expo Web / react-native-web) from the same code.

```
packages/
  expo/           @sidekick/expo   — THE app (Expo SDK 54, universal: iOS + web)
  shared/core/    @sidekick/core   — platform-agnostic logic (economy, shop, sessions, …)
  landing/        marketing site (Next.js, independent of all of the above)
  config/
    tsconfig/     @sidekick/tsconfig        — shared TS configs
    tailwind/     @sidekick/tailwind-config — shared Tailwind preset (brand tokens)
```

Canonical art (cosmetics, character GLB, maps) lives at the repo root in
`assets/`.

## Commands

```bash
pnpm install                        # once, at the root
pnpm dev                            # Expo Web — the browser preview of the real app
pnpm --filter @sidekick/expo ios    # build + run the iOS dev client (NOT Expo Go)
pnpm --filter @sidekick/expo start  # Metro for an existing dev client
pnpm typecheck                      # typecheck every package
```

Conventions: `three` and `@types/three` are pinned workspace-wide via root
`pnpm.overrides` — bump them there, not in a package. `.npmrc` uses
`node-linker=hoisted` for Expo/Metro compatibility; don't change it casually.

## Docs

`CLAUDE.md` — **read first**: the architecture model and the hard rules
(single source of truth, no duplicated logic, browser dev = Expo Web).
`docs/MONOREPO.md` — the full picture: package roles and the asset pipeline.
`packages/expo/README.md` — running the app + hard-won expo-gl gotchas.
`tools/char-pipeline/` — Blender authoring pipeline for the character's
cosmetics (+ `CHARACTER.md`, the character bible). Not a workspace package.
`docs/SYNC-PLAN.md` — historical; superseded by the universal-app refactor.
