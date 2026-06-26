# funnel-local

Standalone, local-only copy of the Relic web funnel (quiz → results → paywall →
auth → success), lifted out of the `marketing-site` package of the Relic monorepo
into a plain **Vite + React + TypeScript + Tailwind** SPA.

The goal here is **frontend iteration without a backend**. Every server call the
funnel made is replaced by a mock, so the whole flow runs offline.

## Run it

```bash
npm install
npm run dev        # http://localhost:3100
```

`npm run build` / `npm run typecheck` also work.

## What's real vs. mocked

The funnel UI is copied **verbatim** from the source — all 26 components in
`src/components/funnel/` are unchanged except `paywall-step.tsx`. The only edits
live at the backend/framework boundary:

| Source dependency        | Replaced with                                  |
| ------------------------ | ---------------------------------------------- |
| tRPC client (`@sans/api`)| `src/utils/trpc.tsx` — canned mock responses   |
| `@sans/api` types        | `src/lib/sans-api-types.ts` — minimal shapes   |
| Stripe Elements paywall  | `paywall-step.tsx` — mock CTA + dummy card sheet|
| `next/image`             | `src/shims/next-image.tsx` — plain `<img>`     |
| `posthog-js`             | `src/shims/posthog.ts` — no-op proxy           |
| `@sentry/nextjs`         | removed                                        |
| `process.env.NEXT_PUBLIC_*` | inlined in `vite.config.ts` `define`        |

### Restoring a real backend

Swap `src/utils/trpc.tsx` back to a real tRPC `httpBatchLink` (pointing at a live
API) and restore the Stripe Elements paywall from the source repo. Everything else
is already production-faithful.

## A/B variants

The funnel resolves its step sequence from PostHog feature flags, which are no-ops
here, so it always renders the **`default`** variant (the full 18-step flow). To QA
the short `direct` variant, change `DEFAULT_VARIANT` in
`src/components/funnel/manifest.ts` or pin the assignment in localStorage.
