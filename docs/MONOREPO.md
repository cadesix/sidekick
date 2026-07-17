# The Sidekick monorepo

Sidekick is a cel-shaded 3D mascot buddy — a full-screen three.js character
with a chat drawer, cosmetics shop, guided sessions, and world map.

## The core idea: ONE universal Expo app

```
              packages/expo  (THE app — universal)
  ┌──────────────────────────────────────────────────────┐
  │  Expo SDK 54 + React Native + expo-gl + three        │
  │                                                      │
  │   iOS (dev client / App Store)   ←── same code ──→   │
  │   Browser (Expo Web / react-native-web)              │
  └──────────────────────────────────────────────────────┘
              ▲ imports
  ┌──────────────────────────────┐
  │ @sidekick/core               │
  │ platform-agnostic logic:     │
  │ economy, shop, sessions,     │
  │ goals, streak, bond, rng     │
  └──────────────────────────────┘
```

- **`@sidekick/expo` is the product and the dev surface.** It ships to iOS
  users AND is what you run in the browser day-to-day. "Run it in web" always
  means Expo Web from this package. All features land here (or in
  `@sidekick/core`), full stop.
- **`@sidekick/core` is where platform-agnostic logic lives** — pure functions
  and data with zero DOM/RN/expo imports (economy, shop catalog, guided
  sessions, goals, streaks, bond, daily box, seeded rng). The app layer owns
  persistence (AsyncStorage) and UI; core owns the numbers.
- **`@sidekick/three` (planned)** — the imperative three.js scene currently
  lives in `packages/expo/src/three/` (renderer, shading, cosmetics, grass,
  face, interact, biomes). Extracting it into a shared package is the intended
  end state; until that lands, treat `packages/expo/src/three/` as its home.

The hard rule (from the root `CLAUDE.md`, which every agent must read first):
**`packages/expo` + `@sidekick/core` are the single source of truth — never
reintroduce duplicated logic, state, or 3D code.** The old Vite reference app
(`packages/web`) has been deleted.

## Repo structure

```
sidekick/
├── package.json            workspace root — pnpm dev = Expo Web; pnpm.overrides pins three
├── pnpm-workspace.yaml     packages/*, packages/config/*, packages/shared/*
├── .npmrc                  node-linker=hoisted (required for Expo/Metro)
├── pnpm-lock.yaml          single lockfile for everything
├── assets/                 canonical art source (cosmetics, GLBs, maps — see Assets)
├── docs/                   this file, creative-brief, token-economy, guided-sessions
├── plans/                  design docs for the chat/server stack (00–16)
├── tests/                  vitest suite for server/db/shared (+ pure expo chat modules)
├── tools/char-pipeline/    Blender cosmetics authoring pipeline (writes into assets/ — see Assets)
└── packages/
    ├── expo/               @sidekick/expo — THE app (iOS + web from one codebase)
    │   ├── app/                           expo-router routes (index = home, sidekick-3d = look-dev)
    │   ├── src/three/                     imperative three.js scene (future @sidekick/three)
    │   ├── src/components/                RN UI (dock, shop, map, sessions, …)
    │   ├── src/features/chat/             chat sheet: streaming turns, search, device tools
    │   ├── src/lib/                       tRPC client (api.ts), anonymous auth, notifications
    │   ├── src/store/                     zustand stores (persistence via AsyncStorage)
    │   ├── targets/                       iOS NotificationService extension
    │   ├── assets/                        bundled GLBs/textures (DERIVED — see Assets)
    │   └── scripts/                       strip-glb.mjs, sync-cosmetics.mjs
    ├── server/             @sidekick/server — Hono + tRPC backend (Vercel deploy via api/)
    │   ├── src/chat/                      chat turn engine (streaming, compaction)
    │   ├── src/routers/                   tRPC routers (chat, goals, documents, reminders, …)
    │   └── src/…                          ads, checkins, memory, notifications, rewards
    ├── db/                 @sidekick/db — drizzle schema + migrations (postgres; PGlite in tests)
    ├── shared/
    │   ├── core/           @sidekick/core — platform-agnostic logic + tables
    │   └── app/            @sidekick/shared — product domain logic shared by server + expo
    │                       (prompts, model tools, conversation/context, stream frame protocol)
    ├── landing/            marketing site (Next.js) — independent of everything above
    └── config/
        ├── tsconfig/       @sidekick/tsconfig — shared TS configs (base, node, react-vite)
        └── tailwind/       @sidekick/tailwind-config — shared Tailwind preset (brand tokens)
```

The chat stack is a vertical slice through four packages: the expo chat sheet
(`src/features/chat/`) talks to `@sidekick/server` (tRPC at `/trpc`, raw
streaming at `/chat/stream` + `/chat/continue`), which runs the turn engine
against `@sidekick/db` using the prompts/tools/frame-protocol in
`@sidekick/shared`. Run it locally with `pnpm dev:server` (needs
`DATABASE_URL` + `ANTHROPIC_API_KEY`; see `packages/server/.env.example`) and
point the app at it via `EXPO_PUBLIC_API_URL`. `pnpm test` covers this whole
stack with PGlite and mocked models — no keys or database needed.

## Running things

```bash
pnpm install                          # once, at the root
pnpm dev                              # Expo Web — browser preview of the real app
pnpm --filter @sidekick/expo ios      # iOS dev client (NOT Expo Go — expo-gl is native)
pnpm --filter @sidekick/expo start    # Metro for an existing dev client
pnpm typecheck                        # all packages
```

Anything 3D must ultimately be verified on a **physical iOS device** — the
simulator's GL stack is unreliable (blank scenes, z-fight artifacts; see
`packages/expo/README.md`). Expo Web is the fast iteration loop; the device is
the truth for rendering.

Chat: expo talks to `@sidekick/server` — point it at a local server with
`EXPO_PUBLIC_API_URL` and run `pnpm dev:server` (see the chat stack above). The
old Vite serverless chat endpoint (`packages/web/api/chat.js`) is gone with the
package.

## Assets — canonical source is the top-level `assets/`

Canonical art lives at the repo root in **`assets/`** (moved there when
`packages/web` was deleted). Layout:

```
assets/
├── cosmetics/              slot GLBs + manifest.json + .md contracts
├── shop-renders/           static product PNGs for the shop
├── props/                  bone-parented props (phone, …)
├── 3d-assets/              facesprite-contract.md + other 3D contracts
├── sidekick-rigged.glb     shipped character mesh
├── face-sheet-v6.png       face expression atlas
├── world-map-day.webp      world map art (+ quests day/evening/night variants)
└── .illustrate/            illustration working files
```

1. The Blender char-pipeline (`tools/char-pipeline/`) authors the rig and
   cosmetics and writes GLBs into `assets/cosmetics/` + `assets/
   sidekick-rigged.glb`. The asset contracts live next to them
   (`assets/3d-assets/*.md`, `assets/cosmetics/*.md`).
2. `packages/expo/scripts/sync-cosmetics.mjs` mirrors that catalog into the
   expo bundle: GLBs are texture-stripped (three's GLTFLoader can't decode
   embedded GLB images in RN), `.webp` variants become `.png` (expo-gl can't
   decode webp), and `src/three/cosmetics-manifest.ts` is **generated** from
   `manifest.json`. Re-run it whenever the canonical catalog changes.
3. Never edit expo's derived assets or the generated manifest by hand.

## Tooling conventions (don't fight these)

- **pnpm workspace, `node-linker=hoisted`** (`.npmrc`). Hoisting is what makes
  Expo/Metro work in a monorepo — Metro auto-detects the workspace (SDK 52+)
  and resolves from the root `node_modules`. Don't switch to symlinked
  node_modules casually.
- **`three` + `@types/three` are pinned workspace-wide** via root
  `pnpm.overrides` — bump the override, never a per-package range. After any
  three bump, verify rendering on a physical device.
- **`react`/`react-dom` are pinned exact** so hoisting yields a single copy.
- **Workspace deps use `workspace:*`** — `npm install` does not work anywhere
  in this repo. Always `pnpm install` at the root.
- `@sidekick/core` must stay pure: zero DOM / RN / expo imports. If it needs a
  platform API, the app passes the value in.
