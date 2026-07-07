# 01 — App & Backend Architecture

## What exists today

This repo is a Vite + React web prototype: the onboarding funnel (`src/components/funnel/`, 18+ steps, FunnelHog-editable manifest), a chat UI (`src/chat.tsx`) talking to a Vercel serverless function (`api/chat.js`) that proxies OpenAI with a hardcoded system prompt and client-held history in localStorage, plus internal tools (chat lab, cosmetics studio, design-language admin). It's a design/UX reference, not the product. The production app is a fresh Expo project; we port components' logic and Tailwind styles, not the Vite scaffolding.

## Stack

| Layer | Choice | Why |
| --- | --- | --- |
| App | **Expo (SDK latest) + Expo Router + TypeScript** | Required by product direction; Router gives file-based navigation + deep links for notifications |
| Styling | **NativeWind 4** | Direct reuse of the prototype's Tailwind classes; the funnel port becomes mostly mechanical |
| Client state/data | **TanStack Query + tRPC client** | Team already knows tRPC from the Relic monorepo this funnel was lifted from |
| Backend | **Next.js API routes (or Hono) + tRPC on Vercel** | Matches existing deploy target (`vercel.json` already here); serverless fits chat + cron workloads |
| DB | **Postgres (Neon) + Drizzle ORM** | Relational fits goals/streaks/messages; JSONB for memory; Neon branches for preview envs |
| LLM | **Vercel AI SDK** with Claude (latest Sonnet) as the default chat model | Provider-agnostic seam — the prototype used OpenAI; AI SDK lets us A/B models per prompt without rewrites. Tool-calling and streaming are first-class |
| Auth | **Anonymous device account → Sign in with Apple/Google upgrade** | Zero-friction onboarding (critical for funnel conversion); account upgrade prompted after the user has something to lose (streak, sidekick) |
| Push | **Expo Notifications + EAS** | Standard; server stores Expo push tokens |
| Analytics | **PostHog** (events + feature flags + funnel A/B) | Prototype already stubs PostHog; flags drive funnel variants like the web version did |
| Crash/errors | **Sentry** (expo + server) | Same as Relic setup |
| Payments (later) | **RevenueCat** | Only if/when we add the ad-free subscription (see 05-monetization.md) |

## Repo layout

Monorepo (npm workspaces, this repo):

```
apps/mobile        # Expo app
apps/server        # Next.js/tRPC API + cron endpoints
packages/shared    # zod schemas, prompt builders, goal/memory types shared client+server
web/               # the existing Vite prototype, kept as design lab (chat-lab, cosmetics studio)
```

The chat lab and cosmetics studio stay on the web — they're internal tooling and already work. They should be re-pointed at the production API once it exists so prompt iteration happens against real memory rendering.

## Chat pipeline (the heart of the app)

Server-authoritative, unlike the prototype (localStorage history won't work with memory, multi-device, or ads):

1. Client sends just the new user message to `chat.send` (tRPC) with the active `conversationId`.
2. Server loads: conversation history (last ~30 messages), the rendered **memory block** (see user-memory.md), goal/streak state, and today's check-in status.
3. Server builds the system prompt from `packages/shared/prompts/` (versioned in git, editable via chat lab), calls the model via AI SDK with **tools**: `record_goal_progress`, `update_memory`, `set_reminder` (definitions in 03 and user-memory plans), and **streams** the reply to the client (AI SDK `streamText` → SSE; tRPC subscription or a plain fetch-stream endpoint alongside tRPC).
4. Tool calls execute server-side against Postgres; results loop back to the model within the same turn.
5. Everything is persisted: messages, tool calls, token usage, model id, prompt version — this is what makes evals and prompt iteration possible later.
6. Ad slotting hooks into this same pipeline server-side (a post-response step decides if this turn gets a sponsored unit — see 05-monetization.md), so ad decisions can see conversation context without a second client integration.

Latency budget: first token < 1.5s. Memory block is precomputed (not generated at request time), history is capped, and the model tier can drop for simple turns.

### Message schema (Drizzle sketch)

```ts
conversations: { id, userId, kind /* 'main' | 'onboarding' */, createdAt }
messages: {
  id, conversationId, role /* user|assistant|tool */, content,
  toolCalls jsonb, adUnitId nullable, promptVersion, model, tokensIn, tokensOut, createdAt
}
```

One long-running `main` conversation per user (the sidekick is a continuous friendship, not sessions); history windowing + memory carry the long-term context.

## Scheduled work

Vercel Cron (or Inngest if cron + fan-out gets hairy) drives:
- **Daily check-in generation** per user at their local reminder time (03-goals-and-checkins.md)
- **Nightly memory extraction/compaction** pass (user-memory.md)
- **Streak evaluation / reward grants** (04-gamification.md)
- **Ad-targeting profile refresh** (05-monetization.md)

Users are sharded by timezone; each cron tick queries "users whose local reminder time is now."

## Environment & delivery

- EAS Build + EAS Update (OTA for JS-only changes — critical for tuning prompts/ad load without App Review).
- Preview: Neon branch DB + Vercel preview per PR; Expo dev client against preview API.
- Secrets server-side only; the app never holds LLM or ad-network keys.

## Implementation order

1. Scaffold monorepo, Expo app with NativeWind, tRPC server, Neon + Drizzle, anonymous auth (device keypair → userId). **~3 days**
2. Port chat UI to RN with streaming + server persistence (no tools yet). **~3 days**
3. Funnel port (02-onboarding.md). **~1 week**
4. Tools + goals + check-ins (03). **~1 week**
5. PostHog + Sentry + push notifications wiring. **~2 days**

## Open questions

- Android at launch or iOS-first? (Live Activities and ATT considerations are iOS-only; Gravity fill rates may differ. Recommend iOS-first, Android fast-follow.)
- Do we need realtime (sidekick-initiated messages appearing live)? v1: push notification → app opens → fetch. No websockets needed until live activities.
