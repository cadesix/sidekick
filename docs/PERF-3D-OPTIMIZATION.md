# 3D Render Performance — Optimization Log

Status: **in progress / validated on web, pending on-device confirmation**
Branch: `perf/3d-render-optimization`

This documents the on-device performance investigation for the 3D home scene
(mascot + meadow, rendered via `expo-gl` + three.js) and every optimization
tested so far, with results. It's a working log, not a final writeup — the last
step (device confirmation of the thermal fix) is still open.

---

## The problem

On a physical iOS device (dev client):

1. **Frame dropping** during camera moves — worst when a surface (Messages /
   Shop / Map) closes and the camera animates *back* to the character.
2. **The device gets hot** while the app is open.
3. **It gets slower the longer it stays open.**

---

## Tooling built (reusable — dev-only, must be stripped before merge)

Because "it's slow on device" can't be diagnosed from a desktop guess, we built
direct visibility:

- **Frame telemetry probe** — the render loop (`renderer.ts`) reports, ~2×/sec:
  `fps`, worst frame interval, worst *in-loop JS* time, GL draw calls, triangles,
  geometries/textures/programs, scheduler `skipped` count, and `idle` flag.
- **On-screen overlay** (`FpsOverlay` in `app/index.tsx`) — an isolated leaf
  component so it never re-renders Home (an earlier version did, and polluted the
  numbers).
- **Off-device telemetry pipe** — the client POSTs batched samples + timing marks
  to a dev-only server route `POST /dev/perf` (`packages/server/src/app.ts`),
  which appends JSONL to `/tmp/sidekick-perf.jsonl`. This lets us read real device
  numbers off the host instead of reading them off the screen.
- **Headless web loop** — a Playwright driver (kept out of the repo, under the
  agent job dir) launches Expo Web in headless Chrome, seeds a dev session +
  onboarding-complete into `localStorage` to land straight on Home, runs a
  scripted scenario (idle → map open/close ×5 → idle), and the same telemetry
  pipe records it. Because it's the identical JS, **structural** behavior
  (re-render cost, allocation, scheduler decisions, leaks) reproduces on the
  desktop and can be measured without a device. Only absolute ms and thermal
  behavior are device-specific.
- **React `<Profiler>`** around Home — reports actual commit durations, to
  attribute the map-close re-render cost.

---

## Root-cause findings

| Symptom | Root cause | Evidence |
|---|---|---|
| **Hot** | The render loop runs full-rate, continuously, forever — even when idle and even when a surface fully covers the scene. CPU+GPU never idle. | Continuous `requestAnimationFrame` re-queue; per-frame JS is tiny but relentless. |
| **Slower over time** | **Thermal throttling** — the heat above makes iOS downclock the SoC as it warms. NOT a leak. | The *identical JS* on a (cooled) desktop shows **zero** degradation over a session (fps flat, resources flat). Only a phone throttles. |
| **Map-close hitch** | The (small) Home re-render running ~20× slower on hot/throttled Hermes. Not a bloated commit. | React Profiler: Home commit is **~5 ms on web** vs **~100 ms on device** — same commit, slow/hot hardware. |
| — | **Not GPU / scene weight** | Only ~18 draw calls, ~90k triangles — trivial. Cutting MSAA and grass changed nothing. |
| — | **Not a memory/GL leak** | geometries/textures/programs flat across a session, on both device and web. |

**Net:** the problem is the JS thread + a continuously-running render loop, and
the "slower over time" is a *thermal* consequence of the heat — the same root
cause, not a separate bug.

---

## Optimizations tested

| # | Change | File(s) | Result |
|---|---|---|---|
| 1 | **MSAA 4× → 2×** on device | `SidekickCanvas.tsx` | No measurable effect (not GPU-bound). Kept at 2× (harmless). |
| 2 | **Grass 20k → 5k blades** on device | `renderer.ts` | No effect — grass wind is a shader uniform, and the JS cost is per-*object*, not per-*instance*. **Reverted to 20k** (looks better, costs nothing here). |
| 3 | **dt-based camera ease** | `renderer.ts` | Makes the camera ease frame-rate-independent so dropped frames don't rubber-band. Kept — also makes the scheduler's frame-skipping free. |
| 4 | **`React.memo` + stable props** on 8 always-mounted surfaces + memoized handlers / `framing` / `overhead` / `ground` | `app/index.tsx`, `ShopSheet`, `GoalsSheet`, `AppearanceSheet`, `SettingsSheet`, `StreakModal`, `HomeDock`, `WorldMap`, `ChatScreen` | Reduces re-render churn on surface toggles. Kept. Modest on its own. |
| 5 | **Overhead head-projection gating** — skip the per-frame head projection + 3 reanimated shared-value writes when the overlay is hidden under a surface | `renderer.ts`, `SidekickCanvas.tsx`, `app/index.tsx` | Removes ~180 wasted JS→UI writes/sec while a surface is open. Kept. |
| 6 | **Closet-button avatar loop throttled 60 → 15 fps** + kept mounted (opacity, not unmount/`display:none`) so its GL context isn't torn down/rebuilt | `avatar.ts`, `app/index.tsx` | Kills a *second* continuous GL loop's cost at idle. Kept. |
| 7 | **Render scheduler** — throttle the main loop to ~30 fps when idle (camera settled, no transitions, no recent touch), 60 fps during any motion, wake instantly on touch; skip nothing during motion | `renderer.ts` | **The primary fix.** Validated on web that the idle decision flips correctly (`idle=1` during idle phases, `0` during map cycles). Halving idle frames → ~half the continuous load → cooler → less/no thermal throttle → addresses heat AND slower-over-time. |
| — | **Fix considered and rejected:** trimming Home's map-close re-render | — | Profiler proved the commit is already only ~5 ms — nothing to trim. The device's ~100 ms is thermal/Hermes slowness, which #7 fixes indirectly by keeping the device cool. |

---

## Current status

- **Validated on web:** scheduler decides correctly; no leak; no intrinsic
  over-time degradation; map-close commit is cheap; scene is not GPU-bound.
- **Pending on device:** confirm the scheduler drops idle to ~30 fps, the device
  runs cooler, and the over-time slowdown disappears (SwiftShader on the desktop
  can't render fast enough to trigger the 30 fps cap, so the *skip* action and
  the *thermal* outcome can only be confirmed on device).

## Follow-ups

- **Strip the dev instrumentation before merge** — the overlay, `perf-telemetry.ts`,
  the `/dev/perf` route, the frame-stats probe, and the `<Profiler>` are all
  dev-only diagnostics, not shippable code. Keep only #3–#7 (and the DevPanel
  time-of-day selector, which is a genuine dev feature).
- Optional next levers if device still isn't cool enough: fully **pause** the
  main loop (not just throttle) when a full-screen surface covers the scene;
  reduce per-frame allocation to lower Hermes GC pressure.

## How to reproduce (web loop)

1. `cd packages/expo && npx expo start --web --port 8082`
2. Mint a dev session: `POST /trpc/auth.devLogin` on the local server.
3. Run the Playwright driver (seeds `localStorage` → Home, runs the scenario).
4. Read `/tmp/sidekick-perf.jsonl` and analyze (fps/worst/js/calls + map marks).
