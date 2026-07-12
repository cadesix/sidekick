# The Sidekick monorepo

Sidekick is a cel-shaded 3D mascot buddy — a full-screen three.js character with
a chat drawer, cosmetics shop, and world map. This repo holds **two apps that
render the same product on different platforms**, plus the shared packages that
keep them from drifting apart.

## The core idea: develop on web, ship on native

```
   packages/web  (dev surface)              packages/expo  (prod surface)
  ┌─────────────────────────────┐          ┌──────────────────────────────┐
  │ Vite + React + three.js     │  port →  │ Expo + RN + expo-gl + three  │
  │ instant HMR, look-dev editor│          │ dev-client builds, App Store │
  │ every experiment lives here │          │ only proven features arrive  │
  └─────────────────────────────┘          └──────────────────────────────┘
```

- **`@sidekick/web` is where development happens.** Iteration is fast (Vite
  HMR), and the look-dev tooling lives here: `/sidekick-3d` (live scene editor
  with lil-gui), `/pose` (pose studio), `/biomes` (biome preview). New
  features, new cosmetics, new scenes, and all visual tuning land on web
  first. Web is also the **canonical home of art assets** (`public/cosmetics/`,
  face sheets, world maps).
- **`@sidekick/expo` is what ships to users.** It is a deliberate *port* of
  web's `/home4` experience to React Native — same scene, same cosmetics
  engine, same chat — rebuilt on `expo-gl` + `expo-three` because RN has no
  DOM. Features arrive here only after they've been proven on web.
- **Parity is a maintained contract, not an accident.** The two renderers are
  currently parallel implementations of the same logic (see the mapping table
  below). Anything that changes on one side either gets ported in the same
  cycle or logged as pending. The long-term fix is extracting the duplicated
  logic into `@sidekick/core` so most of it is literally the same file.

The full porting playbook (port protocol, config baking, asset pipeline,
verification) is `docs/SYNC-PLAN.md`. The hard-won expo-gl platform gotchas are
in `packages/expo/README.md` — read both before porting anything.

## Repo structure

```
sidekick/
├── package.json            workspace root — orchestration scripts + pnpm.overrides
├── pnpm-workspace.yaml     packages/*, packages/config/*, packages/shared/*
├── .npmrc                  node-linker=hoisted (required for Expo/Metro)
├── pnpm-lock.yaml          single lockfile for everything
├── docs/                   this file, SYNC-PLAN.md, creative-brief.md
└── packages/
    ├── web/                @sidekick/web — Vite web app (dev surface, Vercel deploy)
    │   ├── src/components/sidekick-*.ts   imperative three.js scene modules
    │   ├── src/*.tsx                      routes (home4, sidekick-3d, funnel, …)
    │   ├── public/cosmetics/              CANONICAL cosmetics GLBs + manifest.json
    │   ├── api/chat.js                    Vercel serverless chat endpoint
    │   └── vite-plugin-sidekick.ts        /sidekick-3d studio dev plugin
    ├── expo/               @sidekick/expo — RN app (prod surface)
    │   ├── app/                           expo-router routes
    │   ├── src/three/                     ported three.js scene (see mapping below)
    │   ├── src/components/                RN UI (dock, chat, shop, map)
    │   ├── assets/                        stripped GLBs + PNG variants (derived from web)
    │   └── scripts/strip-glb.mjs          GLB texture stripper
    ├── shared/
    │   └── core/           @sidekick/core — platform-agnostic shared logic
    │                       (being populated incrementally; see "Roadmap")
    └── config/
        ├── tsconfig/       @sidekick/tsconfig — shared TS configs
        └── tailwind/       @sidekick/tailwind-config — shared Tailwind preset (brand tokens)
```

## How the two apps relate, file by file

The expo renderer is a hand-ported mirror of web's. Until extraction into
`@sidekick/core` is done, these pairs must be kept in sync manually:

| Concern | Web (canonical) | Expo (port) |
| --- | --- | --- |
| Scene build + render loop | `src/components/sidekick-canvas.tsx`, `sidekick-scene.ts` | `src/three/renderer.ts`, `src/components/SidekickCanvas.tsx` |
| Cel shading + outline + item materials | `sidekick-shading.ts` | `src/three/shading.ts` |
| Cosmetics/equipment engine | `sidekick-equipment.ts` | `src/three/cosmetics.ts` |
| Cosmetics manifest | `public/cosmetics/manifest.json` | `src/three/cosmetics-manifest.ts` (hand-mirrored TS) |
| Wardrobe state + persistence | `sidekick-wardrobe.ts` | `src/three/wardrobe.ts` |
| Face expression atlas | `sidekick-face.ts` | `src/three/face.ts` |
| Settings + scene presets | `sidekick-settings.ts` / `sidekick-scene.ts` | `src/three/settings.ts` |
| Poke/drag interaction springs | `sidekick-interact.ts` | `src/three/interact.ts` |
| Grass field | `sidekick-grass.ts` | `src/three/grass.ts` |
| Chat UI + API | `chat.tsx`, `api/chat.js` | `src/components/Chat.tsx`, `src/lib/chat-api.ts` |
| Home dock / shop / map | `home-dock.tsx`, `shop-sheet.tsx`, `world-map.tsx` | `HomeDock.tsx`, `ShopSheet.tsx`, `WorldMap.tsx` |

Deliberately shared runtime contracts (same key, same shape, on both
platforms — a tuned look or outfit from either side works on the other):

- `sidekick-wardrobe-v1` — equipped outfit (localStorage / AsyncStorage)
- `sidekick3d-settings-v2` — look-dev settings blob

Web-only (not ported, by design): the onboarding funnel, look-dev editor
routes, design-system pages. Expo-only until back-ported: check
`docs/SYNC-PLAN.md` §2's reverse-flow note (e.g. the world-anchored fog patch).

## Assets flow one way: web → expo

Canonical art lives in `packages/web/public/`. The expo copies in
`packages/expo/assets/` are **derived**:

1. GLBs are texture-stripped (`pnpm --filter @sidekick/expo strip-glb`) because
   three's GLTFLoader can't decode embedded GLB images in RN.
2. Cosmetic variant `.webp` textures are converted to `.png`.
3. Face sheets / world maps are copied.
4. `src/three/cosmetics-manifest.ts` mirrors `manifest.json` by hand (codegen
   for this is planned — it's the worst drift hazard).

Never edit expo's derived assets directly; regenerate from web's.

## Tooling conventions (don't fight these)

- **pnpm workspace, `node-linker=hoisted`** (`.npmrc`). Hoisting is what makes
  Expo/Metro work in a monorepo — Metro auto-detects the workspace (SDK 52+)
  and resolves everything from the root `node_modules`. Don't switch to
  symlinked node_modules casually.
- **`three` is pinned workspace-wide** to one exact version via root
  `pnpm.overrides` (`three` + `@types/three`). Nineteen releases of drift
  between the apps was the biggest "same code, different pixels" risk — bump
  the override, never a per-package range. After any three bump, verify
  rendering on a **physical device** (simulator GL lies; see expo README).
- **`react`/`react-dom` are pinned exact** and identical in both apps so
  hoisting yields a single copy.
- **Workspace deps use `workspace:*`** — which means `npm install` no longer
  works anywhere in this repo. Always `pnpm install` at the root.
- Shared config packages: app tsconfigs extend `@sidekick/tsconfig` (web) or
  `expo/tsconfig.base` (expo — Expo's own base is correct there); both tailwind
  configs consume the `@sidekick/tailwind-config` preset for brand tokens.

## Running things

```bash
pnpm install                          # once, at the root
pnpm dev                              # web dev server
pnpm --filter @sidekick/expo ios      # build + run the expo dev client (NOT Expo Go — expo-gl is native)
pnpm --filter @sidekick/expo start    # Metro for an existing dev client
pnpm typecheck                        # all packages
pnpm build                            # production web build
```

Web deploys to Vercel with the project's **Root Directory set to
`packages/web`** ("Include source files outside of Root Directory" enabled so
the root lockfile is visible). The serverless chat endpoint is
`packages/web/api/chat.js`; chat needs `OPENAI_API_KEY` (web `.env.local` /
Vercel env). Expo uses `EXPO_PUBLIC_OPENAI_API_KEY` (see
`packages/expo/.env.example`) or falls back to canned replies.

## Roadmap: from mirrored files to shared packages

The mapping table above is the debt. The plan (SYNC-PLAN §1, now via real
workspace packages instead of copy scripts) is to move everything that is "a
number, a color, a table, a formula, or a shader string" into
`@sidekick/core`, leaving only renderer plumbing (DOM canvas vs expo-gl) and
UI (Tailwind DOM vs RN) platform-specific. Rough order, lowest-risk first:

1. Cosmetics manifest (typed export generated from/replacing `manifest.json`) —
   kills the worst hand-mirror
2. Settings type + DEFAULT_SETTINGS + scene presets (+ `bake-config` from the
   /sidekick-3d editor)
3. GLSL sources (cel, outline, grass blades, fog)
4. Interaction spring math; face/bone/pose tables
5. Grass layout math

Each extraction: move the module into `packages/shared/core/src`, point both
apps at it, then verify on web *and* on a physical iOS device before the next.
