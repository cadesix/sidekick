# @sidekick/core — keep it pure

Platform-agnostic logic and tables shared by the app: economy, shop, guided
sessions, goals, streak, bond, daily box, seeded rng.

**The one hard rule: zero DOM / React Native / Expo / three.js imports.** Pure
functions and data only. If logic needs a platform capability (storage, time,
randomness source, network), the app layer passes the value in — core never
reaches for it. Apps own persistence (AsyncStorage / localStorage) and UI;
core owns the numbers.

This is where logic belongs by default. If you're about to put a number, a
color, a table, a formula, or a game rule in `packages/expo`, it probably
belongs here instead.

Consumers: `packages/expo` (the product). `packages/web` is deprecated and
does not consume this. The three.js scene is *not* here — it lives in
`packages/expo/src/three/` and is slated to become `@sidekick/three`.

Architecture + rules: the root `CLAUDE.md`, `docs/MONOREPO.md`.
