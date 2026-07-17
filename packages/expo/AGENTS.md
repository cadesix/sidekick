# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v54.0.0/ before writing any code.

# This package IS the product (universal app)

- `@sidekick/expo` ships to users on iOS **and** runs in the browser via Expo
  Web from the same code. Browser dev loop: `pnpm dev` at the repo root
  (= `expo start --web` here). iOS needs a dev client (NOT Expo Go).
- All features land here or in `@sidekick/core` (platform-agnostic logic —
  keep it free of DOM/RN/expo imports). This package + `@sidekick/core` are the
  single source of truth; the old Vite reference app has been deleted.
- Read the root `CLAUDE.md` and `docs/MONOREPO.md` before structural work.
- Verify anything 3D on a physical iOS device — the simulator's GL lies (see
  README.md here for the gotcha list).
