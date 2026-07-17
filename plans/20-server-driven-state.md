# 20 — Server-driven state: retire the on-device progression stores

## Goal

Move every piece of user progression that today lives only in AsyncStorage —
coins, owned cosmetics, worn outfit, shop purchases, streak, daily box, bond,
guided-session progress, extracted profile (fields/notes), the astral card,
and goal checks — to the server as the single source of truth. The client
becomes a React Query cache over tRPC, exactly like chat/documents/reminders
already are. Nothing is in prod, so **no back-compat and no data migration**:
stale AsyncStorage keys are simply abandoned.

Why now: auth just landed (19-auth) — the app is gated behind sign-in and
every user is a real account, but progression still lives on the device, which
is now an actual bug, not just a limitation: **sign out and into a different
account on the same device and you inherit the previous account's coins,
inventory, bond, and session history** (the zustand stores don't know users
exist). Accounts are also meaningless if progression evaporates on reinstall
or doesn't follow the account across devices; IAP/streak-freeze plans
(`docs/token-economy.md` §Integrity) hard-require server-validated grants; and
the current setup ships an OpenAI API key in the client bundle (see below).

## Current state — the full picture

There are **two parallel gamification systems** in the repo:

1. **The live one (client-only).** The UI (`ShopSheet`, `StreakPill`,
   `StreakModal`, `GoalsSheet`, `SessionChat`, `WorldMap`, `app/index.tsx`)
   runs entirely on zustand-persist stores in `packages/expo/src/store/` plus
   raw AsyncStorage in `src/three/`. Logic and numbers live in `@sidekick/core`
   (pure); the stores are thin persistence adapters. This implements the
   current design: coins (`docs/token-economy.md`), seeded shop rotation,
   daily box, app-open streak, bond, guided sessions.
2. **A mostly-dead server one (sparks era).** `packages/server` has a full
   cosmetics/rewards system from the older plans 04/07: `users.sparks`,
   `userCosmetics`, `rewards` (idempotent grant ledger), `cosmetics.{inventory,
   equip, unequip, redeem, rewardStatus, spin}`, a check-in spinner, and an
   hourly `/cron/rewards/grant` sweep. `api.ts` wraps all of it, but **no
   screen uses any of it** (only `focus.ts` reads `home.streak`). Its currency
   (sparks), reward vehicle (spinner-per-check-in), and catalog
   (`COSMETIC_CATALOG` in `@sidekick/shared`) all contradict the current
   token-economy design (coins, daily box, no chat/goal-attached rewards).
   One part is NOT dead: **deep-talks grants sparks** through `grantReward`
   (`deep-talks/score.ts:76`, `deep-talks/session.ts:51`) — those callers must
   be converted, not deleted.

This plan collapses the two: the **coins design wins** (it's the product), and
the **server's grant-ledger skeleton wins** (it's exactly the "grant log keyed
by date + faucet id" the token-economy spec demands). The sparks-specific parts
get deleted.

### Auth, as actually landed (deviates from `plans/19-auth.md`)

The implemented auth is **sign-in-required with no anonymous users** — a
simplification over the plan's anon-first model. What this migration builds on:

- `AuthGate` (`lib/auth.tsx`) blocks the whole app behind `SignInScreen`; the
  session token (`authSessions`, `sk_au_` opaque tokens) is the only
  credential. Every request that reaches a progression router has a real
  `ctx.userId`.
- Users are created in exactly two places: `findOrCreateUserForProvider`
  (`auth/provider-user.ts` — fresh user per new provider identity, **no
  merging**) and `devLogin` (`auth/dev-login.ts`, which currently seeds
  `sparks: 50` — a sparks-removal dependency).
- `registerDevice` is post-auth device-metadata upsert: a device that signs
  into a different account repoints its `devices.userId`.
- Both auth transitions (`useApplyAuthResult`, `useSignOut` in
  `auth-session.ts`) already call `queryClient.clear()` — React Query state
  can't bleed across accounts. AsyncStorage/zustand state has no such hook
  today; this plan adds one (decision 10).

Consequences for this plan: account switching on one device is a first-class
flow (not a future concern), there are no anon-merge semantics to design for,
and "starter seeding at registration" concretely means the two user-creation
sites above.

### Inventory of on-device state and its fate

| Key | File | Contents | Fate |
|---|---|---|---|
| `sidekick_economy_v1` | `store/economy.ts` | coins + owned renderKeys | **→ server** (`users.coins`, `userCosmetics`) |
| `sidekick_bond_v1` | `store/bond.ts` | bond 10–100 | **→ server** (`users.bond`) |
| `sidekick_context_v1` | `store/context.ts` | session progress, fields, notes, astral, unseenIsland | **→ server** (3 new tables + `users.astral`); `unseenIsland` stays client |
| `sidekick_daily_box_v1` | `store/dailyBox.ts` | last-claimed date | **→ server** (`ledger` row per day) |
| `sidekick_goals_v1` | `store/goals.ts` | chosen goals + weekly booleans | **→ server** (existing `goals`/`checkIns` system) |
| `sidekick_streak_v1` | `store/streak.ts` | count + last day | **→ server** (`users.streakCount/streakLastDay`) |
| `sidekick-wardrobe-v1` | `three/wardrobe.ts` | worn item per slot | **→ server** (`userCosmetics.equipped`) + local boot cache |
| `sidekick3d-settings-v2` | `three/settings.ts` | skin color + ~60 look-dev knobs | **skin → server** (`users.skin`); look-dev stays local |
| `sidekick_star_face_tuning` | `store/starFaceConfig.ts` | dev-only sliders | stays local (slated for deletion anyway) |
| `sidekick.deviceId` / `sidekick.token` | `lib/auth-store.ts` | install id + session token | stays (auth owns this) |
| `health-agent-sharing-enabled`, `sidekick.locationEnabled`, `sidekick.lastLocatedMs` | `lib/health.ts`, `lib/location.ts` | device-scoped consent flags + throttle | stays local (consent is per-device; the data already syncs) |
| `sidekickFocusSettings` | `lib/focus.ts` | Screen Time config | stays local (must live in the iOS App Group for the extension) |

### Two adjacent problems this migration fixes in passing

- **Client-side OpenAI key.** `SessionChat.tsx` (`llm()`, line ~125) calls
  `api.openai.com` directly with a key bundled into the app. Moving the
  session engine's LLM calls server-side removes the key from the client.
  **Rotate the committed key immediately** (it's in the root `.env`) — that's
  a today action, not a phase.
- **`START_COINS` 250 → 150.** Token-economy calls for this; since the server
  now seeds balances, it lands as the opening ledger grant in the same change.
- **Session reward drift.** Core's `SESSIONS` pays 15 coins / 6–7% bond per
  session; `docs/token-economy.md` specifies 25 (shallow) – 40 (deep). Update
  the catalog values when sessions move server-side (phase 3). The spec's
  13-session syllabus vs core's current 6 is content work, out of scope here.

## Key decisions

1. **Coins are the only currency; the sparks system is deleted.** Drop
   `users.sparks`, `cosmetics.redeem/rewardStatus/spin`, `rollReward`,
   `REDEEM_COST`, the spinner sweep in `rewards/cron.ts` (+ its vercel.json
   cron), and `COSMETIC_CATALOG`. Removal dependency map: the deep-talks
   `grantReward` callers switch to coin amounts through the ledger (they keep
   their `event:*` dedupe keys); `devLogin`'s `sparks: 50` seed becomes the
   standard starter grant; `api.ts` wrappers for redeem/spin/rewardStatus go;
   existing rewards tests get rewritten against the ledger. The `rewards`
   table's skeleton survives as the **`ledger`** — see next decision.
2. **One signed ledger for every coin and item movement.** Rename `rewards` →
   `ledger`: `(userId, source, dedupeKey unique per user, kind
   'coins' | 'item', coins signed integer, itemKey, meta jsonb, revealedAt)`.
   Faucets insert positive rows (`daily-box:<date>`, `session:<sessionId>`,
   `milestone:<day>`), spends insert negative rows (`purchase:<renderKey>`),
   always in the same transaction as the `users.coins` update. Even the
   opening balance is a ledger row (`starter:coins`, +150, written at
   registration), so the invariant is simply **`users.coins =
   sum(ledger.coins)`** — testable, auditable, no special cases. `meta` stores
   the full awarded payload where a reward has structure (box contents), so an
   idempotent replay returns exactly what was granted rather than recomputing
   against drifted state. The dedupe key makes every movement idempotent —
   cron re-runs and client retries are no-ops. This one table is deliberately
   the choke point every future money-adjacent feature flows through: island
   chests (`chest:<islandId>`), quest payouts (`quest:<week>`), streak-freeze
   consumption (`freeze:<date>`), IAP grants (`iap:<storeTransactionId>` —
   StoreKit receipt validation lands as just another ledger writer),
   refunds/support adjustments, and the analytics the token-economy spec says
   to watch (median coins held, time-to-first-purchase fall out of ledger
   queries for free).
3. **`renderKey` is the canonical item identity** (`${slot}-${variantId}` /
   `${slot}-c<hex>`), stored in `userCosmetics.itemKey`. The shop catalog is
   already pure data in `@sidekick/core` (`PRICE`, `buildProducts`,
   `todaysShop`); what the server lacks is the variant manifest. The catalog
   module (slot → variant ids + names + body region; no texture refs) becomes
   a **checked-in file in `@sidekick/core`** that
   `packages/expo/scripts/sync-cosmetics.mjs` regenerates alongside expo's
   texture manifest — core's copy is canonical, the script keeps it honest.
   (Don't make the server depend on the script running: the script needs the
   deprecated web package's assets + macOS `sips`; the emitted file is plain
   data and lives in git.) Server and client build the exact same product list
   from the same code; prices are validated server-side. Product entries carry
   a `kind` field — `'cosmetic'` today, with `'consumable'` reserved — so the
   streak freeze, gifts/snacks, and dyes from the token-economy sink list slot
   into the same catalog, shop, and purchase path later (consumables will own
   a `user_consumables (userId, itemKey, quantity)` table when the first one
   ships; the purchase mutation branches on `kind`, nothing else changes).
   `packages/server/package.json` gains the `@sidekick/core` dependency.
4. **Balances are columns, mutations are transactions.** `users.coins` and
   `users.bond` are plain integers updated in the same transaction as their
   cause (a ledger row, a session completion). Spends guard with a conditional
   `UPDATE … WHERE coins >= cost RETURNING` — no oversell under concurrency.
   `userCosmetics` gains a `source` column (`'starter' | 'purchase' |
   'reward'`) for how an item was acquired; the price paid lives on the
   ledger row.
5. **Economy numbers travel in server payloads, never as client constants.**
   The client renders prices, box contents, and streak tiers from
   `shop.today` / `dailyBox.status` / snapshot responses — it never reads
   `PRICE` or the box bands out of `@sidekick/core` directly (core remains the
   server's source for them). The streak slice carries the **full milestone
   ladder** (StreakModal renders the whole schedule, not just today).
   Explicitly presentation-and-stable, allowed client-side: rarity
   labels/colors derived from a returned cost, slot display names, region→tab
   grouping. Consequence: every tuning lever the token-economy spec lists
   (faucet amounts, milestone table, prices, `START_COINS`) is a server
   deploy, not an app-store release — and a future remote-config/experiment
   table can be dropped behind the same payloads without any client change.
6. **All "local day" logic moves to the server clock + `users.timezone`**,
   via the existing `localDate(userTimezone)` helper the check-ins system
   already uses. The client never decides what day it is. Seeded rolls
   (`rollDailyBox`, `todaysShop`) run server-side with the same core
   functions — server imports `@sidekick/core` (it's pure; this is a new but
   legal dependency direction). Timezone is client-influenced (profile +
   location writes), so date-keyed faucets get two cheap defenses: IANA
   timezone validation everywhere `timezone` is written, and a minimum-elapsed
   guard on the box (a claim also records its UTC instant in `meta`; the next
   claim requires ≥ 20h elapsed, so timezone hopping can't mint extra boxes).
7. **Streak keeps app-open semantics** (faithful port of `computeStreak`):
   `streak.touch` mutation, idempotent per local day, columns on `users`,
   fired from the existing `useForegroundSync` hook (which already owns
   background→active detection) — not a new listener. The server-side
   *check-in* streak (`goals` router / `home.streak`) is a different per-goal
   concept and stays as is; the focus-shield copy in `focus.ts` switches to
   the app-open streak so the product shows one streak number everywhere. The
   streak-freeze sink lands later as a consumable checked inside `touch` —
   now possible because touch is server-side.
8. **Goals: adopt the existing server system, don't port the checkbox store.**
   This is the one real product fork. The server already has the richer
   goals/check-ins system (adopt/list/detail/adjust/pause/complete, `checkIns`,
   per-goal streaks, chat `log_checkin` integration per `plans/user-memory.md`)
   — it's built and tested, just not wired to the UI. Porting the local weekly
   checkbox model to the server would create a *third* system. Instead:
   `GoalsSheet` re-wires onto `goals.list` + a new `goals.logCheckIn` mutation
   (manual source, upsert on `(goalId, date)`, sharing one upsert service with
   the chat `log_checkin` path), and the weekly strip renders from check-in
   rows. `store/goals.ts` is deleted.
9. **Guided sessions move server-side whole**: progress, extraction output,
   astral, bond, and coin grants. The session *engine* stays
   client-orchestrated (scripted beats, UI phases — a faithful port, not a
   rewrite), but every answer is already posted to `sessions.progress`, so the
   server holds the authoritative transcript: `extract` and `complete` operate
   on **server-stored answers + the scripted asks from core's catalog**, and
   the client passes only recap corrections. The client never supplies
   reward-bearing state — coins/bond come from core's catalog keyed by
   `sessionId`, extraction runs server-side (killing the bundled OpenAI key).
   Extracted fields/notes keep their current shapes in dedicated tables.
   Unifying them with the `memories` system is deliberately out of scope
   (they're differently shaped and prompt-coupled) — noted as a follow-up,
   same for merging `users.bond` with the deep-talks `users.contextScore`
   (two implementations of "how much the sidekick knows"; flagged, not
   unified here).
10. **The 3D scene gets a boot cache, not a persisted store.** The renderer
   hydrates wardrobe/skin before any network. Keep AsyncStorage mirrors of
   server state under **new key names** (so pre-migration authoritative data
   is never read as cache), with the owning `userId` + a schema version inside
   the payload as a boot-time guard. The mirrors are **deleted in
   `useApplyAuthResult` and `useSignOut`** — the exact hooks that already
   `queryClient.clear()` — so account B never boots wearing account A's
   outfit. Hydrate the scene from the mirror instantly, reconcile when the
   snapshot query lands, update the mirror on every equip/skin mutation. A
   failed equip mutation rolls the scene and mirror back to the server's
   returned state — nothing stays locally equipped that the server rejected.
   Server is truth; the mirror is disposable.
11. **One cold-start snapshot query, versioned.** New `state.snapshot`
   procedure returning `{ stateVersion, coins, bond, streak: { count,
   milestoneLadder }, dailyBox: { claimable, tier }, inventory, equipped,
   skin, astral, sessions }` — where `sessions` is per-session `{ beat, done }`
   only. **Not in the snapshot**: raw session answers and extracted
   fields/notes (sensitive, not needed at launch — the star chat fetches them
   via a `sessions.profile` query when opened), and goals (GoalsSheet already
   has `goals.list`). `users.stateVersion` is a monotonic counter bumped by
   every progression write — the same primitive `memoryVersion` already is
   for memory (`plans/user-memory.md` §4). Every mutation (including
   `streak.touch`) returns the new version plus the fields it changed; React
   Query patches the `['snapshot']` cache with a **compare-before-patch rule:
   a response carrying an older `stateVersion` than the cache never
   overwrites it** (kills delayed-response clobbering). Optimistic updates for
   purchase/equip/goal-toggle, where the UX needs instant feedback. Cross-
   device (Expo Web + iOS on one account — live today, since auth landed) is
   honest-but-simple in v1: no push — the snapshot refetches on app foreground, and any response
   carrying a newer version triggers a refetch; per-domain invalidation fanout
   never needs to exist. The snapshot is a bag of named slices; future domains
   add a slice rather than new cold-start round trips.

## DB schema changes (`packages/db/src/schema.ts`)

All of this ships as **one migration in phase 1** — later phases build on
tables that already exist rather than each cutting their own migration.

`users`:
- add `coins integer not null default 0` (opening balance arrives as the
  `starter:coins` ledger grant at registration)
- add `bond integer not null default 10`
- add `streakCount integer not null default 0`, `streakLastDay date`
- add `astral jsonb` (`{ archetype, reading, traits } | null`)
- add `skin jsonb` (`{ body, shadow } | null` — the two cel colors)
- add `stateVersion bigint not null default 1` (bumped on every progression
  write, same pattern as `memoryVersion`)
- drop `sparks`

`userCosmetics`:
- add `source text not null default 'reward'`
- (itemKeys are now renderKeys; existing unique `(userId, itemKey)` already
  gives purchase/grant idempotency)

`rewards` → rename to `ledger`:
- rename `sparks` → `coins`, now **signed** (grants positive, spends negative)
- `kind` values become `'coins' | 'item'`
- add `meta jsonb` (awarded payload for structured rewards, e.g. box contents
  + claim instant)
- everything else (`source`, `dedupeKey` unique per user, `revealedAt`)
  carries over unchanged

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

**Starter seeding moves to user creation**, not a read path — concretely, the
create branch of `findOrCreateUserForProvider` (`auth/provider-user.ts`) and
`devLogin`'s first-creation seed (whose `sparks: 50` this replaces): one
transaction grants the `starter:coins` ledger row (+150) and inserts
`START_INVENTORY` renderKeys into `userCosmetics` **equipped**
(`source: 'starter'`). (Today's `ensureStarterCosmetics` inserts unequipped
and runs on a query — both wrong for us: a fresh account must boot wearing
the sky shirt, and a protected *query* that writes is surprising.)

**New `state` router** — `snapshot` (protected query) assembling the payload in
decision 11.

**New `shop` router**:
- `today` (query) — `buildProducts(coreCatalog)` + `todaysShop(products,
  localDate(tz))`, returns products with costs and the rotation. Client renders
  art from its own manifest by renderKey and derives rarity styling from the
  returned cost.
- `purchase` (mutation, `{ renderKey }`) — validate the key exists in the
  catalog, compute cost server-side (never trust a client price), reject if
  owned, then in one tx: conditional coins decrement + negative `ledger` row
  (`purchase:<renderKey>`) + `userCosmetics` insert (`source: 'purchase'`).
  Returns `{ stateVersion, coins, itemKey }`.

**`cosmetics` router (slimmed)**: keep `inventory`, `equip`, `unequip`. Equip
validates ownership and unequips **region siblings, not just the same slot** —
the body-region exclusivity in `three/wardrobe.ts` (`REGIONS`,
`regionSiblings`: a crown replaces a beanie, a hoodie takes the shirt off)
moves into the core catalog so the server enforces the same rule
transactionally. Delete `redeem`, `rewardStatus`, `spin`. Add `setSkin`
(mutation, two hex colors).

**New `streak` router**: `touch` (mutation) — compute today from
`users.timezone`; same-day no-op, yesterday +1, else reset to 1. Returns
`{ stateVersion, count, extended }`.

**New `dailyBox` router**:
- `status` (query) — claimable? tier + today's milestone if any.
- `claim` (mutation) — **touches the streak first in the same transaction**
  (the current UI touches then previews; tier must come from the just-touched
  count, not the cold snapshot), then `rollDailyBox` from core seeded by
  `(date, 'daily-box')`, grant through the ledger with dedupe
  `daily-box:<date>`, full contents + UTC claim instant persisted in `meta`.
  Milestone item already owned → **converts to coins** (dupe protection per
  token-economy). Guards: ≥ 20h since the previous claim's instant (timezone-
  hop defense). Idempotent: re-claim returns the persisted `meta` payload
  verbatim. Returns box contents for the client to animate.

**New `sessions` router**:
- `progress` (mutation, `{ sessionId, beat, answers }`) — upsert
  `guided_sessions`; rejected if `done`. This is the authoritative transcript.
- `ack` (mutation, `{ sessionId, answer, probe }`) — the `fetchAck` LLM call,
  server-side (the ask comes from core's beat script + stored beat, not the
  client); null on failure (client falls back to scripted lines, unchanged).
- `extract` (mutation, `{ sessionId, corrections? }`) — the extraction pass
  over **server-stored answers** + prior fields/notes/astral from DB for the
  `priorProfile` digest; returns `{ fields, notes, recap, analysis }` (not yet
  persisted — the confirm/correction loop may re-run it with `corrections`).
- `complete` (mutation, `{ sessionId, extraction }`) — in one tx, guarded by
  `done = false`: mark done, upsert `session_fields`, insert `session_notes`,
  set `users.astral`, bump `users.bond` and grant coins **from core's catalog
  values for that `sessionId`** (client can't inflate), ledger dedupe
  `session:<sessionId>`. Server re-applies the existing sanitizers (archetype
  length caps etc.) via zod on the extraction payload it persists.
- `profile` (query) — fields/notes/astral for the star chat (kept out of the
  snapshot).

**`goals` router**: add `logCheckIn` (mutation, `{ goalId, date, result }`,
`source: 'manual'`, upsert on `(goalId, date)`, same service function as the
chat path) for the sheet's toggle.

**New `dev` router** (dev-only, same double-gating as the existing `devLogin`:
throws unless `NODE_ENV === 'development'`), replacing the DevPanel's direct
store writes — every lever preserves the ledger invariant:
- `adjustCoins` — writes a `dev-adjust:<uuid>` ledger row (never sets the
  column directly).
- `setBond`, `setStreak` — column writes (no ledger involvement).
- `resetSessions` — deletes `guided_sessions` rows **and** their
  `session:<id>` ledger rows + reverses the coins/bond they granted, so a
  re-run session pays again without double-counting. Keeps the current
  DevPanel distinction: `resetSessions` (progress only) vs `resetProfile`
  (also clears `session_fields`/`session_notes`/astral).
- `resetDailyBox` — deletes today's `daily-box:<date>` ledger row and reverses
  its coins/items.

**Deletions**: spinner sweep route in `rewards/cron.ts` + its `vercel.json`
cron entry; `rollReward`/`REDEEM_COST`/`COSMETIC_CATALOG` usages in
`rewards/service.ts` (keep `grantReward` — adapted to write signed `ledger`
rows and bump `users.coins`/`stateVersion` — plus `equipCosmetic`,
`unequipCosmetic`); the sparks paths in `routers/cosmetics.ts`; the deep-talks
callers re-denominate in coins (decision 1).

Input schemas join the existing ones in `packages/shared/app/src/schemas.ts`.

## Client changes (`packages/expo`)

- **Delete** `store/economy.ts`, `store/bond.ts`, `store/dailyBox.ts`,
  `store/streak.ts`, `store/goals.ts`. Their consumers move to React Query
  hooks over `state.snapshot` + the new mutations (new `src/lib/state.ts`
  with the hooks, wrappers added to `lib/api.ts` per house style).
- **`store/context.ts`** shrinks to non-persisted UI state (`unseenIsland`
  flag); session progress comes from the snapshot, fields/notes/astral from
  `sessions.profile` when the star chat opens. `SessionChat` swaps
  `llm()`/`runExtraction` for `sessions.ack` / `sessions.extract` (passing
  only corrections), `saveSessionProgress` → `sessions.progress`,
  `completeSession` → `sessions.complete` (which returns the new
  coins/bond/astral for cache patching). The bundled OpenAI key and its env
  var are removed.
- **`ShopSheet`** renders from `shop.today` + snapshot coins/inventory; buy
  button calls `shop.purchase` optimistically (rollback on error). The seeded
  rotation math leaves the client; rarity styling derives from returned costs.
- **`three/wardrobe.ts`** keeps its current async-load/sync-read API for the
  renderer but becomes the user-scoped boot mirror (decision 10):
  `loadWardrobe` reads the mirror, snapshot reconciliation overwrites it,
  `CosmeticsControls` mutations apply to the scene + fire
  `cosmetics.equip/unequip` + update the mirror, and roll back scene + mirror
  on mutation failure. `store/skin.ts` same pattern via `setSkin`.
- **`StreakPill`/`StreakModal`** read the snapshot streak slice (count +
  milestone ladder); the once-per-day touch moves into `useForegroundSync`
  next to the other foreground work.
- **`GoalsSheet`** re-wires to `goals.list` + `goals.logCheckIn` (decision 8).
- **`DevPanel`** calls the `dev` router instead of store setters.
- **`@sidekick/core`** is unchanged in role — the numbers still live there —
  but its consumers now include the server. Delete the now-dead
  `COINS_KEY`/`INV_KEY` constants (deprecated-web relics). Update
  `packages/shared/core/CLAUDE.md`'s consumers note.

## Offline & failure behavior (explicit, because it changes)

Today the progression stores work with zero network; afterwards they won't.
The product already requires connectivity for its core loop (chat), and the
user-memory plan set the precedent of **no offline mutation queue in v1** —
this plan keeps that. The failure experience, flow by flow:

- **Cold launch offline**: the 3D scene boots fully from the wardrobe/skin
  mirror; progression UI (coins, streak, shop) shows skeletons per the
  existing `Skeleton` pattern and fills in when the snapshot lands. No cached
  snapshot is persisted across process death — that's accepted, same as chat.
- **Purchase / equip / goal-toggle**: optimistic, with rollback + toast on
  error (equip rollback also restores the 3D scene, decision 10).
- **Daily box claim**: the open animation plays only on a successful response
  (the mutation returns the contents; nothing animates speculatively). A
  failed claim leaves the box closed and tappable.
- **Guided sessions**: already require connectivity in practice (every ack and
  the extraction are LLM calls — today they just fail silently to scripted
  lines). A failed `sessions.progress` write retries on the next answer
  (upsert semantics make replays safe); a session can't complete offline.
- **Reconnect**: React Query refetch + idempotent mutations mean retries are
  safe by construction (dedupe keys, upserts).

## What deliberately stays on-device

- Credentials (`sidekick.deviceId`/`token`) — auth's domain.
- Health/location consent flags + the location throttle stamp — device-scoped
  consent; the underlying data already syncs.
- Focus settings — must live in the iOS App Group for the Screen Time
  extension to read.
- 3D look-dev settings (everything in `sidekick3d-settings-v2` except skin)
  and `starFaceConfig` — dev tooling, not user progression.
- `unseenIsland` badge + `cosmeticVersion`/`speech` — presentation state.
- The wardrobe/skin boot mirror — a user-scoped cache of server state, never
  authoritative.

## Forward compatibility — how future features land on these primitives

The migration's real deliverable is four primitives, not seven moved stores:
the **signed ledger** (all value movement, idempotent), the **snapshot +
`stateVersion`** (all client sync), the **core catalog** (all item identity +
pricing, server-validated), and **server-owned local-day** (all daily
mechanics). Everything on the roadmap decomposes onto them:

| Upcoming feature (source) | What it needs | Already covered by |
|---|---|---|
| Streak freeze (token-economy sink #2) | consumable item + auto-consume in `streak.touch` | catalog `kind: 'consumable'`, `user_consumables`, ledger `freeze:<date>` |
| Deal slot / sales (sink #3) | seeded discount server-side | `shop.today` computes + prices it; `purchase` already prices server-side |
| Seasonal / limited drops | catalog availability windows | filter inside `shop.today`; catalog is data, no client change |
| Island arrival chests + exclusives (faucets) | one-time grants + unpurchasable items | ledger `chest:<islandId>`; exclusives = catalog entries absent from shop rotation |
| Session/milestone box upgrades | the box as the single reward vehicle | `dailyBox.claim` shape reused; grants are ledger rows with `meta` |
| Weekly quests (v2) | derived from check-ins + a payout | reads `checkIns`, pays via ledger `quest:<isoWeek>` |
| IAP (streak repair, premium cosmetics) | server receipt validation → grant | a StoreKit webhook/endpoint writing ledger `iap:<txId>`; nothing else new |
| Room/environment decor, world-map travel state | new progression domain | the "new domain recipe" below + a snapshot slice |
| Proactive pushes about progression ("your box is waiting", streak-at-risk) | server visibility into streak/box | state is now in Postgres next to the existing `notificationOutbox` + cron infra — a policy function away |
| Tuning & experiments (token-economy levers) | change numbers without app release | numbers-in-payloads rule (decision 5); a config/experiment table can later feed the same payloads |
| Multi-device (Expo Web + iOS, live today) | cheap cross-device consistency | `stateVersion` + foreground refetch; no offline mutation queue by design |
| Account linking / merging (if it ever lands) | a merge policy for progression | everything is server rows keyed by `userId` — 19-auth's "adopt the target account's data" policy becomes a device repoint, no local state to reconcile |

**The recipe for any new server-driven domain** (this is the groove every
phase below also follows — deviating from it is the code smell to catch in
review):

1. Table(s) in `packages/db/src/schema.ts`; pure rules/numbers in
   `@sidekick/core`.
2. A tRPC router: queries + idempotent mutations (dedupe key or upsert), all
   writes transactional with `users.stateVersion` bump; coin/item movement
   goes through the ledger, days through `localDate(users.timezone)`.
3. A slice in `state.snapshot` (or a standalone query if it's heavy/sensitive);
   mutations return `{ stateVersion, …changed }`.
4. Client: React Query hook + `api.ts` wrapper; zustand only for ephemeral UI
   state; numbers rendered from payloads.
5. A `dev` router lever if the DevPanel needs one (invariant-preserving); a
   PGlite suite for the mutation semantics.

## Sequencing

**Phase 0 (today, before any of this):** rotate the OpenAI key committed in
the root `.env` and remove it from the repo.

Each phase ships working; all phases get implemented. A client surface stays
on its old store until its complete server path — including failure states —
is ready.

1. **Economy core.** The full schema migration (everything above, one shot),
   catalog emission into core, `state.snapshot`, `shop` router, slimmed
   `cosmetics` with region-exclusive equip, starter seeding at registration,
   sparks deletions + deep-talks re-denomination. Client: shop/wardrobe/skin
   rewiring + user-scoped boot mirror, delete `store/economy.ts`.
2. **Streak + daily box.** `streak.touch` (via `useForegroundSync`),
   `dailyBox` router with touch-before-roll ordering and `meta` persistence,
   milestone ladder in payloads; StreakPill/Modal + box UI rewiring; `focus.ts`
   shield switches to the app-open streak; delete `store/streak.ts`,
   `store/dailyBox.ts`. (The box-open 3D moment from token-economy is its own
   feature — this phase just makes claim/state server-side.)
3. **Guided sessions.** `sessions` router (server-stored transcript,
   server-side LLM calls), bond, astral, catalog coin values updated to spec;
   SessionChat rewiring; delete the persisted parts of `store/context.ts` and
   `store/bond.ts`; **remove the client OpenAI key in the same deploy that
   replaces its callers**.
4. **Goals.** `goals.logCheckIn`, GoalsSheet rewiring, delete
   `store/goals.ts`.
5. **Cleanup.** `dev` router + DevPanel rewiring, drop the dead cron entry,
   and the acceptance sweep: `grep -rn "AsyncStorage\|getStoredItem"
   packages/expo/src` returns only the allowlist — the boot mirrors, the
   consent flags, `starFaceConfig`, and look-dev settings.

Auth interplay: auth is landed and every request carries a real `ctx.userId`,
so nothing here waits on auth work. The two integration points are owned by
this plan: starter seeding inside the user-creation transaction, and boot-
mirror deletion inside `useApplyAuthResult`/`useSignOut`. Until phase 1 lands,
account switching visibly bleeds local progression between accounts — worth
telling testers, and a reason to not let this plan sit.

## Testing

- **Vitest + PGlite** (existing harness, no mocks — LLM calls go through the
  `createServices` seam with a capturing fake, matching the auth suites):
  - purchase: unknown key, insufficient coins, double-buy, concurrent spend,
    same-item race (unique index holds), optimistic-rollback contract (error
    surfaces).
  - ledger invariant: `users.coins = sum(ledger.coins)` after any mutation
    mix, including dev adjustments and resets.
  - daily box: double claim returns identical `meta`, cron re-run no-op,
    milestone dupe converts to coins, tier reflects same-tx streak touch,
    20h-guard blocks a timezone-hop claim.
  - streak: same-day/next-day/gap transitions, timezone edges, IANA
    validation rejects garbage.
  - sessions: complete is a guarded transition (re-complete no-op), rewards
    come from the catalog not the payload (forgery attempt pays catalog
    values), progress-after-done rejected, cross-user access rejected.
  - equip: region exclusivity (crown unequips beanie), unowned item rejected.
  - snapshot: shape, `stateVersion` monotonicity, stale-version response never
    patches the cache (client-side unit).
  - goals: manual check-in upsert, shared service with chat path.
  - starter seed: registration leaves 150 coins (via ledger), sky shirt owned
    **and equipped**.
- **Manual pass** (iOS sim + real backend, per repo practice): fresh install →
  starter state (150 coins, sky shirt equipped); buy → equip → force-quit →
  relaunch → state intact; airplane-mode launch → scene renders from mirror,
  skeletons elsewhere; claim box twice → one grant; run a full star session →
  coins/bond/astral update and survive reinstall; sign out and into a second
  account (dev login + one provider) → fresh starter state, no outfit or coin
  bleed, then back to the first account → its state intact; toggle a goal day.
