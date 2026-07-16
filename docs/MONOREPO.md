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
  ┌──────────────────────────────┐   ┌────────────────────────────┐
  │ @sidekick/core               │   │ packages/web (DEPRECATED)  │
  │ platform-agnostic logic:     │   │ Vite reference app — port  │
  │ economy, shop, sessions,     │   │ FROM it, never develop IN  │
  │ goals, streak, bond, rng     │   │ it; deleted after Phase 4  │
  └──────────────────────────────┘   └────────────────────────────┘
```

- **`@sidekick/expo` is the product and the dev surface.** It ships to iOS
  users AND is what you run in the browser day-to-day. "Run it in web" always
  means Expo Web from this package — never the Vite app. All new features land
  here (or in `@sidekick/core`), full stop.
- **`@sidekick/core` is where platform-agnostic logic lives** — pure functions
  and data with zero DOM/RN/expo imports (economy, shop catalog, guided
  sessions, goals, streaks, bond, daily box, seeded rng). App layers own
  persistence (AsyncStorage/localStorage) and UI; core owns the numbers.
- **`@sidekick/web` is a deprecated reference implementation.** It's the
  pre-refactor Vite + React DOM app, kept only so remaining unported behavior
  and look-dev values can be read off it. It receives no new features. It is
  retired (deleted) once its last real dependencies are migrated — see the
  checklist below.
- **`@sidekick/three` (planned)** — the imperative three.js scene currently
  lives in `packages/expo/src/three/` (renderer, shading, cosmetics, grass,
  face, interact, biomes). Extracting it into a shared package is the intended
  end state; until that lands, treat `packages/expo/src/three/` as its home.

The hard rules (from the root `CLAUDE.md`, which every agent must read first):
**never hand-port or reimplement features between the two apps, and never
duplicate logic/state/3D code across them.** Porting from the deprecated
reference is one-way and terminal — once behavior lives in expo/core, the web
copy is dead code awaiting deletion.

## Repo structure

```
sidekick/
├── package.json            workspace root — pnpm dev = Expo Web; pnpm.overrides pins three
├── pnpm-workspace.yaml     packages/*, packages/config/*, packages/shared/*
├── .npmrc                  node-linker=hoisted (required for Expo/Metro)
├── pnpm-lock.yaml          single lockfile for everything
├── docs/                   this file, creative-brief, token-economy, guided-sessions
├── plans/                  design docs for the chat/server stack (00–16)
├── tests/                  vitest suite for server/db/shared (+ pure expo chat modules)
├── tools/char-pipeline/    Blender cosmetics authoring pipeline (writes into web/public — see Assets)
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
    ├── web/                @sidekick/web — DEPRECATED Vite reference (do not develop here)
    │   ├── src/components/sidekick-*.ts   pre-refactor three.js scene (reference)
    │   ├── public/cosmetics/              still the CANONICAL asset source (see Assets)
    │   └── api/chat.js                    Vercel serverless chat endpoint (legacy deploy)
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
pnpm dev:vite                         # deprecated Vite reference — explicit request only
```

Anything 3D must ultimately be verified on a **physical iOS device** — the
simulator's GL stack is unreliable (blank scenes, z-fight artifacts; see
`packages/expo/README.md`). Expo Web is the fast iteration loop; the device is
the truth for rendering.

Chat: expo talks to `@sidekick/server` — point it at a local server with
`EXPO_PUBLIC_API_URL` and run `pnpm dev:server` (see the chat stack above). The
legacy Vite deploy on Vercel still uses `packages/web/api/chat.js` with
`OPENAI_API_KEY`.

## Assets — canonical source is still `packages/web/public/` (for now)

This is the one place the deprecated package is still load-bearing:

1. The Blender char-pipeline (`tools/char-pipeline/`) authors the rig and
   cosmetics and writes GLBs into `packages/web/public/cosmetics/` +
   `packages/web/public/sidekick-rigged.glb`. The asset contracts live next to
   them (`public/3d-assets/*.md`, `public/cosmetics/*.md`).
2. `packages/expo/scripts/sync-cosmetics.mjs` mirrors that catalog into the
   expo bundle: GLBs are texture-stripped (three's GLTFLoader can't decode
   embedded GLB images in RN), `.webp` variants become `.png` (expo-gl can't
   decode webp), and `src/three/cosmetics-manifest.ts` is **generated** from
   `manifest.json`. Re-run it whenever the web catalog changes.
3. Never edit expo's derived assets or the generated manifest by hand.

**Before `packages/web` can be deleted, this canonical asset home (plus the
`.md` contracts beside it) must move** — e.g. to a top-level `assets/` or into
`packages/expo` — and `sync-cosmetics.mjs` + the char-pipeline scripts
repointed. Until then, deleting web deletes the art source.

## Retiring `packages/web` — what actually blocks deletion

- [ ] Port or consciously drop any remaining web-only behavior worth keeping
      (check against the reference before assuming parity).
- [ ] Move the canonical asset source + asset contract docs out of
      `packages/web/public/` and repoint `sync-cosmetics.mjs` and
      `tools/char-pipeline`.
- [ ] Decide the fate of the Vercel deploy (`packages/web` root directory,
      `api/chat.js`) — replace with an Expo Web export or shut it down.
- [ ] Migrate anything still referencing web paths (docs, scripts, memory).

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
