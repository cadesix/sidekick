# Sidekick monorepo — READ FIRST

## ⚠️ Major refactor in progress: collapsing to ONE universal Expo app

We are unifying this repo into a **single Expo universal app**:

- **`packages/expo` (React Native) is production** — it ships to users. It runs
  on iOS **and** in the browser via Expo Web (react-native-web) from the *same
  code*. This is "web" for all day-to-day dev.
- **`packages/web` (Vite) is DEPRECATED** — a temporary *reference design* only,
  being **retired** (Phase 4). It is a separate second implementation (React DOM
  + its own three.js + its own logic copies); it is **not** the product and not
  where features land.

### ⚠️ Running locally / "launch in web" — ALWAYS Expo, NEVER the Vite app

When you (or the user) want to run Sidekick **in a browser**, that means **Expo
Web**, launched from `packages/expo`:

```
cd packages/expo && npx expo start --web        # the browser preview = the RN app
```

**Do NOT start `packages/web` (the Vite dev server) unless the user explicitly
says to launch the DEPRECATED web app.** "Launch it", "run it in the browser",
"spin up web", "let me see it" → all mean **Expo Web from `packages/expo`**. The
Vite app is reference-only; running it by default is a mistake.
(Sidekick is *not* registered in the personal `launch` CLI — start Expo manually.)

### Hard rules (until and after the refactor lands)

- **Do NOT hand-port or reimplement features between `packages/web` and
  `packages/expo`.** A prior hand-port drifted badly — that is the mistake this
  refactor exists to eliminate.
- **Do NOT duplicate logic, state, or 3D code across the two apps.**
- Shared, platform-agnostic code lives in **`@sidekick/core`** (logic + state —
  exists today, `packages/shared/core`) and **`@sidekick/three`** (three.js
  scene — planned; until it exists the scene's home is
  `packages/expo/src/three/`). Apps provide only thin adapters (storage, GL
  context, assets, gestures).

### Why

The prior port drifted because every hand-port re-guesses the design, and the
correct process was documented but not where agents actually read it. This file
exists so any agent — entering from any file — sees the model first.

### Status (2026-07-15)

The architecture is proven and live: 3D on Expo Web works, `packages/expo` is
the daily dev surface (`pnpm dev` at the root = Expo Web), and `@sidekick/core`
is consumed throughout the app. What remains:

- Extract the three.js scene from `packages/expo/src/three/` into
  `@sidekick/three` (not started).
- Retire `packages/web` (Phase 4). The blockers are concrete — see the
  **retirement checklist in `docs/MONOREPO.md`**. The big one: canonical art
  assets still live in `packages/web/public/` (char-pipeline writes there,
  expo's `sync-cosmetics.mjs` reads there), so deleting web today deletes the
  art source.

`docs/MONOREPO.md` is the current architecture doc. `docs/SYNC-PLAN.md` is
historical (the old two-app parity model) — do not follow it.

`packages/landing` (marketing site) is unaffected by all of this.
