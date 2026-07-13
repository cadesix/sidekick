# 17 — Gravity chat integration

Date: 2026-07-13

## Outcome

Ship Gravity sponsored suggestions in the Expo chat without adding latency to the assistant response, leaking sensitive conversations, or losing impression attribution.

This is not a greenfield integration. The repository already has most of the product surface:

- a network-neutral ad client and Gravity HTTP adapter;
- age, consent, sensitive-window, and frequency gates;
- filtered conversation context and ad-profile projection;
- persisted ad/message/event rows;
- chat history hydration;
- a native Expo sponsored card with click, dismiss, and 50%-visibility handling;
- DB-backed tests for eligibility, slotting, tracking, device signals, and mobile row mapping.

The remaining work is to bring that implementation in line with Gravity's current API and make delivery/tracking reliable.

## Recommendation

Keep the direct HTTP integration and the custom native renderer for v1.

Gravity recommends its SDK for web and Node apps, but the React renderer is not a React Native component. The existing adapter is small, preserves Sidekick's network-neutral boundary, and keeps all consent and sensitive-content gates ahead of the network call. The direct API is officially supported. Revisit `@gravity-ai/api` only if Gravity experiments or server-rendered compositions become a priority.

Use one stable placement:

```text
placement: below_response
placement_id: expo-chat-main
```

Start with Gravity test ads. Paid inventory must require an explicit production flag in addition to the API key.

## Current blockers

### 1. The request and response contract is stale

`packages/server/src/ads/gravity.ts` currently sends `placement` and `userId` at the top level. Gravity currently expects:

```json
{
  "messages": [{ "role": "user", "content": "..." }],
  "sessionId": "conversation-id",
  "placements": [
    { "placement": "below_response", "placement_id": "expo-chat-main" }
  ],
  "user": { "id": "pseudonymous-user-id" },
  "device": { "ua": "...", "ip": "...", "country": "US", "os": "iOS" },
  "excludedTopics": ["health", "politics"],
  "relevancy": 0.4,
  "testAd": true
}
```

The HTTP response is an array. The current parser expects a single object and requires an `id`, but the documented response does not guarantee `id`. This can turn valid fills into `null`.

### 2. Gravity impressions are not fired

The Expo list correctly detects 50% visibility and calls Sidekick's `ads.impression` mutation. That mutation only writes `ad_events` and returns `impUrl`; nothing requests the URL. Gravity therefore cannot count the impression for reporting or payout.

Clicks already open `clickUrl`, which is the correct tracked URL.

### 3. A filled ad can miss the current chat refresh

The streaming route schedules `runAdDecision` after the assistant turn finishes. The client invalidates chat history as soon as the response stream closes. The background ad insert can lose that race, and the production scheduler is plain fire-and-forget rather than a serverless `waitUntil` primitive. A filled ad may not appear until a later refetch, or the task may be terminated by the host.

### 4. Production mode is implicit

The direct API defaults `testAd` to false. Adding `GRAVITY_API_KEY` can therefore enable billable inventory immediately. Test versus paid traffic needs an explicit configuration boundary.

### 5. The privacy boundary is narrower than the product promise

Sensitive health-derived assistant messages are tagged and stripped. User messages about mental health, grief, relationships, body image, or finances are not synchronously tagged today. `excludedTopics` prevents matching on a topic; it does not prevent the text from being sent to Gravity.

The request also sends inferred interests and purchase intents in a custom top-level `profile`. That field is not part of Gravity's documented contract and is unnecessary for contextual matching. It should not be sent in v1.

### 6. Consent is stored but not controllable in the app

The database and server support `personalizedAdsConsent`, including conservative behavior outside the US, but Expo does not expose the setting. Users need a clear ads/privacy control before broad rollout.

## Implementation plan

### Phase 1 — Repair the Gravity boundary

Update `packages/server/src/ads/gravity.ts` and `packages/server/src/ads/decision.ts`.

- Change `AdRequest` to the documented wire shape: `placements` and `user: { id, email_hash? }`.
- Keep the internal client interface network-neutral, translating to Gravity's wire shape only inside `GravityHttpClient`.
- Remove the undocumented `profile` payload. Keep intent only as an internal decision input for whether to request an ad and which relevancy threshold to use.
- Parse the first item from the response array for the requested placement.
- Do not require a Gravity ad `id`; persist `campaignId`, `composition_id`, or no external identifier when absent.
- Preserve `clickUrl`, `impUrl`, `placement`, `placement_id`, and experiment identifiers needed for later reporting.
- Add a real timeout with `AbortSignal.timeout`, defaulting to 3 seconds to match Gravity's SDK. A timeout or malformed response remains a no-fill and never fails chat.
- Add `GRAVITY_PRODUCTION` to server env. Send `testAd: true` unless it is explicitly `true`.
- Keep `GRAVITY_API_URL` for contract tests and local development.
- Log a structured skip reason for HTTP status, timeout, and invalid payload without logging message content or signed tracking URLs.

Acceptance criteria:

- a documented Gravity array response becomes a persisted sponsored card;
- a 204, timeout, non-2xx, malformed body, or missing required render field becomes a silent no-fill;
- setting only `GRAVITY_API_KEY` still requests test ads;
- no raw email, phone, memory record, interest profile, or intent profile leaves the server.

### Phase 2 — Make ad delivery part of the stream contract

Update `packages/server/src/app.ts`, the shared stream-frame helpers, `packages/expo/src/lib/api.ts`, and `packages/expo/src/features/chat/useChat.ts`.

- Run the ad decision after the assistant message is persisted and sensitive-tool tagging is complete.
- Keep the assistant text stream independent: Gravity must never delay the first token or interrupt text already streaming.
- Before closing the response, emit a small `ad-ready` control frame containing the persisted ad message ID, or an explicit no-ad completion. Do not put the ad creative in the text stream.
- On `ad-ready`, invalidate the current history query so the existing history hydration path loads the card.
- Bound the post-text wait by the Gravity timeout. On timeout/no-fill, close normally.
- Apply the same behavior to `/chat/continue`, because a device-tool continuation can be the final assistant response for a turn.
- Remove the competing fire-and-forget ad scheduling from both the streaming and tRPC paths, or centralize it in one helper so one logical turn can request at most one ad.

This deliberately requests after the final response rather than in parallel with the model. Sidekick's safety policy depends on knowing whether the completed turn used a health/device tool. The ad wait occurs only after the user has received the assistant text, and the explicit stream frame eliminates the history-refresh race.

Acceptance criteria:

- a filled test ad appears directly below the response that triggered it without reopening chat;
- one logical turn makes at most one Gravity request, including device-tool continuations;
- Gravity failure does not change assistant text, finish reason, retry behavior, or composer recovery.

### Phase 3 — Complete impression and click attribution

Update `packages/server/src/ads/store.ts`, `packages/server/src/routers/ads.ts`, and the Expo sponsored-card/viewability path.

- Make the Sidekick impression endpoint idempotent per ad unit.
- On the first accepted impression, request the signed `impUrl`; treat a successful 2xx/3xx response as forwarded. Do not return signed tracking URLs to the client.
- Record whether forwarding succeeded so a transient failure can be retried without double-counting a successful impression.
- Continue opening `clickUrl` directly in `expo-web-browser`; it must remain the tracked URL and redirect to the advertiser.
- Record Sidekick's click event best-effort before opening, but never block navigation on analytics.
- Keep dismiss local for v1: hide the card immediately and use the brand exclusion for future requests. Add Gravity's formal ad-feedback endpoint only after storing a stable Gravity ad identifier and agreeing on the desired thumbs-down UX.
- Prevent duplicate impression forwarding across chat close/reopen and app remount, not just within one `ChatSheet` instance.

Acceptance criteria:

- scrolling a card to at least 50% visibility produces exactly one successful Gravity `impUrl` request;
- rendering below 50% produces none;
- tapping any card surface opens `clickUrl`, not the advertiser `url`;
- tracking failures never block scrolling, dismissal, or navigation.

### Phase 4 — Harden the privacy and consent boundary

Update message sensitivity handling, `packages/server/src/memory/ad-window.ts`, eligibility logic, and Expo settings.

- Add a synchronous, conservative sensitive-topic screen for both user and assistant text before any ad decision. Cover health, mental health, grief, relationship distress, body image, finances, sexuality, religion, and politics.
- If any message in the current moment is sensitive, skip the entire request. Do not merely remove one line and send the remainder.
- Continue treating health/device-tool output as sensitive structurally.
- Treat attachments and tool rows as non-forwardable. Send text-only user/assistant messages through the single `adForwardMessages` enforcement point.
- Keep a small bounded context window and never send summaries or long-term memory.
- Add a Personalized Ads setting backed by `users.personalizedAdsConsent`, with clear copy that contextual chat excerpts may be shared with an ad partner when enabled.
- Preserve the existing no-ads behavior for unknown age and under-18 users.
- Default unknown/non-US regions to off until explicit opt-in. Provide a US opt-out and account-deletion/privacy entry point.
- Document Gravity as an ad subprocessor before production launch.

Acceptance criteria:

- tests prove every ineligible and sensitive case makes zero network calls;
- turning consent off prevents the next ad request immediately;
- the Gravity request fixture contains only the allowlisted context and device fields.

### Phase 5 — Test mode, observability, and rollout

- Add a contract-level HTTP test using a local MSW server and the real `GravityHttpClient`. Assert the exact request JSON, Bearer auth, array parsing, 204 behavior, timeout behavior, and test-mode flag.
- Keep DB-backed integration tests for gating, frequency, persistence, history hydration, and event ownership.
- Add stream tests proving `ad-ready` ordering and no duplicate request across continuation flows.
- Add Expo tests for card mapping, visibility threshold, impression dedupe, click URL, and dismiss behavior. Prefer testing pure viewability/event helpers rather than mocking React Native internals.
- Add structured counters: request, gate reason, fill, render-ready, impression-forwarded, click, dismiss, timeout, and invalid-response. Never log conversation content or tracking URLs.
- Verify on a physical iOS and Android device with a Gravity test ad.
- In Gravity's dashboard, verify request, device/geography attribution, impression, and click before paid launch.
- Roll out internal users first, then a small US adult cohort behind the existing `ads` flag. Keep a holdout and watch fill, CTR, ads per DAU, dismiss rate, and retention delta.
- Enable `GRAVITY_PRODUCTION=true` only after the pre-flight checklist passes and Gravity confirms the native-app attribution/payout setup.

## Files expected to change

Server and shared:

- `packages/server/src/ads/gravity.ts`
- `packages/server/src/ads/decision.ts`
- `packages/server/src/ads/store.ts`
- `packages/server/src/ads/eligibility.ts`
- `packages/server/src/routers/ads.ts`
- `packages/server/src/routers/chat.ts`
- `packages/server/src/app.ts`
- `packages/server/src/env.ts`
- `packages/shared/app/src/prompts/suggested-replies.ts` or a new shared stream-frame module
- `packages/db/src/schema.ts` and a generated migration for idempotent impression delivery state

Expo:

- `packages/expo/src/components/SponsoredCard.tsx`
- `packages/expo/src/features/chat/ChatSheet.tsx`
- `packages/expo/src/features/chat/useChat.ts`
- `packages/expo/src/lib/api.ts`
- `packages/expo/src/lib/chat-thread.ts`
- the existing settings surface for the ads consent control

Tests:

- `tests/ads-*.test.ts`
- `tests/mobile-sponsored-card.test.ts`
- `tests/mobile-stream-frames.test.ts`
- a new Gravity HTTP contract test

## Decisions to confirm with Gravity before paid launch

These do not block test-mode implementation:

1. Whether their required publisher pixel can be satisfied for a native-only Expo app whose ad landing pages open in `expo-web-browser`, and whether their documented in-app WebView pixel path applies to `SFSafariViewController`/Custom Tabs.
2. Whether server-side fetching of `impUrl` is supported for native publishers, or whether it must originate from the device.
3. Whether a placement-specific `renderer_spec` or experiment setup is desirable for `expo-chat-main`; Sidekick will ignore unknown renderer fields in v1.
4. Their policy for mixed-age audiences and confirmation that Sidekick's under-18 exclusion is sufficient.
5. Data deletion requirements for pseudonymous user IDs and any retention controls available to publishers.

## Non-goals for v1

- lead-form ads;
- IDFA/GAID and an ATT prompt;
- web `@gravity-ai/react` components;
- server-delivered renderer specs or Gravity-controlled UI experiments;
- multiple placements or inline ads inside assistant prose;
- an ad-free subscription;
- sending inferred long-term profiles to Gravity.

## Sources

- [Gravity AI platform quickstart](https://docs.trygravity.ai/ai-platforms/quickstart)
- [Request ads](https://docs.trygravity.ai/ai-platforms/request-ads)
- [Contextual ads API reference](https://docs.trygravity.ai/engine/contextual-ads)
- [Show ads and custom-renderer tracking](https://docs.trygravity.ai/ai-platforms/show-ads)
- [Gravity pixel and native in-app browser guidance](https://docs.trygravity.ai/ai-platforms/pixel)
- [Going-live checklist](https://docs.trygravity.ai/ai-platforms/going-live)
- [JavaScript SDK](https://docs.trygravity.ai/sdks/javascript)
- [Publisher changelog](https://docs.trygravity.ai/ai-platforms/changelog)
