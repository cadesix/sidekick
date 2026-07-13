# 05 Monetization — implementation notes (Gravity conversational ads)

Scope: everything in plan 05 that exists without live Gravity creds. Real HTTP client (env-gated), scripted client for tests.

## Migration 0003 (packages/db, owned this wave)
- `attachments.pages` int nullable — PDF page count handoff.
- `ads` — one row per filled/served ad; render payload + linkage. `message.adUnitId` = `ads.id`.
- `ad_events` — impression | click | dismiss rows per ad.
- `purchase_intents` — extraction-sourced buy signals with strength + TTL; feed projection intents.

## Server
- `apps/server/src/ads/gravity.ts` — `GravityClient` interface, request/ad types, `HttpGravityClient` (env REST), `ScriptedGravityClient` (test double, records requests), `gravityClientFromEnv`.
- `apps/server/src/ads/eligibility.ts` — flag/age/consent gate (pure) + sensitive-window + frequency (db).
- `apps/server/src/ads/decision.ts` — `runAdDecision`: eligibility → suppression → frequency → build stripped context + profile → request → serve ad row + ads row + analytics log.
- `apps/server/src/ads/store.ts` — serve, adsForMessages, record impression/click/dismiss.
- `apps/server/src/routers/ads.ts` — impression/click/dismiss mutations. Appended to routers/index.ts.
- `routers/chat.ts` — ONE call site: `ctx.scheduleBackground(runAdDecision(...))` after send; attach ad payloads in history.
- `memory/projection.ts` — small-model IAB classification (flag/model-gated; deterministic map fallback) + intents from `purchase_intents`.
- `jobs/extraction.ts` + `prompts/extraction.ts` + `shared/memory/ops.ts` — `intent` op → purchase_intents.
- `attachments/ingest.ts` + `shared/attachments.ts` — persist pages + `pdfNativeEligible` predicate (≤100pp / ≤32MB).

## Eligibility (v1)
flag on → 18+ (bracket ≠ under-18/null) → personalizedAdsConsent === true → recent window has no sensitive rows → frequency headroom (≤3/day, ≥6 assistant turns apart). Minor/no-consent/flag-off: gravity.requestAd is NEVER called.

## Mobile
- `components/SponsoredCard.tsx` — SolidShadow card, always-visible Sponsored label, tap → expo-web-browser, viewability → impression.
- `ThreadMessage.tsx` renders it for adUnitId rows. `lib/api.ts` ad view mapping + impression/click.

## Not built (noted): ad-free subscription (Phase 4, not v1); live PostHog (env-log seam now); excludedTopics persistence from dismiss feedback (logged only); real device ua/ip forwarding (needs client capture through the stream endpoint).
