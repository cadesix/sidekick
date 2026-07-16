# 02 — Onboarding

## Source material

The web funnel in `src/components/funnel/` is the spec: welcome → goals (8 options, multi-select) → 20-item Big Five quiz with interstitials → name/age/gender → personality result → sidekick reveal → color → sidekick naming → onboarding chat. `manifest.ts` defines steps as data; `types.ts` has `FunnelAnswers`. This ports to Expo nearly 1:1.

## Port strategy

- Keep the **step-manifest pattern**: `StepConfig[]` drives a single `<Funnel>` screen (one Expo Router route, internal step index — no router navigation per step; swipe-back is disabled mid-funnel, a back button decrements the index). This preserves FunnelHog editability and PostHog-flag variant selection (`VARIANT_STEPS` keyed by flag, as on web).
- Port step components to RN + NativeWind. The heavy ones (reveal/meet animations, progress bar) need Reanimated rewrites; the question steps are mechanical.
- Answers accumulate in a local `FunnelAnswers` object and are **persisted to the server incrementally** (each step completion fires `funnel.saveAnswers` + a PostHog event with step id/version). Incremental save matters: drop-off users with goals+age+gender are still valuable (re-engagement push, and a partial profile if they return).
- Assets (`/icons-macos9/`, `/scenes/`, sidekick art) move into the Expo asset pipeline; preload the next step's image during the current step so transitions stay instant.

## Decisions & changes from the web funnel

1. **No paywall step.** The web funnel came from a subscription product (Relic); Sidekick is ad-monetized. The funnel ends at onboarding chat → home. (An ad-free upsell can come much later, in-app — see 05.)
2. **Account creation is invisible.** Anonymous device account is created at funnel start so answers persist server-side from step 1. Apple/Google sign-in is offered post-onboarding ("save your sidekick"), never as a funnel gate.
3. **Age step is load-bearing.** `under-18` routes the user into a non-personalized-ads experience and excludes them from targeting sync (05-monetization.md). Never make this skippable; keep the answer immutable-ish (edits require support flow) to prevent gaming and to satisfy ad-network audits.
4. **Interests step (new, add before RESULT).** One multi-select screen — "what are you into?" (music genres, gaming, fitness culture, fashion/beauty, tech, sports, food, travel, books/anime/etc.). 10 seconds of user effort, and it seeds both day-1 personalization ("you're into anime? have you seen…") and the declared-interest half of the ad-targeting profile. This is the single cheapest high-CPM lever we have — declared interests beat inferred ones for ad networks.
5. **Push-notif prompt stays inside onboarding chat** (as the notion doc says), asked by the sidekick after reminder cadence is chosen, with a pre-permission soft prompt ("want me to actually text you? i'll need notification access") before the OS dialog — this reliably doubles opt-in vs. a cold OS prompt, and push opt-in is the #1 driver of the daily-session flywheel.

## Onboarding chat

The last step drops the user into a guided chat with their newly-named sidekick. This is a scripted-with-LLM-color conversation, not freeform: a small server-side state machine walks required beats, and the LLM renders each beat in the sidekick voice with the user's quiz results in context.

Beats, per the notion doc:
1. Sidekick intro (references personality result: "ok so you're an INFP-ish 'dreamer' type, i love that for us").
2. For each chosen goal: pick an action item from that goal's catalog (rendered as tappable **reply chips**, e.g. Get Fit → [go to the gym] [run] [play a sport] [something else]) then frequency/criteria ("how many times a week feels realistic?"). Free-text always allowed; the LLM maps it to structured `action_item` + `cadence` via tool call.
3. Reminder cadence (default daily; pick a time — store timezone!).
4. Push permission (soft prompt → OS prompt).
5. Handoff: sidekick sends the first "real" message; user lands on home.

Implementation: `conversation.kind = 'onboarding'`, a `beat` pointer stored on the conversation, one tool `commit_onboarding_choice(goalId, actionItemId, cadence)` the model must call before the state machine advances. Everything committed here writes the goal records (03) and the memory seed (user-memory.md).

## Analytics

Every step emits `funnel_step_viewed`/`funnel_step_completed` with `{stepId, version, variant}` — same shape as web so dashboards are comparable. Key funnel KPIs: completion rate to chat, push opt-in rate, time-to-complete, and per-step drop-off (the 20-question quiz is the risk; be ready with a short-quiz variant flag that uses 10 items).

## Effort

- Funnel shell + simple steps: **3–4 days**
- Reveal/meet/color/naming animated steps: **2–3 days**
- Onboarding chat state machine + tools: **3 days**
- Interests step + analytics wiring: **1 day**
