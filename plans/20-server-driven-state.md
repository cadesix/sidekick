# 20 — Server-driven state: retire the on-device progression stores

## Goal

Move every piece of user progression that today lives only in AsyncStorage —
coins, owned cosmetics, worn outfit, shop purchases, streak, daily box, bond,
guided-session progress, extracted profile (fields/notes), the astral card,
and goal checks — to the server as the single source of truth. The client
becomes a React Query cache over tRPC, exactly like chat/documents/reminders
already are. Nothing is in prod, so **no back-compat and no data migration**:
stale AsyncStorage keys are simply abandoned.

Why now: signed-in accounts (19-auth) are meaningless if progression evaporates
on reinstall or doesn't follow the account across devices; IAP/streak-freeze
plans (`docs/token-economy.md` §Integrity) hard-require server-validated grants;
and the current setup ships an OpenAI API key in the client bundle (see below).

## Current state — the full picture

There are **two parallel gamification systems** in the repo:

1. **The live one (client-only).** The UI (`ShopSheet`, `StreakPill`,
   `StreakModal`, `GoalsSheet`, `SessionChat`, `WorldMap`, `app/index.tsx`)
   runs entirely on zustand-persist stores in `packages/expo/src/store/` plus
   raw AsyncStorage in `src/three/`. Logic and numbers live in `@sidekick/core`
   (pure); the stores are thin persistence adapters. This implements the
   current design: coins (`docs/token-economy.md`), seeded shop rotation,
   daily box, app-open streak, bond, guided sessions.
2. **A dead server one (sparks era).** `packages/server` has a full
   cosmetics/rewards system from the older plans 04/07: `users.sparks`,
   `userCosmetics`, `rewards` (idempotent grant ledger), `cosmetics.{inventory,
   equip, unequip, redeem, rewardStatus, spin}`, a check-in spinner, and an
   hourly `/cron/rewards/grant` sweep. `api.ts` wraps all of it, but **no
   screen uses any of it** (only `focus.ts` reads `home.streak`). Its currency
   (sparks), reward vehicle (spinner-per-check-in), and catalog
   (`COSMETIC_CATALOG` in `@sidekick/shared`) all contradict the current
   token-economy design (coins, daily box, no chat/goal-attached rewards).

This plan collapses the two: the **coins design wins** (it's the product), and
the **server's grant-ledger skeleton wins** (it's exactly the "grant log keyed
by date + faucet id" the token-economy spec demands). The sparks-specific parts
get deleted.

### Inventory of on-device state and its fate

| Key | File | Contents | Fate |
|---|---|---|---|
| `sidekick_economy_v1` | `store/economy.ts` | coins + owned renderKeys | **→ server** (`users.coins`, `userCosmetics`) |
| `sidekick_bond_v1` | `store/bond.ts` | bond 10–100 | **→ server** (`users.bond`) |
| `sidekick_context_v1` | `store/context.ts` | session progress, fields, notes, astral, unseenIsland | **→ server** (3 new tables + `users.astral`); `unseenIsland` stays client |
| `sidekick_daily_box_v1` | `store/dailyBox.ts` | last-claimed date | **→ server** (`rewards` ledger row per day) |
| `sidekick_goals_v1` | `store/goals.ts` | chosen goals + weekly booleans | **→ server** (existing `goals`/`checkIns` system) |
| `sidekick_streak_v1` | `store/streak.ts` | count + last day | **→ server** (`users.streakCount/streakLastDay`) |
| `sidekick-wardrobe-v1` | `three/wardrobe.ts` | worn item per slot | **→ server** (`userCosmetics.equipped`) + local boot cache |
| `sidekick3d-settings-v2` | `three/settings.ts` | skin color + ~60 look-dev knobs | **skin → server** (`users.skin`); look-dev stays local |
| `sidekick_star_face_tuning` | `store/starFaceConfig.ts` | dev-only sliders | stays local (slated for deletion anyway) |
| `sidekick.deviceId` / `sidekick.token` | `lib/auth.tsx` | credentials | stays (19-auth owns this) |
| `health-agent-sharing-enabled`, `sidekick.locationEnabled`, `sidekick.lastLocatedMs` | `lib/health.ts`, `lib/location.ts` | device-scoped consent flags + throttle | stays local (consent is per-device; the data already syncs) |
| `sidekickFocusSettings` | `lib/focus.ts` | Screen Time config | stays local (must live in the iOS App Group for the extension) |

### Two adjacent problems this migration fixes in passing

- **Client-side OpenAI key.** `SessionChat.tsx` (`llm()`, line ~125) calls
  `api.openai.com` directly with a key bundled into the app. Moving the
  session engine's LLM calls server-side removes the key from the client.
  Rotate the key regardless — it's also committed in the root `.env`.
- **`START_COINS` 250 → 150.** Token-economy calls for this; since the server
  now seeds balances, it lands as the `users.coins` column default in the same
  migration.

## Key decisions

1. **Coins are the only currency; the sparks system is deleted.** Drop
   `users.sparks`, `cosmetics.redeem/rewardStatus/spin`, `rollReward`,
   `REDEEM_COST`, the spinner sweep in `rewards/cron.ts` (+ its vercel.json
   cron), and `COSMETIC_CATALOG`. **Keep** `grantReward` + the `rewards` table:
   it becomes the coin/item grant ledger (`kind: 'coins' | 'item'`, `sparks`
   column renamed `coins`). Every faucet flows through it with a dedupe key
   (`daily-box:<date>`, `session:<sessionId>`, `milestone:<day>`), which makes
   every grant idempotent — cron re-runs and client retries are no-ops, per
   the token-economy integrity requirement.
2. **`renderKey` is the canonical item identity** (`${slot}-${variantId}` /
   `${slot}-c<hex>`), stored in `userCosmetics.itemKey`. The shop catalog is
   already pure data in `@sidekick/core` (`PRICE`, `buildProducts`,
   `todaysShop`); what the server lacks is the variant manifest.
   `scripts/sync-cosmetics.mjs` additionally emits a platform-agnostic catalog
   module into `@sidekick/core` (slot → variant ids + names; no texture refs —
   expo's generated manifest keeps those). Server and client build the exact
   same product list from the same code; prices are validated server-side.
3. **Balances are columns, mutations are transactions.** `users.coins` and
   `users.bond` are plain integers updated in the same transaction as their
   cause (ledger row insert, purchase, session completion). Spends guard with
   a conditional `UPDATE … WHERE coins >= cost RETURNING` — no oversell under
   concurrency. Purchases don't need a second ledger: `userCosmetics` gains
   `source` (`'starter' | 'purchase' | 'reward'`) and `cost` columns, so
   acquisition history lives on the ownership row.
4. **All "local day" logic moves to the server clock + `users.timezone`**,
   via the existing `localDate(userTimezone)` helper the check-ins system
   already uses. The client never decides what day it is. Seeded rolls
   (`rollDailyBox`, `todaysShop`) run server-side with the same core
   functions — server imports `@sidekick/core` (it's pure; this is a new but
   legal dependency direction).
5. **Streak keeps app-open semantics** (faithful port of `computeStreak`):
   `streak.touch` mutation called once per foreground, idempotent per local
   day, columns on `users`. The server-side *check-in* streak
   (`goals` router / `home.streak`) is a different per-goal concept and stays
   as is. The streak-freeze sink lands later as a consumable checked inside
   `touch` — now possible because touch is server-side.
6. **Goals: adopt the existing server system, don't port the checkbox store.**
   This is the one real product fork. The server already has the richer
   goals/check-ins system (adopt/list/detail/adjust/pause/complete, `checkIns`,
   per-goal streaks, chat `log_checkin` integration per `plans/user-memory.md`)
   — it's built and tested, just not wired to the UI. Porting the local weekly
   checkbox model to the server would create a *third* system. Instead:
   `GoalsSheet` re-wires onto `goals.list` + a new `goals.logCheckIn` mutation
   (manual source, upsert on `(goalId, date)`), and the weekly strip renders
   from check-in rows. `store/goals.ts` is deleted.
7. **Guided sessions move server-side whole**: progress, extraction output,
   astral, bond, and coin grants. The session *engine* stays
   client-orchestrated (scripted beats, UI phases — a faithful port, not a
   rewrite), but its two LLM touchpoints (`fetchAck`/probe and the extraction
   pass) become tRPC procedures so the model calls run server-side through the
   existing `model.ts` plumbing. Extracted fields/notes keep their current
   shapes in dedicated tables. Unifying them with the `memories` system is
   deliberately out of scope (they're differently shaped and prompt-coupled) —
   noted as a follow-up, same for merging `users.bond` with the deep-talks
   `users.contextScore` (two implementations of "how much the sidekick
   knows"; flagged, not unified here).
8. **The 3D scene gets a boot cache, not a persisted store.** The renderer
   reads wardrobe/skin synchronously before any network. Keep the existing
   AsyncStorage keys (`sidekick-wardrobe-v1`, skin colors inside
   `sidekick3d-settings-v2`) as a **write-through mirror of server state**:
   hydrate the scene from the mirror instantly, reconcile when the snapshot
   query lands, update the mirror on every equip/skin mutation. Server is
   truth; the mirror is disposable.
9. **One cold-start snapshot query.** New `state.snapshot` procedure returning
   `{ coins, bond, streak, dailyBox: { claimable, tier }, inventory, equipped,
   skin, astral, sessions }` so app launch is one round trip instead of seven.
   Individual mutations return the fields they change; React Query patches the
   `['snapshot']` cache (optimistic for purchase/equip/goal-toggle, where the
   UX needs instant feedback).

## DB schema changes (`packages/db/src/schema.ts`)

`users`:
- add `coins integer not null default 150`
- add `bond integer not null default 10`
- add `streakCount integer not null default 0`, `streakLastDay date`
- add `astral jsonb` (`{ archetype, reading, traits } | null`)
- add `skin jsonb` (`{ body, shadow } | null` — the two cel colors)
- drop `sparks`

`userCosmetics`:
- add `source text not null default 'reward'`, `cost integer`
- (itemKeys are now renderKeys; existing unique `(userId, itemKey)` already
  gives purchase/grant idempotency)

`rewards`:
- rename `sparks` → `coins`; `kind` values become `'coins' | 'item'`

New tables:

```
guided_sessions
  userId       uuid fk → users.id, not null
  sessionId    text not null            -- id from core SESSIONS catalog
  beat         integer not null default 0
  answers      jsonb not null default '[]'
  done         boolean not null default false
  completedAt  timestamptz
  updatedAt    timestamptz not null default now
  unique (userId, sessionId)

session_fields                          -- extracted profile k/v
  userId    uuid fk, key text, value text, updatedAt timestamptz
  unique (userId, key)

session_notes                           -- verbatim captures
  id uuid pk, userId uuid fk, tag text not null, text text not null,
  sessionId text, createdAt timestamptz default now
```

`checkIns` gains a `source text not null default 'chat'` column if it doesn't
already distinguish manual entries (needed by `goals.logCheckIn`).

Migration: `pnpm db:generate` → new migration on the fresh baseline. Update
`packages/db/src/testing.ts` only if PGlite needs anything beyond the schema
import.

## Server changes (`packages/server`)

**New `state` router** — `snapshot` (protected query) assembling the payload in
decision 9. Grants starter cosmetics on first read (adapted
`ensureStarterCosmetics`: `START_INVENTORY` renderKeys, `source: 'starter'`).

**New `shop` router**:
- `today` (query) — `buildProducts(coreCatalog)` + `todaysShop(products,
  localDate(tz))`, returns products with costs and the rotation. Client renders
  art from its own manifest by renderKey.
- `purchase` (mutation, `{ renderKey }`) — validate the key exists in the
  catalog, compute cost server-side, reject if owned, then in one tx:
  conditional coins decrement + `userCosmetics` insert
  (`source: 'purchase'`, `cost`). Returns `{ coins, itemKey }`.

**`cosmetics` router (slimmed)**: keep `inventory`, `equip`, `unequip`
(equip validates ownership, unequips the slot's previous item — the
`(userId, slot)` index already supports this). Delete `redeem`,
`rewardStatus`, `spin`. Add `setSkin` (mutation, two hex colors) — or hang it
off `users.updateProfile`; either is fine, pick one.

**New `streak` router**: `touch` (mutation) — compute today from
`users.timezone`; same-day no-op, yesterday +1, else reset to 1. Returns
`{ count, extended }`.

**New `dailyBox` router**:
- `status` (query) — claimable? tier from `streakCount` (base/silver/gold per
  token-economy), today's milestone if any.
- `claim` (mutation) — `rollDailyBox` from core seeded by `(date,
  'daily-box')`, grant through `grantReward` with dedupe `daily-box:<date>`
  (coins + milestone item in one tx, `users.coins` bumped). Idempotent:
  re-claim returns the existing grant. Returns box contents for the client to
  animate.

**New `sessions` router**:
- `progress` (mutation, `{ sessionId, beat, answers }`) — upsert
  `guided_sessions`; rejected if `done`.
- `ack` (mutation, `{ sessionId, ask, answer, probe }`) — the `fetchAck` LLM
  call, server-side, null on failure (client falls back to scripted lines,
  unchanged).
- `extract` (mutation, `{ sessionId, transcript }`) — the extraction pass:
  loads prior fields/notes/astral from DB for the `priorProfile` digest, runs
  the model, returns `{ fields, notes, recap, analysis }` (not yet persisted —
  the confirm/correction loop may re-run it).
- `complete` (mutation, `{ sessionId, extraction }`) — in one tx, guarded by
  `done = false`: mark done, upsert `session_fields`, insert `session_notes`,
  set `users.astral`, bump `users.bond` by the catalog's value for that
  session (server reads `SESSIONS` from core — client can't inflate), grant
  coins via ledger `session:<sessionId>`. Server re-applies the existing
  sanitizers (archetype length caps etc.) via zod.

**`goals` router**: add `logCheckIn` (mutation, `{ goalId, date, result }`,
`source: 'manual'`, upsert on `(goalId, date)`) for the sheet's toggle.

**New `dev` router** (dev-only, same double-gating as 19-auth's `devLogin`:
throws unless `NODE_ENV === 'development'`): `setCoins`, `setBond`,
`setStreak`, `resetSessions`, `resetDailyBox` — replaces the DevPanel's
direct store writes.

**Deletions**: spinner sweep route in `rewards/cron.ts` + its `vercel.json`
cron entry; `rollReward`/`REDEEM_COST`/`COSMETIC_CATALOG` usages in
`rewards/service.ts` (keep `grantReward`, `equipCosmetic`, `unequipCosmetic`,
adapted); the sparks paths in `routers/cosmetics.ts`.

Input schemas join the existing ones in `packages/shared/app/src/schemas.ts`.

## Client changes (`packages/expo`)

- **Delete** `store/economy.ts`, `store/bond.ts`, `store/dailyBox.ts`,
  `store/streak.ts`, `store/goals.ts`. Their consumers move to React Query
  hooks over `state.snapshot` + the new mutations (new `src/lib/state.ts`
  with the hooks, wrappers added to `lib/api.ts` per house style).
- **`store/context.ts`** shrinks to non-persisted UI state (`unseenIsland`
  flag); session progress/fields/notes/astral come from the snapshot.
  `SessionChat` swaps `llm()`/`runExtraction` for `sessions.ack` /
  `sessions.extract`, `saveSessionProgress` → `sessions.progress`,
  `completeSession` → `sessions.complete` (which returns the new
  coins/bond/astral for cache patching). The bundled OpenAI key and its env
  var are removed.
- **`ShopSheet`** renders from `shop.today` + snapshot coins/inventory; buy
  button calls `shop.purchase` optimistically (rollback on error). The seeded
  rotation math leaves the client.
- **`three/wardrobe.ts`** keeps its synchronous API for the renderer but
  becomes the boot mirror (decision 8): `loadWardrobe` reads the mirror,
  snapshot reconciliation overwrites it, `CosmeticsControls` mutations apply
  to the scene + fire `cosmetics.equip/unequip` + update the mirror.
  `store/skin.ts` same pattern via `setSkin`.
- **`StreakPill`/`StreakModal`** read snapshot streak; the once-per-day
  `touch()` on hydration becomes `streak.touch` on app foreground (the
  existing hydration hook point in `store/streak.ts` moves to an app-level
  effect next to the other launch calls).
- **`GoalsSheet`** re-wires to `goals.list` + `goals.logCheckIn` (decision 6).
- **`DevPanel`** calls the `dev` router instead of store setters.
- **`@sidekick/core`** is unchanged in role — the numbers still live there —
  but its consumers now include the server. Delete the now-dead
  `COINS_KEY`/`INV_KEY` constants (deprecated-web relics). Update
  `core/CLAUDE.md`'s consumers note.

## What deliberately stays on-device

- Credentials (`sidekick.deviceId`/`token`) — 19-auth's domain.
- Health/location consent flags + the location throttle stamp — device-scoped
  consent; the underlying data already syncs.
- Focus settings — must live in the iOS App Group for the Screen Time
  extension to read.
- 3D look-dev settings (everything in `sidekick3d-settings-v2` except skin)
  and `starFaceConfig` — dev tooling, not user progression.
- `unseenIsland` badge + `cosmeticVersion`/`speech` — presentation state.
- The wardrobe/skin boot mirror — a cache of server state, never authoritative.

## Sequencing

Each phase ships working; all phases get implemented.

1. **Economy core.** Schema migration (all of it, one shot), catalog emission
   into core, `state.snapshot`, `shop` router, slimmed `cosmetics`, starter
   seeding, sparks deletions. Client: shop/wardrobe/skin rewiring + boot
   mirror, delete `store/economy.ts`.
2. **Streak + daily box.** `streak.touch`, `dailyBox` router, milestone table
   wiring; StreakPill/Modal + box UI rewiring; delete `store/streak.ts`,
   `store/dailyBox.ts`. (The box-open 3D moment from token-economy is its own
   feature — this phase just makes claim/state server-side.)
3. **Guided sessions.** Tables, `sessions` router (incl. server-side LLM
   calls), bond, astral; SessionChat rewiring; delete the persisted parts of
   `store/context.ts` and `store/bond.ts`; remove the client OpenAI key.
4. **Goals.** `goals.logCheckIn`, GoalsSheet rewiring, delete
   `store/goals.ts`.
5. **Cleanup.** `dev` router + DevPanel rewiring, drop the dead cron entry,
   rotate the committed OpenAI key, sweep for stragglers
   (`grep -rn "AsyncStorage" src/store` should return nothing).

Auth interplay: this works on today's anonymous device auth; 19-auth's session
swap is orthogonal. Land 19-auth's merge semantics before inviting testers who
reinstall, since server-side progression is what makes account merge matter.

## Testing

- **Vitest + PGlite** (existing harness, no mocks — LLM calls go through the
  `createServices` seam with a capturing fake, same as 19-auth plans):
  purchase validation (unknown key, insufficient coins, double-buy, concurrent
  spend), grant idempotency (double claim, cron re-run), streak transitions
  (same-day/next-day/gap, timezone edges), session complete (guarded
  transition, bond/coins/astral in one tx, re-complete no-op), snapshot shape,
  goals manual check-in upsert.
- **Manual pass** (iOS sim + real backend, per repo practice): fresh install →
  starter state (150 coins, sky shirt equipped); buy → equip → force-quit →
  relaunch → state intact; claim box twice → one grant; run a full star
  session → coins/bond/astral update and survive reinstall; toggle a goal day.
