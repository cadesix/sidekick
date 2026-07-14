# Token Economy Spec

Goal: a progression curve tuned for retention and habit formation. Very rewarding
in the first week (visible transformation, near-daily purchases), then a gradually
stretching challenge curve where desirable items become multi-day savings goals —
without ever making the core loop (chat) feel like grinding.

Coins are the engagement scaffold, not the product. Every faucet is an anchor that
pulls the user back into chat; nothing pays per-message or per-minute.

## Where we are today

The spend side is built; the earn side is entirely stubbed:

- `sidekick-economy.ts` — coins + inventory in localStorage. `spendCoins()` is wired
  to the shop; `addCoins()` has **zero callers**.
- `shop-sheet.tsx` — full catalog with prices (commons 25–50, rares 60–90,
  epics 100–150, legendaries 200–250), daily seeded rotation, rarity tiers.
- `streak-sheet.tsx` — milestone reward table exists but is **display-only**
  ("Claim/grant plumbing comes later").
- `goals-sheet.tsx` — daily binary checks, **no rewards**.
- `sidekick-bond.ts` — `addBond()` has zero callers outside the dev lever.
- `api/chat.js` / `chat.tsx` — no reward hooks.

So this spec defines faucets against already-fixed prices, which is the right order.

## Design principles

1. **Coins reward showing up — never chatting.** Coins attach to the ritual
   around the relationship (daily check-in, streaks, later guided sessions),
   never to the relationship itself. No chat-attached rewards of any kind:
   paying users to talk to their sidekick invites spam and turns the emotional
   core of the app into a job. All faucets are once-per-local-day, matching the
   existing streak/shop-rotation day logic.
2. **Two tracks, never convertible — and only one is forever.** Coins buy
   cosmetics and run for the life of the user. Bond is **progressive
   onboarding** (see [guided-sessions.md](guided-sessions.md)): the score of how
   much the sidekick knows, earned by completing the session syllabus, finite by
   design — a fully activated user tops it out in a few weeks and never thinks
   about bond again. Never purchasable with coins or money: bond measures real
   context, and that context is the foundation of everything downstream
   (personalized memory, ad relevance). Paying for it would defeat its purpose.
3. **The curve stretches via prices, not earn decay.** Daily earn stays roughly flat
   (slightly growing with streak); the rarity ladder does the stretching. Early
   items are same-day gratification; legendaries are week-long goals.
4. **Deterministic + idempotent**, like everything else in the app: all grants keyed
   by local `YYYY-MM-DD`, replays are no-ops, works offline.

## Currency model

Single earned currency: **coins**. No gems, no coin sales (see IAP section).

**Change `START_COINS` 250 → 150.** At 250 a new user can buy the 250-coin crown —
the top aspirational item — on day 0, which torches the entire ladder. 150 still
buys 2–3 commons in the first session (the "dress your sidekick" tutorial dopamine)
but keeps rares as day-2 goals and legendaries aspirational.

## Faucets

Two layers with different lifetimes:

**Steady-state faucets (launch, run forever).** Both login-shaped, both
idempotent per local day. Daily earn: **20–30/day**, fully deterministic —
which is a feature: every price maps to an exact number of days, so items
become clear savings goals ("come back 3 more days and the boots are yours").

| Faucet | Amount | Trigger | Wire point |
|---|---|---|---|
| Daily check-in | 20 base; 25 at streak ≥7; 30 at ≥30 | Tap-to-claim on the streak sheet (claim, not auto-grant — the tap is the ritual) | `touchStreak()` result + new claim state in `sidekick-streak.ts` |
| Streak milestones | Existing table (D1 10c … D365 crown-gold) | Auto-claim alongside daily check-in | `streak-sheet.tsx` table → `addCoins`/`addToInventory` |

The milestone table's item drops (D3 beanie, D6 glasses, D7 sneakers, D14 backpack)
are already well-placed: a free, visible outfit transformation across week 1.
Keep them exactly as designed — they're the "exciting beginning."

**Onboarding-arc faucets (ship with guided sessions; a finite, one-time pool).**
Context about the user is the foundation of the whole product, so sessions get
the heaviest incentives in the economy — but as a bounded pool that front-loads
the first weeks without inflating steady state:

| Faucet | Amount | Trigger | Wire point |
|---|---|---|---|
| Session completed | 25 (shallow) → 40 (deep), mirroring the bond 4–8% depth scale | The recap screen's "did i get that right? → yep" beat — reward lands at the moment of confirmed knowledge | session engine → `grantCoins("s8", ...)` |
| Island arrival chest | 1 exclusive island-themed cosmetic + 25–50 coins | First travel to a newly unlocked island — a visible chest at the arrival point | first-visit flag in `world-map.tsx` `onTravel` |
| Life-update re-take | 10 | Re-completing a stale session (30-day freshness) | session engine, per-session cooldown |

Full pool ≈ 13 sessions (~420 coins) + 6 chests (~200 coins + 6 exclusives) ≈
**600 one-time coins plus 6 items that can't be bought**. The exclusives do the
heavy lifting: they make unlocking islands *materially* rewarding (not just new
scenery), they preview that the world contains things the shop doesn't sell,
and they don't dilute coin scarcity. Session rewards are per-session, not
per-day — the ~2/day cadence cap in the sessions spec is what paces them.

**Loot boxes** (the chest is already a fixed-content one): a variable-content
version is a v2 option for session/island rewards if the fixed pool tests flat.
If ever added, earned-only and cosmetic-only — never purchasable with money
(gambling adjacency, app-store policy risk, and it would poison the trust the
sessions depend on).

Deliberately **not** faucets, ever or for now:

- **Chatting — never.** See principle 1. No first-chat bonus, no per-message
  anything.
- **Goal completion coins — hold.** Self-reported binary checks are trivially
  gameable and goals may not need extrinsic juice. Revisit only if goal
  engagement lags check-in rate. Same for a weekly quest (5-of-7 goal days →
  50 coins; `sidekick_habit_checks_v1` already supports computing it).

## The curve

Two regimes: a deliberately rich **onboarding arc** (while the session syllabus
runs) that tapers into a calm, predictable **steady state**.

| Phase | Earn state | Feel |
|---|---|---|
| Day 0 | 150 start + first check-in + first session (S1 is available immediately) | 2–3 commons in the first minutes, and the session→reward loop demonstrated on day one |
| Onboarding arc (~weeks 1–3) | 50–90 on session days: check-in + 1–2 sessions + chest coins + week-1 milestones | Something new almost every day — a purchase, an exclusive, a new island. This is the front-loaded excitement window, and it's also when the product is extracting its foundation (context) |
| Graduation (syllabus done) | Drops to 25/day | The pivot from "earning fast" to "saving deliberately": rares every ~3 days, epics a ~5-day save, crown (250) a ~8-day save |
| Steady state | 25–30/day + big streak milestones (D30 wizard, D45 100c, D90 200c) | Calm and deterministic; all variance/excitement comes from the shop side — daily rotation, deal slot, mystery milestone cards, eventual seasonals |

**Keeping the carrot hung:** front-loading must never mean satiation. The rule:
at every point in the curve the user can see **at least two desirable items
they can't yet afford**. The featured shop slots (already filtered to cost
≥ 60) enforce this automatically in week 1 when balances are small; the
legendary tier (200–250) does it for the arc; limited/seasonal items do it in
steady state. If the balance metric shows users sitting above the price of
everything they're shown, the front-load is too rich — cut chest coins first,
session coins second, never the check-in.

**The graduation cliff is a real churn risk** — earn rate drops ~60% exactly
when the map stops producing novelty. It's cushioned by design: the D30 wizard
milestone, the streak bonus tier, and (eventually) seasonal shop drops should
all land in the post-graduation window. Watch D21–D35 retention specifically.

**Catalog runway check:** steady state ~800/month ≈ 13 items/month against
maybe 60–80 *distinct desirable* looks — a 4–5 month runway after the arc
(the arc itself buys ~15–20 items). Seasonal/limited drops are the eventual
answer; not a launch problem.

## Sinks

1. **Cosmetics** (exists) — the primary sink; prices stay as-is.
2. **Streak freeze** (new, high priority) — 150 coins (≈ a week of check-ins —
   deliberate; insurance should feel like a real purchase), hold max 2, auto-consumed on
   a missed day. Today a missed day hard-resets to 1, which is the single biggest
   churn cliff in the design: the punished user is the one most likely to quit.
   A freeze converts loss-aversion into a coin sink, softens the cliff, and is the
   proven IAP conversion point later (Duolingo). Implement in `touchStreak()`.
3. **Shop deal slot** (cheap win) — 1-in-3 days (via the existing `mulberry32`
   seeded roll) one featured item shows at 30% off. Variable-ratio reward that
   makes the daily shop check worth doing even when not saving for anything.
4. **Later:** gifts/consumables for the sidekick (snacks, toys — small bond-adjacent
   moments), room/environment decor, seasonal limited-window items (urgency +
   catalog refresh), re-color/dye an owned item.

## Bond track = progressive onboarding

Bond is not a parallel long-term economy — it's the **onboarding meter**. Per
[guided-sessions.md](guided-sessions.md): bond is the score of how much the
sidekick knows, it moves **only** through guided sessions (+4–8% each, deeper
themes pay more), and the ~2 sessions/day soft cap paces the arc. Thirteen
sessions at ~6% average from the floor of 10 tops the meter out — a fully
activated user finishes in roughly 2–4 weeks and **never deals with bond
again**. The map islands are the syllabus chapters; their existing thresholds
(25/40/55/70/85) are the intimacy ladder, not grindable gates.

Economy-relevant consequences:

- **Bond is never purchasable** (coins or money) — it measures real context,
  which is the foundation of personalization and ad relevance. Selling it
  would produce a high number that means nothing.
- **No chat-based or goal-based bond.** Sessions are the only source, so the
  meter stays an honest proxy for "context collected." (Deleting a memory in
  "What I know about you" reduces bond accordingly — the sessions doc already
  requires this.)
- **The bond/map surface goes quiet after the arc**, by design. Life-update
  re-takes (context freshness) are the only recurring touch, paid in coins
  (see faucets), not bond theater.
- **No decay.** If freshness ever needs teeth, decay the *context staleness*
  indicator, not the meter — and never re-lock islands (unlocks must feel
  earned forever, or travel becomes anxiety).

## Integrity

Everything is client-side localStorage and the dev panel can set any value — that's
fine for now; the economy is single-player and stakes are cosmetic. **The hard
prerequisite for IAP is moving coin balance + grants server-side** (grant log keyed
by date + faucet id, validated server-side). Design decision now that keeps that
migration cheap: every grant goes through a single `grantCoins(faucetId, date)`
choke point in `sidekick-economy.ts` rather than scattered `addCoins()` calls.

## Where IAP lands later (not day 0)

Ranked by fit, all preserving the earn curve:

1. **Streak repair/freeze for money** — restore a lost streak or buy freezes.
   Monetizes loss aversion without touching item pacing. Best first IAP.
2. **Exclusive premium cosmetics / seasonal pass** — money-only items (or a season
   track with free + paid lanes). The crown/laurel tier shows the shape: aspirational
   slots that never compete with earnable items on the same ladder.
3. **Coin packs — avoid, or price as a whale-skip.** Selling the earned currency
   directly deflates every faucet above. If ever added, price so it's a
   convenience for people who'd never grind, not a better deal than engaging.
4. **Never sellable:** bond, map unlocks, streak count itself. These are the
   relationship; selling them converts the app's sincerity into a vending machine.

## Build order

1. **Grant plumbing** — `grantCoins(faucetId, date)` choke point + idempotency
   ledger in localStorage; wire daily check-in claim + streak milestone table
   (table already exists, this is the highest-leverage single change).
   `START_COINS` → 150 in the same change.
2. **Streak freeze** item + `touchStreak()` consumption logic.
3. **Deal slot** in `todaysShop()`.
4. **Onboarding-arc rewards** — session coins, island arrival chests, and the
   6 exclusive island cosmetics (needs asset work). Ships with the session
   engine, and is the highest-priority thing after launch: sessions build the
   context foundation, so their incentive layer shouldn't trail them.
5. v2, only if metrics ask for it: goal completion coins, weekly quest,
   variable-content loot boxes, gifts/consumables, seasonal drops.

## Tuning levers & what to watch

Levers, in order of safety: faucet amounts (safe to tune anytime) → milestone
table (safe) → prices (avoid after launch; visible and feels like a rug-pull) →
`START_COINS` (day-0 only, invisible to existing users).

Watch: D1/D7/D30 retention against check-in claim rate (the claim rate IS the
habit metric now); median coins held (persistent hoarding > ~300 means the
catalog isn't desirable, since the faucet can't be "too rich" at 20–30/day);
time-to-first-purchase (should be session 1); % of days the shop sheet gets opened
(the deal slot's job); streak-reset → churn correlation (the freeze's job).
