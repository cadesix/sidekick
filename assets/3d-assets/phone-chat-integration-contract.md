# Phone chat ↔ 3D Sidekick — integration contract

How the phone home screen's chat UI ties into the live 3D character scene, and
what a full "phone chat" integration still needs to wire up. Read `README.md`
first for the character overview.

## Scope

The product home is **`/home4`** (`src/home4.tsx`): a full-viewport Three.js
scene (`SidekickCanvas`) with the character standing in the time-of-day meadow,
a floating chat button, and a chat **drawer** (`src/chat.tsx`) that slides up
over the scene. This doc is the seam between that 2D chat UI and the 3D scene.

## The 3D surface: `SidekickCanvas`

`src/components/sidekick-canvas.tsx`, props:
- `className?` — sizing/positioning (home4 uses `absolute inset-0`).
- `framing?: CanvasFraming` — `{ pos, target, fov? }`. **The camera eases toward
  this every frame** (smooth lerp), so swapping `framing` animates the camera.
- `landscape?: boolean` — adds the vista landscape + wide fog (for `/vista`; off
  for home4).

It is otherwise self-contained: it loads the character GLB, applies the active
time-of-day scene, runs the idle/breathe/wind, and owns the poke/drag interaction.
It does **not currently expose a handle** to drive the face — see Open items.

## Camera framing states (home4)

Two module constants, switched on `chatOpen`:
- `HERO_FRAMING` — character centered, full-viewport hero (chat closed).
- `CHAT_FRAMING` — pulled back + looking low so the character sits **high in the
  sky above the chat box**, with room above the drawer.

`framing={chatOpen ? CHAT_FRAMING : HERO_FRAMING}` → the canvas eases between them
on open/close. Tune these two constants to reframe; no canvas changes needed.

## Chat drawer UI contract

- Drawer is `absolute inset-x-0 bottom-0 top-[45%]` (covers the lower ~55%),
  `animate-sheet-up` / `animate-sheet-down` on open/close, `mounted` keeps it in
  the DOM through the exit.
- Tapping the band above the drawer, or the chevron, closes it.
- `<Chat transparentTop peekIn={false} />` — home4 passes **`peekIn={false}`** so
  the old 2D peek PNG (`/chat-header.webp`) does NOT render; the **real 3D
  character** peeks/sits above the drawer instead. (`peekIn` defaults `true` for
  other hosts like /home3 that still want the PNG.)

`Chat` (`src/chat.tsx`) today renders a hardcoded greeting + a `message` input and
posts to the dev-only `/api/chat` proxy (OpenAI, key server-side, see
`vite.config.ts`). It does not yet drive the 3D character.

## Driving the character from chat (the missing wire)

The face is controlled by `createFaceController` (`src/components/sidekick-face.ts`):
- `set(expr)` — base expression (neutral, happy, sad, surprised, cheer, …).
- `pulse(expr, seconds)` — temporary expression.
- `setTalking(on)` — mouth-flap loop (talkOpen/talkClosed at ~8 Hz).
- `setBlinking(on)` — auto-blink (on by default).

This controller lives **inside** `SidekickCanvas` and is not exposed. To make the
character react to chat, the integration must surface it. Recommended shape:

```ts
// SidekickCanvas adds an imperative handle (ref) or callback props:
type SidekickHandle = {
  setExpression: (e: FaceExpression) => void;
  pulse: (e: FaceExpression, seconds?: number) => void;
  setTalking: (on: boolean) => void;
};
```

Then the chat drives it: `setTalking(true)` while a Sidekick reply is streaming
in (and `false` when done), `pulse("happy"|"surprised"|…)` on sentiment or
keywords, `setExpression("thinking")` while awaiting a reply, etc.

## Time-of-day

The scene mood is `settings.timeOfDay` (`day`/`evening`/`night`) → `settings.scenes[…]`
(sky, fog, grass, rocks, character tint, lights, exposure). The chat/home should
pick this from real device time (or user setting) so the meadow matches the time
of day. Presets are tunable in `/sidekick-3d` → "Time of Day" panel.

## Open items for the phone-chat integration

- [ ] Expose a face/talking handle from `SidekickCanvas` (ref or props) and wire
      the chat to it (talking while replying, expressions on sentiment).
- [ ] Real chat backend/history (replace the hardcoded greeting + single-turn
      proxy) and streaming.
- [ ] Drive `timeOfDay` from device time / user preference.
- [ ] Optional: camera nudge or a `pulse` reaction when a new message arrives.
- [ ] Persisted look config: the scene presets + framing live in
      `sidekick3d-settings-v2` localStorage; decide how the app ships/embeds the
      approved config (bake into `DEFAULT_SETTINGS`, as done today).
