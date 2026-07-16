# Wave: Mobile design-system + core screens

Owner: mobile agent. Scope = `apps/mobile` only. Source of truth: plans 06/07/08.

## Build order
1. Tokens: `tailwind.config.js` colors + `fontFamily.sans`; `lib/tokens.ts` raw hex + PASTELS + type/spacing.
2. Pure logic (RN-free, unit-tested from root vitest via `tests/mobile-*.test.ts`):
   - `lib/date.ts` — greeting, today label, relative day label.
   - `lib/chat-thread.ts` — `buildChatRows` (day separators), `mergeHistoryPages`, `getNextCursor`, `reduceStream`.
3. `lib/api.ts` — THE stitch file: trpc client w/ auth header, streaming fetch to `/chat/stream`,
   typed query fns for chat.history / mainConversation, goals (typed empty), search + historyAround (typed to 08).
4. `lib/auth.tsx` — anonymous register on launch, SecureStore token, in-memory token for headers.
5. `components/` — SolidShadow, PrimaryButton, SendButton, bubbles, ReplyChips, OptionCard,
   ProgressBar, StreakPill, GoalRow, BottomSheet, Skeleton, Caption.
6. Screens: `app/_layout.tsx` (fonts + providers), `app/index.tsx` (Home), chat sheet, `app/settings.tsx`.

## Stitch points (reconcile when server routers land)
- `chat.search` / `chat.historyAround` not on AppRouter yet → typed locally in `lib/api.ts`, return [].
- `goals.list` not on AppRouter yet → `fetchGoals()` returns [] (typed Goal[]).

## Rules
No `any`/`as`, no `&&` render, avoid useEffect/useRef, Reanimated not Animated, SolidShadow for hard shadow.
