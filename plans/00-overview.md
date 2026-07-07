# Sidekick — Master Plan

Sidekick is a consumer iOS/Android app (Expo) where an AI companion — a cute customizable character — keeps you accountable toward everyday goals through daily, friend-like chat. We monetize with conversational ads via Gravity (trygravity.ai), the way Daimon does, so nearly every product decision below is also evaluated against one business metric: **high-quality ad CPMs**, which come from (1) a US-heavy, engaged, 18+ audience, (2) rich, consented first-party targeting data, and (3) daily chat sessions where ads render natively.

## Plan index

| Plan | Covers |
| --- | --- |
| [01-architecture.md](01-architecture.md) | Expo app, backend, chat pipeline, auth, analytics |
| [02-onboarding.md](02-onboarding.md) | Porting the funnel to Expo, onboarding chat, push-notif prompt |
| [03-goals-and-checkins.md](03-goals-and-checkins.md) | Goal/action-item model, daily check-in engine, tool calls, notifications & live activities |
| [04-gamification.md](04-gamification.md) | Cosmetics, streaks, daily spinner, generated-asset pipeline |
| [05-monetization.md](05-monetization.md) | Gravity integration, ad UX, CPM optimization, subscription complement |
| [06-design-system.md](06-design-system.md) | **Design tokens, components, RN/NativeWind port, motion — read before building any UI** |
| [07-screen-specs.md](07-screen-specs.md) | **Build-ready wireframes + layout trees + states + copy for every screen** |
| [user-memory.md](user-memory.md) | Memory data model, extraction, prompt rendering, ad-targeting projection |

## For the implementer — read order & UI rule

Build in this order: **06-design-system → 07-screen-specs → 01-architecture → feature plans (02–05) → user-memory.** The two design docs are prescriptive and copy-paste-grade; 06 defines the reusable `packages/shared/ui` components and 07 composes them into screens. **Do not design new UI** — every screen already has a wireframe, an exact layout tree, all states, and the exact copy in 07, grounded in the locked visual language in `design-system/*.html`. When any plan says "port `home.tsx`" or "sidekick character front and center," the concrete spec lives in 07. If a value (color, size, radius, copy, state) isn't in 06/07, it's in the reference cards; if it's in neither, ask before inventing.

## The flywheel

```
onboarding quiz  →  seeds memory + declared interests (targeting data, day-1 personalization)
daily check-in   →  the retention loop (push → chat → goal tracking → streak)
chat             →  grows memory (better personalization AND better ad targeting)
gamification     →  raises session frequency (more ad impressions)
ads (Gravity)    →  revenue scales with sessions × targeting quality
```

Memory is the strategic asset: the same profile that makes the sidekick feel like a real friend is the first-party data that makes our inventory premium. The two must be built as one system (see user-memory.md's ad-targeting projection).

## Build order

**Phase 1 — Core loop (weeks 1–4).** Expo app skeleton, auth, backend + Postgres, onboarding funnel port, chat with streaming + memory v1 (onboarding-seeded profile in system prompt), goal/action-item model, manual daily check-in chat, push notifications. Ship to TestFlight.

**Phase 2 — Retention (weeks 4–7).** Scheduled variable check-in messages, inference-based goal tracking (tool calls), streaks + first cosmetic unlocks, memory extraction from chat, "what do you know about me" screen.

**Phase 3 — Monetization (weeks 6–9, overlaps).** Gravity SDK/API integration behind a feature flag, targeting-metadata pipeline from memory projection, consent + age gating, ad frequency tuning against retention dashboards. Optional ad-free subscription.

**Phase 4 — Polish & growth (ongoing).** Live Activities, daily spinner, generated cosmetic drops, pop-culture proactivity, referral/gifting experiments, screen-time-backed goals (iOS Family Controls — file the Distribution entitlement request early, see 03).

## Guardrails that protect CPMs (and users)

- **Age gate at onboarding.** 16+ floor (Daimon's posture); under-18 users get no ad requests at all in v1 — legal (COPPA/state laws) and a brand-safety requirement ad networks will audit.
- **Ads never impersonate the sidekick.** Sponsored content is visually labeled. Trust is the retention asset; retention is the impression volume. (Perplexity's Feb-2026 retreat from ads is the cautionary tale.)
- **Realistic revenue math.** Plan on $10–30 eCPM for US-heavy conversational native ads, not Gravity's $150 marketing tail. Gravity has no RN SDK — integration is server-side REST inside our chat pipeline, which is actually the better architecture (see 05).
- **Wellness content sensitivity.** Goals touch sleep, stress, fitness — we must never pass sensitive-health signals (mood, mental-health context) to ad targeting. The memory → ad-targeting projection is an explicit allowlist, not a dump.
- **Every check-in is measured.** D1/D7/D30 retention and check-in completion rate are the north-star metrics; ad load is tuned subordinate to them.
