# ⚠️ STOP — this package is DEPRECATED

`@sidekick/web` (Vite + React DOM) is **not the product**. It is the
pre-refactor implementation, kept only as a *porting reference* until it's
deleted (Phase 4).

**The product is `packages/expo`** — one universal Expo app that runs on iOS
**and** in the browser via Expo Web, from the same code.

If you are here, check what you actually intend:

- **Building a feature?** Wrong package. Features land in `packages/expo`
  (app/UI/3D) or `@sidekick/core` (platform-agnostic logic).
- **Running the app in a browser?** Wrong package. That's Expo Web:
  `pnpm dev` at the repo root. Only run this app (`pnpm dev:vite`) if the user
  explicitly asked for the deprecated Vite reference.
- **Reading how something used to work, to port it once?** Right package —
  read it, then implement in expo/core. Never sync the two by hand, and never
  copy code back into this package.
- **Touching art assets?** `public/cosmetics/` + `public/sidekick-rigged.glb`
  are still the canonical asset source (the char-pipeline writes here; expo's
  `scripts/sync-cosmetics.mjs` derives from here). Changing them means
  re-running that sync. This is the main thing blocking deletion — see the
  retirement checklist in `docs/MONOREPO.md`.

Full model + hard rules: the root `CLAUDE.md`.
