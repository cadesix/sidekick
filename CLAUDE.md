# Sidekick monorepo — READ FIRST

## ⚠️ Major refactor in progress: collapsing to ONE universal Expo app

We are unifying this repo into a **single Expo universal app**:

- **`packages/expo` (React Native) is production** — it ships to users.
- **`packages/web` (Vite) is a dev-only preview**, not a product, and is being
  **retired**. Most feature dev happens on web because iteration is faster, but
  the goal is that **web renders the same code as native** (via Expo Web /
  react-native-web) so the two can never drift.

### Hard rules (until and after the refactor lands)

- **Do NOT hand-port or reimplement features between `packages/web` and
  `packages/expo`.** A prior hand-port drifted badly — that is the mistake this
  refactor exists to eliminate.
- **Do NOT duplicate logic, state, or 3D code across the two apps.**
- Shared, platform-agnostic code lives in **`@sidekick/core`** (logic + state)
  and **`@sidekick/three`** (three.js scene). Apps provide only thin adapters
  (storage, GL context, assets, gestures).

### Why

The prior port drifted because every hand-port re-guesses the design, and the
correct process was documented but not where agents actually read it. This file
exists so any agent — entering from any file — sees the model first.

### Status

The refactor is mid-flight. **Before building a feature, confirm the current
phase** against the active plan and `docs/SYNC-PLAN.md` (being rewritten to this
model). The full governance docs (per-package `CLAUDE.md`, `PORTING-RULES.md`,
`PARITY.md`, import-boundary lint) land once the existential 3D-on-Expo-Web spike
proves the architecture.

`packages/landing` (marketing site) is unaffected by all of this.
