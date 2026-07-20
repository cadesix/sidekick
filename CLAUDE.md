# Sidekick monorepo — READ FIRST

## ONE universal Expo app

This repo is a **single Expo universal app**:

- **`packages/expo` (React Native) is the product** — it ships to users. It runs
  on iOS **and** in the browser via Expo Web (react-native-web) from the *same
  code*. This is "web" for all day-to-day dev.
- Shared, platform-agnostic code lives in **`@sidekick/core`** (logic + state,
  `packages/shared/core`). `packages/expo` + `@sidekick/core` are the single
  source of truth — there is no second implementation to keep in sync.

The old `packages/web` (Vite + React DOM reference app) has been **deleted**.
Its canonical art now lives at the top-level `assets/` directory (see Status).

### ⚠️ Running locally / "launch in web" — ALWAYS Expo

When you (or the user) want to run Sidekick **in a browser**, that means **Expo
Web**, launched from `packages/expo`:

```
cd packages/expo && npx expo start --web        # the browser preview = the RN app
```

"Launch it", "run it in the browser", "spin up web", "let me see it" → all mean
**Expo Web from `packages/expo`**.
(Sidekick is *not* registered in the personal `launch` CLI — start Expo manually.)

### Hard rules

- **All features land in `packages/expo` or `@sidekick/core`.** There is no
  second app; do not reintroduce duplicated logic, state, or 3D code.
- Shared, platform-agnostic code lives in **`@sidekick/core`** (logic + state —
  `packages/shared/core`) and **`@sidekick/three`** (three.js scene — planned;
  until it exists the scene's home is `packages/expo/src/three/`). Apps provide
  only thin adapters (storage, GL context, assets, gestures).

### Status (2026-07-17)

The universal-app refactor is done: 3D on Expo Web works, `packages/expo` is
the daily dev surface (`pnpm dev` at the root = Expo Web), `@sidekick/core` is
consumed throughout the app, and `packages/web` has been deleted. Canonical art
assets now live in the top-level **`assets/`** directory (char-pipeline writes
there, expo's `sync-cosmetics.mjs` reads there). What remains:

- Extract the three.js scene from `packages/expo/src/three/` into
  `@sidekick/three` (not started).

`docs/MONOREPO.md` is the current architecture doc. `docs/RELEASE.md` covers
building and shipping the iOS app to TestFlight. `docs/SYNC-PLAN.md` is
historical (the old two-app parity model) — do not follow it.

`packages/landing` (marketing site) is unaffected by all of this.
