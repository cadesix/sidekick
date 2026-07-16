# 05 — Monetization: Gravity Conversational Ads

Business model: free app, native sponsored suggestions in chat via **Gravity** (trygravity.ai), Daimon-style, with an optional ad-free subscription later. This plan is grounded in Gravity's public docs and a research pass over the AI-ads landscape (July 2026); unverified items are flagged at the bottom.

## What Gravity actually is (verified)

Gravity ("The Ad Network for AI", ~$75M valuation seed Oct 2025) places **contextual sponsored suggestion cards inside LLM conversations** and pays publishers on CPM. Key facts that shape our integration:

- **Matching is conversation-contextual, not profile-based.** The ad request carries recent `messages`, `sessionId`, `user.userId`, device signals (`ua`, `ip`, `country`, `os`), optional **SHA-256-hashed email/phone**, `excludedTopics`, and a `relevancy` threshold. There is no field for demographics or interest profiles — "it lives and dies with the conversation."
- **No React Native/Expo SDK exists.** SDKs are Node/TS (`@gravity-ai/api`), web React, Python, CLI. The correct architecture for us is **server-side**: our chat backend calls `POST server.trygravity.ai/api/v1/ad` (or the Node SDK) and our RN client renders the returned ad JSON natively, firing the returned `impUrl` on visibility and `clickUrl` on tap. No-fill returns empty — never blocks chat.
- **Formats:** sponsored suggestion cards (`title`, `adText`, `brandName`, `cta`, `favicon`, `url`) at placements like `below_response` / `inline_response`; up to 10 placements per request; also lead-form units. React examples at react-sandbox.trygravity.ai are our visual reference.
- **Economics:** publisher paid per impression, advertisers billed CPM. Their calculator claims $6 / $25 / $150 CPM (low/mid/high). Rev-share % and payout thresholds are negotiated per publisher, not published.
- **Documented eCPM levers:** match quality, above-average CTR, fill rate, **hashed emails ("unlocks view-through attribution, which advertisers see and bid up for")**, correct attribution setup.
- **Policies that bind us:** no PII in requests (hashing/pseudonymous IDs only); no GDPR special-category data (explicitly **health**) for EEA/UK inventory; targeting on sensitive conversation content requires explicit user authorization; **no incentivized ad views** (never tie ads to streaks/rewards); no refresh <30s; ads clearly labeled and visually distinct from AI output (FTC).

**Planning number: $10–30 eCPM** on US-heavy traffic. Koah (closest comparable network) independently reports $10 average eCPM with ~7.5% CTR; Gravity's $25 "mid" is marketing. That's still ~10–30× banner CPMs and rewarded-video-class revenue with far less UX damage. Do not model the $150 tail.

## Integration architecture

The ad path lives inside the chat pipeline (01-architecture.md step 6):

1. On each eligible assistant turn, the server fires the Gravity ad request **in parallel with the LLM call** — zero perceived latency. We forward a **filtered** window of recent messages (see filtering below), placement `below_response`, the user's `sessionId`, stable pseudonymous `userId`, real device `ua`/`ip`/`os`/`country` (captured from the client request), and hashed email when we have one.
2. If Gravity fills above our relevancy bar, the reply payload includes an `ad` object; the RN client renders a **sponsored card** below the sidekick's bubble — visually distinct (card chrome + "Sponsored" label + brand favicon), never in the sidekick's voice, never as a chat bubble. Impression pixel fires only when the card is ≥50% visible (RN `onViewableItemsChanged`), click opens `SFSafariViewController`/Custom Tab.
3. All ad events (requested, filled, viewed, clicked, dismissed) go to PostHog with conversation position, so we can correlate ad exposure with retention cohorts from day one.

Client rendering is ~a day of work; the sophistication is server-side policy:

### Ad-slotting policy (our lever, our risk)

- **Eligibility gate before any request is sent:** user is 16+ with known age, has ad consent where required, conversation is not in a sensitive state, and frequency caps have headroom.
- **Frequency: start at max 1 sponsored card per check-in session, min 6 assistant turns apart, max 3/day.** Loosen only with retention data in hand. Gravity's 30s floor is far too permissive for a companion app — trust is the inventory.
- **Sensitive-moment suppression:** a cheap classifier (or flags set by the memory extractor) marks conversations touching mood/mental health, body image, grief, relationship distress → no ad request at all for that session. Also strip any message containing health-ish content from the forwarded window (hard requirement for EEA/UK, good practice everywhere). Static `excludedTopics` list as backstop.
- **High relevancy threshold, low fill, on purpose.** Docs suggest inline slots tuned to ~40% fill. Fewer, better ads: CTR is a documented bid-lifter, so quality compounds into CPM. Tune per-placement in their dashboard experiments.
- **Intent-aware boosting:** the check-in engine knows when conversation enters purchase-adjacent territory (new goal setup — "i want to start running" — gear talk, app/service needs). Those turns get priority ad slots; idle emotional chat gets none. This is where our memory/goal system turns into CPM: declared goals → naturally high-intent conversation context → strong matches. (Gravity takes no profile field — see the reconciliation note in [user-memory.md](user-memory.md) §5 — so our profile works through slotting policy and context, not through the request payload.)

### CPM maximization checklist

1. **Hashed email at signup** — the single biggest documented bid-lifter. Add an email capture moment post-onboarding ("want a weekly recap from me?") since anonymous-first auth means we don't otherwise have one. SHA-256 client-side.
2. **Real device signals** — forward client `ua`/`ip`/`os`/`country`, never our server's.
3. **US-first launch/UA** — Tier-1 audience is a large CPM multiplier across every network.
4. **Skip IDFA/ATT in v1** — ATT prompts tank opt-in and Gravity works contextually without it. Revisit only if Gravity shows us data that consented IDFA meaningfully lifts our CPMs.
5. **Attribution:** Gravity's web pixel is "required for attribution and payouts" and is not documented for native apps — **this is the #1 question for our Gravity kickoff call** (support@trygravity.ai / their Calendly). Get their native-app attribution story (server-side conversions API? in-app-browser pixel?) in writing before forecasting revenue.
6. **Ad feedback loop:** wire their thumbs up/down feedback endpoint to a long-press on the card; feed our own "hide ads like this" into `excludedTopics`.

## Age gating & compliance

- **16+ floor** (Daimon's posture: 16+ App Store rating + 16+ privacy-policy floor). Our funnel's `under-18` bracket → **no ad requests at all** for v1 (simpler and safer than "contextual-only"), excluded from email hashing and any data sharing. Neither Gravity nor Koah publishes a minors policy — get Gravity's mixed-age-audience guidance in writing.
- **Privacy policy** must disclose sharing de-identified, conversation-derived data with ad partners (Daimon's policy is the template — it names "AI-generated profile summaries" and "specialized ad networks").
- **Settings:** personalized-ads toggle (EU opt-in default, US opt-out), CCPA "do not sell/share" link, deletion cascades (our DB + whatever deletion mechanism Gravity provides).
- **Never incentivize ad engagement** — no sparks, streak credit, or spinner entries connected to ads in any way (explicit Gravity ban + platform policy risk).

## Backup & complements

- **Koah (koahlabs.com)** — strongest fallback and the only major player with a **documented React Native SDK**; $5M seed, published $10 avg eCPM, net-30. Build our ad-slotting layer network-agnostic (a `SponsoredCard` model + server adapter interface) so Koah is a config change, and consider it for A/B mediation later. Koah/Nexad also accept profile-style signals — where user-memory.md's `ad_profiles` projection plugs in directly.
- **Nexad** — a16z-seeded; powers Dippy (30M-user companion app), the closest proven comp; worth a conversation.
- **ChatAds** — affiliate-based (keep 100% of commissions); interesting for explicit product-recommendation moments ("what running shoes should i get") where affiliate beats CPM.
- **Ad-free subscription (Phase 4):** Daimon precedent is ads + $3.99–$19.99 Pro. Ours: "Sidekick+" removes ads + cosmetic perks, via RevenueCat. Don't build until ad revenue and retention baselines exist — it complicates every funnel metric.
- **Cautionary tale:** Perplexity sold $50+ CPM sponsored questions, then abandoned ads entirely (Feb 2026) over trust erosion in an advice product. Our defense is the slotting policy above: high relevancy bar, sensitive-moment suppression, hard caps, and clear labeling.

## Metrics & rollout

Feature-flagged (PostHog) rollout: internal → 10% → 50% → 100%, watching **D7/D30 retention delta between ad-exposed and holdout cohorts** (keep a permanent 5% holdout), fill rate, eCPM, CTR, ads-per-DAU, and "ad complaint" feedback rate. Kill criteria pre-agreed: >2pt D7 retention drop at 1 ad/session → tighten caps before adding volume. Revenue model to sanity-check with Gravity: DAU × sessions/day × fill × (eCPM/1000).

## Effort

- Server ad adapter + eligibility/frequency policy + message filtering: **4 days**
- RN sponsored card + viewability + click-through + feedback: **2 days**
- Consent settings + privacy-policy updates + age-gate wiring: **2 days**
- Gravity onboarding, attribution setup, dashboard experiments: **~1 week calendar time** (their team configures payouts/thresholds)

## Unverified items (from research — do not treat as fact)

1. Daimon→Gravity link: Daimon verifiably runs ads and shares chat-derived profiles with "specialized ad networks," but no public source names Gravity.
2. Gravity rev-share %, payout schedule, minimums: negotiated, unpublished.
3. Real-world Gravity CPMs: only their own calculator; zero independent publisher numbers found.
4. Native-app (non-WebView) attribution with Gravity's pixel requirement: undocumented — kickoff-call question #1.
5. Minors policy for Gravity and Koah: absent from public docs.
