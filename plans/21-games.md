# 21 — Chat mini-games: 8 Ball & Cup Pong

## Goal

GamePigeon-style games played **inside the sidekick chat**, against the
sidekick. Either side can start one: the user from the composer's `+` drawer,
the agent via a tool when it's contextually natural. A match lives in the
transcript as a single interactive card that always shows current state, play
happens full-screen over the chat, and the agent gets tasteful, minimal
context about what happened — enough to react like a friend, never a
sportscaster.

First two games: **8 Ball** (pool) and **Cup Pong**. The architecture is a
generic "match" primitive so later games (darts, mini golf…) are a new engine
+ scene, not new plumbing.

## Product decisions (the ones that shape everything)

1. **Live match, not async turns.** GamePigeon alternates message bubbles
   because both players are humans on different phones. Our opponent is the
   sidekick — making the user wait for a fake "reply" would be theater at the
   user's expense. A match plays out in one full-screen session: you shoot,
   the sidekick visibly aims and shoots (with a short 0.8–1.5s "thinking"
   beat so it feels like a player, not a slot machine), repeat until done.
   Matches are server-persisted, so closing mid-game is fine — the card says
   "Your move" and tapping it resumes.

2. **One card per match, updated in place.** GamePigeon's best trick is the
   MSSession collapse: one live bubble per match, never a trail of stale
   ones. We get this for free because our transcript is server-rendered: the
   match card is one `messages` row whose payload is **joined from the
   `gameMatches` table at history time**, so it always shows current state
   (in progress: "Your move · 4 cups left"; finished: final result). No
   per-turn messages, no stale bubbles, no summary-line litter.

3. **Client is the physics authority; server stores state.** There is no PvP
   and no meaningful cheating incentive (rewards are small and flat — see
   economy). Full server-side physics replay would be textbook
   over-engineering. The deterministic engine lives in `@sidekick/core`
   (pure, seeded, fixed-timestep), the client runs it for both players, and
   the server upserts state snapshots per turn (idempotent) exactly like
   guided sessions do with `sessions.progress`.

4. **The sidekick's play is a game AI, not an LLM.** Shot selection is
   deterministic-seeded search in core (simulate candidate shots with the
   same engine, add execution noise). The LLM never picks shots; it only
   talks about the game afterwards. Target ~45–55% sidekick win rate.

5. **Recipient breaks/throws first**, matching GamePigeon's invite model:
   user starts a game → sidekick breaks; sidekick invites → user breaks.
   Accepting an invite = taking the first turn; no separate accept step.

6. **Agent context is minimal and opt-in-feeling.** The agent sees: the
   active match (one line), the last completed match within 24h (result + at
   most 2 genuinely notable highlights), and the lifetime record (one line).
   Guidance explicitly caps reactions at one short message and bans fake
   enthusiasm. Details in §Agent integration.

7. **All-procedural 3D, zero new art assets.** Both scenes are built from
   three.js primitives with the app's cel shading (`three/shading.ts`) —
   table plane, spheres, lathe/cylinder cups. This sidesteps the whole GLB
   pipeline (texture stripping, de-interleaving, sync-cosmetics) and matches
   the toy-like home-screen aesthetic. Stripes on pool balls are a shader
   band, not textures. Card thumbnails in chat are plain RN Views (mini
   top-down table / cup triangle), no GL.

## Game specs

### 8 Ball (faithful to GamePigeon's simplified ruleset)

Layout: portrait, vertical table filling most of the screen. Top strip: user
avatar (monogram) and sidekick avatar with each player's remaining group
shown as small ball dots beneath (assigned after first pot; "—" before).

Controls (GamePigeon-accurate):
- **Aim**: drag anywhere on the table to rotate the cue around the cue ball;
  drag distance from start maps to angular sensitivity so small drags fine-
  tune. Guide: white line from cue ball to ghost-ball contact point + short
  stub off the object ball showing its direction. A small ✕ on the indicator
  when the first contact would be an opponent's ball.
- **Power**: vertical cue-stick track on the left edge — press, drag down to
  pull the stick back, release to shoot. Release below a minimum pull
  cancels (no accidental taps).
- **Spin**: cue-ball button on the right opens a large ball; drag the red
  contact dot (follow/draw/english). Persists until changed.
- **Ball-in-hand** after a foul: the cue ball lifts slightly and the user
  drags it anywhere legal; sidekick places it via AI.

Rules: break; first pot assigns solids/stripes; pot your ball → shoot again;
miss or foul → turn passes. Fouls: scratch, cue off table, wrong-group first
contact → ball-in-hand. 8-ball after clearing your group wins; early 8 or
scratching on the 8 is an instant loss. No called pockets (GamePigeon
doesn't). No shot clock.

Physics (core, 2D top-down under the 3D dressing — the standard mobile
approach): circles + segment cushions + capture-circle pockets; elastic
ball–ball collision (equal masses: swap normal components), cushion
restitution ~0.75; sliding→rolling friction model simplified to exponential
damping with a stop threshold; spin implemented as post-impact velocity
adjustment along/against the aim line (follow/draw) and modified cushion
rebound (english). Fixed timestep (120Hz sim, rendered at display rate) so a
shot vector replays identically — this is what makes seeded AI search and
turn resume trivial.

Sidekick AI: enumerate legal target balls → sample ~40 candidate (angle,
power) pairs biased toward pocket lines → simulate each with the real engine
→ score (legal pot > safety > position) → pick best, then apply gaussian
execution noise to angle/power (σ from difficulty). The aim line visibly
sweeps to the chosen shot before firing so the user watches it "decide".

### Cup Pong (faithful, including its omissions)

Layout: portrait; opponent's 10 cups in a 4-3-2-1 triangle at top, your cups
mirrored small at the bottom, white center line as the aiming reference.

Controls: drag the ball up and release — a flick. Swipe angle → lateral
direction, swipe speed/length → distance. The ball flies a real parabola
rendered in 3D (scale-up-then-down adds the depth read). Landing test: the
descending ball's landing point vs cup-mouth circles, with a small rim
tolerance band that produces near-miss wobbles for feel.

Rules: 2 balls per turn; make both → balls back (throw again). Cup vanishes
immediately when made (quick shrink-pop + haptic). Auto re-rack at 6 and 3
remaining. First to clear all 10 wins. **No bounce shots, no redemption** —
GamePigeon omits both and so do we.

Sidekick AI: pick a target cup (front-most weighted), sample landing point
from a 2D gaussian around it (σ from difficulty), animate the resulting
parabola. Trivially tunable.

### Shared feel

- Haptics: light impact on aim ticks/cup taps, medium on cue strike/throw
  release, `success` notification on pot/cup, `warning` on foul/loss of
  turn. (Native only, as everywhere else.)
- The sidekick's turns run at natural pace: beat, aim animation, shot,
  results settle, control returns. Total ~2–4s per sidekick shot.
- Top-right ✕ closes the overlay any time (match stays active). A small menu
  (⋯) offers **Resign** with a confirm.
- End state: banner in the game view ("You won" / "Sidekick wins"), settle
  animation, then auto-dismiss to chat after ~1.5s where the card now shows
  the final state and the sidekick's one reaction message lands.

## Data model

### DB (`packages/db/src/schema.ts`)

```
gameMatches
  id             uuid pk default random
  userId         uuid fk → users.id, not null
  conversationId bigint fk → conversations.id, not null
  gameType       text not null            -- 'eight_ball' | 'cup_pong'
  initiator      text not null            -- 'user' | 'sidekick'
  status         text not null default 'active'
                                          -- 'active' | 'complete' | 'resigned' | 'expired'
  state          jsonb not null           -- engine state snapshot (schema owned by core)
  turnNo         integer not null default 0
  seed           integer not null         -- AI determinism + replay
  winner         text                     -- 'user' | 'sidekick' | null
  highlights     jsonb not null default '[]'  -- string tags, capped at 4
  createdAt / updatedAt / completedAt timestamptz
```

`messages` gains `gameMatchId uuid fk → gameMatches.id` — the exact
`adUnitId` precedent (`schema.ts:283`). The card is one message row; its
render payload is joined at history time.

No stats table: the record is `count(*) group by winner` over `gameMatches`
per gameType — cheap at this scale, derived in the router.

### Engine state (in `@sidekick/core`, zod-validated at the router)

`EightBallState`: ball positions/velocities (settled between turns, so
velocities are zero at rest), pocketed lists, groups assignment, `toMove`,
`ballInHand`, foul flag. `CupPongState`: cups remaining per side (bitmask of
the 10 slots), `ballsThisTurn`, `toMove`. Both carry `version` for forward
compat.

## Server (`packages/server`)

New `games` router (follows the plan-20 domain recipe):

- `games.create` (mutation, `{ gameType }`) — guard: no existing `active`
  match of that type for the user (return it instead — tapping "8 Ball"
  twice resumes, never forks). Creates the match (initiator `'user'`, seed
  from crypto random, initial state from core's `initialState(gameType,
  seed)`) **and the user-role card message row** in one transaction. Returns
  the match. No LLM call — the user is about to play, not chat.
- `games.get` (query, `{ matchId }`) — full state for opening the overlay
  (the card join carries only summary fields).
- `games.turn` (mutation, `{ matchId, turnNo, state, events }`) — upsert
  idempotent on `(matchId, turnNo)`: rejects if `status != 'active'` or
  `turnNo` regresses; folds notable `events` into `highlights` (server-side
  cap + allowlist of tags). Fired at the end of each turn and on overlay
  close.
- `games.complete` (mutation, `{ matchId, finalState, winner, highlights }`)
  — guarded transition (`active → complete`, idempotent replay returns the
  stored result): persist final state, grant coins through the **ledger**
  (`grantReward`, dedupe `game:<matchId>`), bump `stateVersion`, then
  generate the sidekick's single reaction message (below). Returns
  `{ stateVersion, coins }` for snapshot patching.
- `games.resign` (mutation, `{ matchId }`) — `active → resigned`, winner
  sidekick, **no reaction message** (a resigned game gets silence, not
  commentary; it stays visible in context for one day so the agent can
  respond naturally if the user mentions it).

Expiry: lazy — any read (card join, `games.get`) that touches an `active`
match idle > 48h flips it to `expired` (no winner, no reward, no reaction).
No cron needed.

Economy (numbers live in `@sidekick/core` next to the other economy
constants): win **20** coins, loss **5** — flat, participation-flavored, and
only the **first 3 completed matches per local day** pay out (server counts
`game:*` ledger rows for `localDate(users.timezone)`; later matches grant
0 and the client shows no coin toast). Small + capped = nothing worth
cheating, which is what licenses decision 3.

Card payload (added to the history join in `routers/chat.ts` `withAttachments`
style, and to the `ChatMessage` type in `chat-thread.ts`):

```
game: { matchId, gameType, status, yourMove: boolean, winner,
        summary: { ballsLeft?: {user, sidekick}, group?: 'solids'|'stripes',
                   cupsLeft?: {user, sidekick} } }
```

Input schemas join `packages/shared/app/src/schemas.ts`; state payloads are
validated with core's zod schemas (size-capped) so garbage can't be
persisted.

## Agent integration (the non-cringe contract)

### What the agent knows — `renderGamesBlock`

A new system block in `buildContextView` (`packages/shared/app/src/context.ts`),
modeled on `renderDeepTalkBlock`, emitted **only when there's something to
say** (never for users who've never played):

```
=== GAMES ===
active: cup pong, user's move, sidekick leads 6 cups to 3
last match: 8 ball, user won, yesterday (highlight: ran 4 in a row)
record: 8 ball 3–2 user · cup pong 1–4 sidekick
```

Highlights come from the engine's event tags, filtered server-side to an
allowlist of genuinely notable ones: `ran_3_plus`, `scratched_on_8`,
`won_on_8_early_opponent` (opponent's early 8), `balls_back_x2`,
`comeback_from_3_down`, `clean_sweep`. Ordinary makes/misses never surface.

### How the agent behaves — capability guidance

New `games` capability in `packages/shared/app/src/tools/index.ts` with
`promptGuidance` (assembled by `selectGuidance`). The guidance, roughly:

> you can play 8 ball and cup pong with them. react to a finished game like
> a friend who was just playing: one short message max, then drop it unless
> they bring it up. be specific only when something was actually notable
> (the highlights list is what's notable — if it's empty, a plain "gg" beats
> invented enthusiasm). you're allowed to be smug when you win and a good
> sport when you lose — never fake-sympathize ("so close!!") and never
> recite scores or stats unasked. offer a rematch occasionally, not every
> time. don't bring up the record unless they do.

This plus `PERSONA_PROMPT` (lowercase, texty, cheeky) is the whole voice —
no per-game scripted lines anywhere.

### The one reaction message

On `games.complete`, the server generates a single assistant message via
`ctx.model` with the persona + games guidance + the match result (the same
outside-a-turn insertion precedent as `proactivity/generator.ts`), inserted
into the main conversation. One bubble, no push notification (the user is in
the app, one tap from the chat). The client refetches the transcript when
the overlay dismisses, so the message appears right as they land back in
chat. Failure to generate is non-fatal — the match context block still lets
the agent react on the next turn.

### Agent-initiated games — `invite_game` server tool

`packages/shared/app/src/tools/games.ts`: a **server** tool
(`defineTool`, execution `'server'`) `invite_game({ gameType })`:

- Guards: no active match of that type; unprompted invites (user didn't ask
  to play in this turn — the model self-reports via a `prompted` boolean
  input, and the server also rate-limits) capped at **1 per local day** via
  ledger-style dedupe on a `game-invite:<date>` marker.
- Execute: create the match (initiator `'sidekick'`) + insert the
  assistant-role card message. The model's own streamed text ("loser buys
  coffee") arrives as the adjacent normal bubble.
- Tool guidance: use it when the user asks to play, when they seem bored or
  want a break, or to settle something playfully — never as a reflex and
  never twice in a row after a decline.

Because it's a server tool, the exact same tool works from **proactive
turns** later ("been a minute — rematch?" carrying a card). Proactive game
invites are explicitly a later phase: the policy hook exists in
`proactivity/`, we just don't wire it in v1.

## Client (`packages/expo`)

### Chat surface

- `imessage/types.ts`: `MessageKind` gains `"game"`; `Message` gains
  `game?: GameCardView`. `imessage/server.ts` `toMessage` branches on the
  joined payload; `messageSummary` returns "8 Ball" / "Cup Pong" (feeds
  reply quotes and previews).
- `imessage/components/GameCardBubble.tsx` — the card, rendered by the new
  branch in `MessageContent.tsx`. iMessage app-message look: 250pt-wide
  rounded-18 surface (no bubble tint), thumbnail area on top (RN-View mini
  render: green felt + ball dots for pool, cup triangles for pong), bottom
  strip with a small game glyph + name + status line ("Your move" / "You
  won" / "Sidekick wins" / "Expired"). Sender-aligned left/right like any
  message; tapbacks and swipe-reply work unchanged (row-level gestures).
  Pressable: active matches open the overlay; finished cards open a
  read-only final view (same scene, no controls — cheap and satisfying).
- `PlusDrawer.tsx`: `DrawerAction` gains `"games"`, ITEMS gains
  `{ key: 'games', label: 'Games', icon: gamecontroller }` (SF symbol via
  `Icon.tsx`, Lucide fallback `gamepad-2`). `handleDrawerAction` in
  `ChatScreen.tsx` opens `GamePickerSheet` — a `BottomSheet` with two big
  tiles (mini table / cup triangle art in Views, name, your record beneath
  in `gray1`). Picking one calls `games.create` and opens the overlay
  directly (the card appears in the transcript on next refetch — the user
  is already in the game by then).

### The game overlay

Mounted at the home screen level (`app/index.tsx`) as an absolute overlay
above the chat drawer, exactly the `SessionChat`/`StarChat` pattern
(`index.tsx:409/437`), gated on `activeMatchId` state; `ChatScreen` gets an
`onOpenGame(matchId)` prop threaded to the card the same way reply handlers
are. `GameOverlay.tsx` fetches `games.get`, then hosts the scene:

- Its own `GLView` (fresh context per session, disposed on close),
  following the `SidekickCanvas` recipe: `onContextCreate` → imperative
  controller, `gl.endFrameEXP()` per frame, MSAA 4 on device, raw RN
  responder → normalized coords for input, Reanimated `SharedValue` bridge
  for anything HUD-pinned. `pointerEvents="none"` on the GLView; the
  wrapper owns touches.
- Gated on `SCENE_3D_ENABLED` like the mascot: on the iOS **simulator** the
  overlay shows the existing fallback treatment ("games need a real device
  or web"). Dev loop is **Expo Web** (real WebGL2) + physical device for
  haptics/feel.
- Scenes live in `packages/expo/src/three/games/` (`pool-scene.ts`,
  `cup-pong-scene.ts`, shared `game-scene.ts` harness) until
  `@sidekick/three` exists — same home as the rest of the 3D code. Cel
  materials from `shading.ts`; camera: fixed high-angle portrait framing
  per game (no orbit).
- HUD (avatars, group dots, power track, spin button, banners) is RN over
  the canvas — Reanimated, `imessage/theme.ts` type scale for in-chat
  surfaces, brand tokens for the playful bits.

### Match flow wiring

`useMatch(matchId)` hook owns the loop: core engine instance seeded from
server state → user input → `simulate` → animate → on turn end,
`games.turn` upsert (fire-and-forget with retry; upsert semantics make
replays safe) → if `toMove === 'sidekick'`, run AI + animate → repeat. On
terminal state, `games.complete`, play the banner, patch the snapshot with
the returned `{ stateVersion, coins }` via `lib/state.ts`, dismiss, and
invalidate the transcript query (card updates + reaction message appears).
Closing mid-turn flushes a final `games.turn`. Reopening replays nothing —
state loads settled between turns; if `toMove` is sidekick (user closed
before the AI moved), the AI takes its turn on open.

## `@sidekick/core` additions (`packages/shared/core/src/games/`)

- `types.ts` — match/state/shot/event types + zod schemas.
- `eight-ball.ts` — table geometry constants, `initialRack(seed)`,
  `simulateShot(state, shot): { events, finalState }` and a stepping variant
  for animation (`createShotSim` the scene advances per frame), rules
  (fouls, groups, win/loss), `chooseShot(state, rng, difficulty)`.
- `cup-pong.ts` — `throwOutcome(state, flick)` (landing point + noise →
  cup/miss), re-rack layouts for 6 and 3, `chooseThrow`, parabola params for
  the scene to animate.
- `ai.ts` — shared seeded RNG (mulberry32-style), difficulty profile
  (σ values; static v1, one knob per game).
- `economy.ts` gains the game reward constants next to the existing ones.

Everything pure and platform-free; the server imports the zod schemas +
`initialState`, the client imports everything.

## Failure & edge behavior

- Offline mid-match: play continues locally (engine is local); `games.turn`
  retries on reconnect; `games.complete` is required for rewards/reaction,
  and the overlay holds the end banner with a retry if it fails.
- Two devices: `games.create`'s active-match guard returns the existing
  match; stale `games.turn` from the other device loses on the `turnNo`
  guard. Honest-but-simple, same stance as plan 20's multi-device answer.
- The reaction-message generation failing never fails `games.complete`
  (reward and state commit first; generation is after the transaction).
- Deleting the card message (existing `deleteMessage`) leaves the match row
  — history cleanup only, record intact.

## Testing

- **Core (vitest, pure):** rack/re-rack layouts; conservation + settle
  determinism (same seed + shot → identical final state); rule matrix
  (scratch → ball-in-hand, early 8 → loss, wrong-group foul, balls-back,
  re-rack at 6/3, win detection); AI returns legal shots across 100 seeded
  states and lands in the target win-rate band vs a scripted baseline.
- **Server (vitest + PGlite):** create guards (dup active match returns
  existing), turn upsert idempotency + regression rejection + status guard,
  complete idempotency + ledger grant + daily-cap (4th match pays 0) +
  stateVersion bump, resign silence, lazy expiry, highlight allowlist/cap,
  invite tool daily cap + card-message insertion, history join payload
  shape.
- **Manual (Expo Web + physical device, per repo practice):** full cup pong
  match end-to-end (invite from `+`, play, watch reaction message land);
  full 8 ball match incl. a foul + ball-in-hand; close mid-match → card
  says "Your move" → resume; resign; sidekick-initiated invite (prompt "you
  wanna play pool?"); check the reaction voice against persona; confirm
  simulator shows the fallback, not a broken canvas.

## Sequencing

Each phase ships working; all phases get implemented.

1. **Core engines.** `games/` in core with full test suites — cup pong then
   8 ball. No UI; this derisks physics and AI tuning first.
2. **Match backbone.** Migration, `games` router, `messages.gameMatchId`,
   history-join payload, schemas, PGlite suites. Card renders in chat
   (static, tap does nothing yet).
3. **Cup Pong playable.** Overlay host + GL harness + cup-pong scene, `+`
   drawer entry + picker sheet, `useMatch` loop, completion → ledger →
   snapshot patch. The simpler game proves the whole loop.
4. **8 Ball playable.** Pool scene, aim/power/spin controls, ball-in-hand,
   AI shot presentation.
5. **Agent integration.** `renderGamesBlock`, games capability guidance,
   completion reaction message, `invite_game` tool + guards.
6. **Polish.** Haptics pass, end-of-game choreography, read-only finished
   view, difficulty tuning against real play, card thumbnail fidelity.

Later (explicitly out of v1): proactive game invites, more games, adaptive
difficulty, Hard mode (no aim guide) toggle, spectator flourishes (sidekick
mascot reacting at the table).
