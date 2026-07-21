# Frame-rate throttling: verify the idle cap, go lower during chat

Thermal work, continuing from the 2x-DPR resolution clamp (SidekickCanvas) and
the MSAA 4x→2x drop. Goal: cut GPU/JS work during the states where the phone
actually spends minutes — the idle meadow and, especially, an open chat sheet.

## Current state (already landed — build-054)

`packages/expo/src/three/renderer.ts` has a render scheduler:

- `IDLE_DT = 1/30` (~line 781): when `sceneIdle`, `animate()` skips rAF ticks
  until 1/30s has passed since the last rendered frame. A skipped tick does no
  JS work, no render, no `endFrameEXP` (the previous buffer stays presented).
- `sceneIdle` is recomputed at the end of every rendered frame (~line 1231):
  idle = camera settled && studio/cosmos/lookUp/phone transitions settled &&
  no jump && no shake && no chest-pop && no pointer in the last 0.9s.
- Any `pointerDown` forces `sceneIdle = false` immediately, so a touch never
  waits out a 33ms skip window (~line 1337).
- dt-based eases measure real elapsed time (`dtFrames`, clamped to 4 ≙ 15fps
  catch-up), so animations stay time-correct across skips.
- The dev FPS overlay reports `skipped` + `idle` per 0.5s window, so the cap is
  observable on device.

So "#1 idle 30fps cap" exists. What's left: verification of its edges, and the
deeper chat throttle ("#2").

## Part A — verify the idle cap's edges

1. **Talking under the cap.** `talking` is NOT in the `sceneIdle` predicate; a
   talking-but-otherwise-idle scene runs at 30fps and the mouth (`faceCtl`,
   line ~1177) animates at 30fps. Expected fine; confirm on device that mouth
   flaps don't look steppy on the home screen (where the character is large).
   If they do, add `!talking` to the predicate (costs: full rate whenever
   speaking) — prefer keeping 30.
2. **ProMotion.** When NOT idle, the loop runs at whatever rAF gives. Confirm
   with the FPS overlay on a 120Hz iPhone that active fps is ~60, not ~120
   (expo-gl's CADisplayLink default). If it's 120, add an ACTIVE_DT = 1/60 cap
   using the same skip mechanism — transitions don't need 120 and it doubles
   GPU cost exactly when the scene is most expensive.
3. **Wind/cloud shader time.** Grass wind is GPU time-uniform driven; verify no
   visible stutter in blades/clouds at 30fps idle (expected smooth: uniform
   advances by real elapsed time).

## Part B — deeper throttle while chat is up (#2) — ✅ IMPLEMENTED

Landed: `IDLE_DT` replaced with `idleDt()` in `renderer.ts`. Verified on Expo
Web (WebGL clear-count probe, 120Hz display): idle 26fps, chat idle 14.5fps,
chat+talking 26.5fps, back to 14fps when talking ends, pointer → 120fps
instantly, chat closed → 26.5fps. Remaining: on-device feel check (Part A).

While the chat sheet is open, the scene is a small character in the top band —
the longest-dwell, highest-thermal state (streaming + keyboard + GL at once).

Design: make the idle interval state-dependent instead of constant.

```ts
// replaces the constant IDLE_DT
const idleDt = () => {
  if (holdingPhone && !talking) return 1 / 15; // chat sheet up, character at rest
  return 1 / 30;
};
```

- `holdingPhone` is the renderer's existing chat signal (set from
  `chatOpen` in app/index.tsx via `setHoldingPhone`).
- `talking` lifts chat idle back to 30fps so the mouth stays fluid while the
  sidekick is actually speaking; when the reply finishes it drops to 15.
- All the existing wake paths are untouched: opening/closing the sheet is a
  framing + phoneBlend transition, so the scheduler already runs full-rate
  during the slide and only re-enters idle once settled.

**Floor is 15fps — do not go lower.** `dtFrames` clamps at 4 (= a 15fps step);
below that, dt-based eases would slow down instead of staying time-correct.
Going lower would require raising the clamp, which also raises the "snap after
a stall" ceiling — not worth it.

Implementation is ~4 lines in `renderer.ts`:
1. Replace `IDLE_DT` const with `idleDt()` (or compute inline in the skip test
   at ~line 891).
2. No API/prop changes — both signals already reach the renderer.

## Not in scope (follow-ups, in value order)

- Pause the loop entirely on `AppState` background and when a pushed route
  (`/settings` etc.) fully covers home — the only true full-cover cases.
  Needs a `setPaused` on the controller (pattern exists in `avatar.ts`).
- Same 30fps idle cap for the mini closet-button avatar's GL loop
  (`avatar.ts` ~205) — smaller surface, smaller win.
- Game scenes (`games/*.ts`) run their own uncapped loops while open.

## Verification

- **Web (automated):** Expo Web + playwright on `/sidekick-3d` or onboarding —
  read the dev FPS overlay / add a temporary probe: idle fps ≈ 30; with
  `setHoldingPhone(true)` + settled camera, fps ≈ 15; `setTalking(true)`
  brings it back to ≈ 30; any pointer event returns instantly to full rate.
- **Device (the real test):** FPS overlay on the home screen — idle 30;
  open chat, wait for the slide to settle → 15; send a message → 30 while the
  reply streams/speaks, back to 15 after. Then the hand-on-phone test during a
  long chat session vs. before.
- Watch the `skipped` counter in the overlay: in chat idle at 15fps on a 60Hz
  panel it should read ~45/window-second (3 of every 4 ticks skipped).
