# sidekick

pnpm workspace monorepo for Sidekick — a cel-shaded 3D mascot buddy.

**One universal Expo app is the product.** `packages/expo` runs on iOS **and**
in the browser (Expo Web / react-native-web) from the same code. The old Vite
web app (`packages/web`) is deprecated — kept only as a porting reference until
it's deleted.

```
packages/
  expo/           @sidekick/expo   — THE app (Expo SDK 54, universal: iOS + web)
  shared/core/    @sidekick/core   — platform-agnostic logic (economy, shop, sessions, …)
  web/            @sidekick/web    — DEPRECATED Vite reference app (being retired; do not develop here)
  landing/        marketing site (Next.js, independent of all of the above)
  config/
    tsconfig/     @sidekick/tsconfig        — shared TS configs
    tailwind/     @sidekick/tailwind-config — shared Tailwind preset (brand tokens)
```

## Commands

```bash
pnpm install                        # once, at the root
pnpm dev                            # Expo Web — the browser preview of the real app
pnpm --filter @sidekick/expo ios    # build + run the iOS dev client (NOT Expo Go)
pnpm --filter @sidekick/expo start  # Metro for an existing dev client
pnpm typecheck                      # typecheck every package
pnpm dev:vite                       # DEPRECATED Vite reference app — only when explicitly needed
```

Conventions: `three` and `@types/three` are pinned workspace-wide via root
`pnpm.overrides` — bump them there, not in a package. `.npmrc` uses
`node-linker=hoisted` for Expo/Metro compatibility; don't change it casually.

## Docs

`CLAUDE.md` — **read first**: the architecture model and the hard rules
(no hand-porting, no duplicated logic, browser dev = Expo Web).
`docs/MONOREPO.md` — the full picture: package roles, what still depends on
`packages/web`, asset pipeline, and the retirement checklist.
`packages/expo/README.md` — running the app + hard-won expo-gl gotchas.
`tools/char-pipeline/` — Blender authoring pipeline for the character's
cosmetics (+ `CHARACTER.md`, the character bible). Not a workspace package.
`docs/SYNC-PLAN.md` — historical; superseded by the universal-app refactor.
