# Web ↔ iOS sync plan (HISTORICAL — superseded)

> **Status (2026-07-15): SUPERSEDED.** The premise of this doc — develop in
> the Vite web app, port to the RN app, keep two implementations in parity —
> is dead. The repo has collapsed to **one universal Expo app**
> (`packages/expo`, running on iOS and in the browser via Expo Web), with
> shared logic in `@sidekick/core`. `packages/web` is a deprecated reference
> being retired; there is no two-way parity contract to maintain anymore.
>
> **Current model:** root `CLAUDE.md` (rules) + `docs/MONOREPO.md`
> (architecture, asset pipeline, web-retirement checklist).
>
> Still worth reading here, as reference only: the platform gotchas (§5 —
> they now live executable-form in `packages/expo/README.md`) and the
> shared-vs-platform-specific inventory (§1's table, useful when checking
> whether anything in `packages/web` remains unported). Everything else —
> sync scripts, PARITY.md, port protocol, screenshot parity harness — is
> obsolete and was never built.

Original intent (obsolete): develop and tweak in the web app (`packages/web`),
then port to the RN app (`packages/expo`) for prod.

## 0. Prerequisites (one-time, do first)

- [ ] **Commit + remote this repo.** Everything here sits uncommitted on top of
      an Expo boilerplate "Initial commit" — there is no history to diff
      against and no way to bisect a bad port. Create a GitHub repo, commit,
      and require commits per port from here on.
- [ ] **Align three.js versions.** Web is `three@0.185`, mobile is pinned to
      `0.166` (expo-three peer). Nineteen releases of lighting/color internals
      is the biggest "same code, different pixels" risk. Test expo-three
      against r185 in a branch; if it works, pin BOTH repos to the same
      version and add a CI check that the two package.jsons agree.

## 1. Shared core — one source of truth for pure logic

Most divergence risk is in things that are **plain data/math and could be
literally the same file**:

| Module | Web today | Mobile today |
| --- | --- | --- |
| Settings type + DEFAULT_SETTINGS + scene presets | `sidekick-settings.ts` / `sidekick-scene.ts` | `src/three/settings.ts` (hand-mirrored) |
| Cosmetics manifest | `public/cosmetics/manifest.json` | `src/three/cosmetics-manifest.ts` (hand-mirrored) |
| Face cell map, bone map, phone pose, framings | scattered | scattered copies |
| Interaction spring math | `sidekick-interact.ts` | `src/three/interact.ts` (fork) |
| GLSL sources (cel, outline, blades, fog patch) | injections/strings | self-contained strings |
| Grass layout math + cloud recipe | `sidekick-grass.ts` | `src/three/grass.ts` (fork) |

**Plan:** create `shared/` in the **web repo** (canonical) holding
platform-agnostic TS modules with **zero DOM/RN imports**: types, constants,
presets, pose/face/bone tables, spring class, layout math, GLSL strings,
manifest schema. Mobile mirrors it via `npm run sync-shared` (rsync +
checksum manifest committed to this repo). CI/typecheck fails if checksums
drift. (A true monorepo or git subtree is the endgame; the copy-script gets
90% of the value without restructuring repos.)

Rule of thumb for what goes in shared: **if it's a number, a color, a table,
a formula, or a shader string — it's shared.** Only renderer plumbing (DOM
canvas vs expo-gl) and UI (Tailwind vs RN) stay platform-specific.

## 2. Config — bake from the editor, don't hand-copy

- Look-dev truth lives in the browser's `sidekick3d-settings-v2` localStorage
  (the repo defaults LAG it — this bit us: outline, cel shadow, face
  placement, grass height and scene colors all differed).
- Add to the web repo: `npm run bake-config` — reads a pasted/exported JSON
  and writes `shared/default-settings.json`. Both apps import that JSON as
  DEFAULT_SETTINGS. The /sidekick-3d editor gets an "Export current look"
  button that copies the JSON.
- Mobile's Settings sheet already persists the same key/shape, so a tuned
  look from EITHER platform can be baked.
- **Reverse flow exists too**: mobile-first features (e.g. the world-anchored
  fog patch in `src/three/fog-patch.ts`, added 2026-07-11) must be ported
  back to web in the same PR cycle or logged in PARITY.md as web-pending.

## 3. Assets — scripted one-way pipeline (web → mobile)

Canonical art lives in web `public/`. Replace today's hand-copying with
`npm run sync-assets` in this repo:

1. Copy character/cosmetics GLBs → `assets/` and run `strip-glb.mjs`
   (GLTFLoader can't decode embedded textures in RN; strip is deterministic).
2. Convert cosmetic variant `.webp` → `.png` (use `sharp` instead of macOS
   `sips` so it runs in CI).
3. Copy face sheet / world-map art.
4. **Codegen `src/three/cosmetics-manifest.ts` from `manifest.json`** — the
   require() lines are mechanical; generating them kills the worst
   hand-mirroring hazard (new slots/variants silently missing on mobile).

Check the generated files in; the script is re-run whenever web assets change.

## 4. Port protocol — process per feature

1. Feature lands in web (dev happens there).
2. Its PR description lists: shared-module changes, web-only view code, assets
   touched. Anything in `shared/` or assets auto-flags "mobile port needed".
3. Port PR in this repo: run sync-shared + sync-assets, port the view layer,
   bump `BUILD_MARKER`, verify on a **physical device** (sim GL lies — see
   README), tick the row in `PARITY.md`.
4. Keep `PARITY.md` (add it) as the feature → web file → mobile file → status
   table. Today's rows: dock, chat, shop/cosmetics, world map, grass,
   interactions, settings/look-dev, bloom, world-fog (web ⬅ pending).

## 5. Platform gotchas — keep them executable

The expo-gl porting rules are hard-won and MUST travel with the repo (they're
in README + Claude memory today): de-interleave GLB geometry, no skinned
raycasts on Hermes, self-contained ShaderMaterials instead of onBeforeCompile,
uniform-updates-not-rebuilds for live tuning, 8-bit render targets only,
`msaaSamples` device/sim split, cold-relaunch after GL changes, function-form
Pressable styles are dropped by css-interop. Consolidate into
`PORTING-RULES.md` and link it from both repos' CLAUDE.md so any session
(human or Claude) ports under the same constraints.

## 6. Verification — trust screenshots, not vibes

- Web: Playwright captures of /home4 in hero/chat/shop/map × day/evening/night
  against the baked config → committed contact sheet.
- Mobile: same states captured on-device per release (manual today; Maestro
  later). Put the two contact sheets side by side in the port PR.
- The `BUILD_MARKER` log line remains the "am I actually running this code"
  guard (Metro serves stale bundles).

## Sequencing

1. Commit + remote this repo (unblocks everything).
2. `PARITY.md` + `PORTING-RULES.md` (an hour, pure writing).
3. `sync-assets` with manifest codegen (highest drift-risk kill).
4. `shared/` extraction starting with settings/presets + manifest schema +
   GLSL strings, then `bake-config`.
5. three version alignment experiment.
6. Screenshot harness last (nice-to-have once the above holds).
