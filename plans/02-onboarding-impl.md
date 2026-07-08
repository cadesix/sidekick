# 02 — Onboarding implementation notes

Port of the web funnel (`web/src/components/funnel/`) to Expo + server, per plan 02.

## Wave 2 — LLM-driven onboarding chat + reply chips
- `conversations.kind = 'onboarding'`: own system prompt (persona + ONBOARDING SETUP CHAT block, `packages/shared/src/onboarding-chat.ts`), restricted tool set (`packages/shared/src/tools/onboarding.ts`: `commit_onboarding_choice`, `set_reminder_time`), beat pointer DERIVED from durable rows (goal has active action item? reminderTime set?) — never stored.
- `onboarding.startChat({ goalSlugs })` (idempotent): creates the conversation, planless goal rows, and an LLM-rendered intro message. Turns run through the normal `/chat/stream` pipeline; `turn.ts` branches on kind.
- Completion marker moved to `users.onboardingCompletedAt`; `complete()` keeps chat-committed plans via `ensureGoalPlan`, `reminderTime` optional (chat-set value wins, default 09:00).
- Reply chips: post-hoc `suggestReplies` call (flag `suggested_replies`, replyModel = captionModel) → stream-meta control frame (`stream-meta:{replies,beat}`) + `TurnOutcome.suggestedReplies`. Onboarding turns always carry `beat`; client push-permission UI keys off `wrap_up`.
- Scripted client flow retained as the fallback when `startChat` fails.
- tokenEstimate: user messages now include attachment expansion (`attachmentExpansionTokens`).

## Server (apps/server)
- `users` router (`routers/users.ts`): `me` (profile read incl. sidekickName + derived `onboardingComplete`), `updateProfile` (incremental funnel saves; applies age-gate side effects when `ageBracket` present).
- `onboarding` router (`routers/onboarding.ts`): `complete` — the single cold-start seed transaction (user-memory.md §6). Sets profile, adopts goals (reusing goals.adopt logic), seeds `source='onboarding'` memories (identity + preference + goal_context per goal), sets reminderTime/pushToken, marks complete. Idempotent.
- `onboarding/seed.ts`: pure memory-sentence builders (exported from `@sidekick/server` for tests).
- Completion marker: `users.reminderTime IS NOT NULL` (set only by `onboarding.complete`; no db column can be added — packages/db owned by another agent). `onboardingComplete = reminderTime !== null`.

## Age gate (plan 00: 16+ floor, under-18 → no ads)
- `ageBracket === 'under-18'` → `personalizedAdsConsent = false` (ads-off flag). Any bracket sets `ageGatePassed=true`, `ageGatePassedAt=now`.

## Mobile (apps/mobile)
- `features/onboarding/`: manifest.ts, types.ts, personality.ts, sidekick-colors.ts, navigation.ts (pure), interests.ts, plan.ts (onboarding-chat scripting), step components.
- `app/onboarding/index.tsx`: single route, internal step index + FunnelAnswers state; incremental save; completion → `router.replace('/')`.
- Routing: `app/index.tsx` gates on `users.me` (server-authoritative) → `<Redirect href="/onboarding">` when incomplete. onboarding route redirects home when already complete.
- Home stitch: `{sidekickName} has something to say 👀` subline wired to users.me + check-in status.
- Onboarding chat: scripted quick-reply port (client-side), commits via `onboarding.complete`. Push prompt beat: expo-notifications soft prompt → OS prompt → token to server.

## Funnel step order (shipped)
welcome, goals, transition, quiz-intro, quiz-prompt, q1–q5, fact, q6–q20, name, age, gender, interests (new, plan 02 §4), result, reveal, meet, choose-color, name-sidekick, onboarding-chat.
</content>
</invoke>
