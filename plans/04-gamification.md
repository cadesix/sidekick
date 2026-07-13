# 04 — Gamification & Cosmetics

Purpose in the business model: cosmetics and streaks raise session frequency and session count — which is directly ad impression volume — and give the daily check-in a variable-reward payoff. Everything here is engagement infrastructure for the flywheel, so it must stay cheap to produce (generated assets) and never paywalled in v1 (ads are the monetization; scarcity drives engagement, not purchases).

## Cosmetic system

The prototype's cosmetics studio (`src/sidekick-cosmetics.tsx`) already proves the pipeline: a base sidekick plate with **mask regions** per slot, and image-gen producing items composited into those regions. Slots: `head`, `face`, `outfit`, `accessory` (already defined), plus `environment` (home-screen backdrop) later.

```ts
cosmeticItems: {
  id, slot, name, rarity /* common|rare|epic|legendary */,
  assetUrl, colorway nullable,  // items can be tinted per sidekick color
  source /* streak|spinner|event|starter */, seasonTag nullable, active
}
userItems: { userId, itemId, acquiredAt, equipped }
```

### Asset pipeline (offline, not runtime)

Weekly internal batch job using the existing studio flow: generate candidates per slot against the style guide → human curates in the studio UI → approved items upload to CDN with metadata → app gets them via a `catalog` endpoint (no app release needed). Target inventory: launch with ~40 items, add ~10/week. Cost is trivial (the studio already tracks ~$0.02–0.17/image). Seasonal/trend drops (spooky October hats, whatever is memeing that month) give recurring reasons to open the app and feed the "up on pop culture" personality pillar.

## Streaks

- A streak day = completing the daily check-in (chat-based, so the streak is about *showing up and talking*, not perfection — you keep your streak even on a "missed my run" day; honesty must never cost the user).
- **Reward curve, front-loaded** (per the notion doc): guaranteed item at days 1, 2, 3, 5, 7, 10, 14, then weekly; rarity odds improve with streak length. Day-1/2/3 rewards are chosen-for-cuteness commons so the first week feels generous.
- **Streak repair:** one "cover for you" token per 2 weeks, framed in-voice ("i told everyone you were here yesterday. we're even"). Hard streak loss is the top uninstall trigger in habit apps; repair keeps the mechanic motivating instead of punishing.
- Streak state renders in chat (sidekick celebrates milestones) and on home (flame + next-reward preview — always show what's coming, anticipation does the work).

## Daily spinner / loot box

After completing a check-in, a spinner (or box-opening moment — pick one animation and make it *juicy*: Reanimated + haptics + confetti) grants: a cosmetic item (weighted by rarity), or a small "sparks" currency drop. Sparks exist as pity-timer smoothing: accumulate to redeem a chosen item, so dupes/bad luck still progress somewhere. No purchasable currency in v1 — keeps us clear of loot-box/IAP policy scrutiny and keeps the App Store rating clean, which matters for ad-network audience quality.

Server-authoritative rolls (`rewards` table with idempotent grant per checkIn), client just animates the result.

## Cash gifting / UA experiment (notion doc idea)

Park it: gifting users money has fraud, tax, and App Store complications. The adjacent v2-safe version is **gift a friend a legendary item** (referral: both sides get an exclusive cosmetic when the invitee finishes onboarding). Revisit real cash only if an ad-network partner will underwrite it as a co-marketing spend.

## Sequencing

1. v1 (with Phase 2): items catalog + equipped rendering on home, streaks + fixed reward schedule. **~4 days**
2. Spinner moment + sparks: **3 days**
3. Referral gifting: **3 days** (post-launch)
4. Environments slot + seasonal drops: ongoing content ops, ~1 person-day/week
