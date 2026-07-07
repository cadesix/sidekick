# 03 — Goals, Action Items & Daily Check-Ins

The daily check-in is the retention engine: a variable, friend-like message each day that pulls the user into chat, where the sidekick infers goal progress from conversation and records it with tool calls (never a form, never a nag).

## Data model

```ts
goals: {           // a user's chosen high-level goal
  id, userId, slug /* 'get-fit' | 'sleep-better' | ... */, status /* active|paused|done */, createdAt
}
actionItems: {     // the concrete commitment under a goal
  id, goalId, slug /* 'gym' | 'run' | ... */, label,
  cadence jsonb,   // { type:'weekly', target:3 } | { type:'daily' } | { type:'daily-criteria', criteria:'sleep-by', value:'23:30' }
  status, createdAt
}
checkIns: {        // one row per user per local day — THE core table
  id, userId, date /* local date */, status /* pending|opened|completed|skipped */,
  openerMessageId, completedAt
}
progressEvents: {  // what the sidekick inferred/recorded
  id, actionItemId, checkInId nullable, date, outcome /* hit|missed|partial|skipped — matches log_checkin's enum */,
  note,            // "ran 5k in the rain, felt great"
  source /* inferred|user_stated|manual|device */, messageId, createdAt
}
```

Goal/action-item **catalogs** live in `packages/shared` as data (like the funnel manifest): each goal ships 3–6 suggested action items plus cadence templates and per-goal prompt guidance ("for sleep goals, ask about last night, not tonight"). Custom user-defined action items are just rows with `slug:'custom'`.

Trackability tiers (from the notion doc's open questions): tier 1 = binary/count items (gym, run, read N pages) — fully supported v1; tier 2 = time-criteria items (sleep by X, work done by X) — supported via conversation; tier 3 = fuzzy goals (social skills, "be more productive") — no hard tracking, the sidekick sets a weekly micro-challenge instead ("talk to one stranger this week") which becomes a tier-1 item. **Tier 4 = screen-time-backed items** (stop-doomscrolling, stop-procrastinating) — backed by real device data via Apple's Screen Time API where available, falling back to self-report; see below.

## Screen-time goals (iOS Family Controls)

The doomscroll/procrastinate goals are the one place a habit app can beat "just be honest with me" — we hold the user to a limit *they set*, verified by the OS. This is a native iOS feature (Android has a rougher `UsageStatsManager` equivalent, deferred); on unsupported platforms these goals silently fall back to tier-2 self-report so the loop still works.

**The hard constraint that dictates the whole design:** Apple never lets raw usage data into our app's process. The `FamilyActivityPicker` returns *opaque tokens* — we can't even learn *which* apps the user selected, let alone read "47 min on TikTok." The `DeviceActivityReport` extension that can see usage is a separate, severely sandboxed process where data flows *in* but nothing flows back out to the host app or JS. **So we cannot feed usage numbers into the sidekick's prompt.** Anything claiming otherwise is fighting the platform.

What Apple *does* sanction is **threshold events**, which is the right primitive for us anyway:

1. **Commitment setup (in chat or a light native sheet):** when a user adopts a screen-time goal, we present the system `FamilyActivityPicker` — they pick the apps/categories to limit and a daily budget ("30 min on socials"). We store the opaque `ActivitySelection` token + threshold locally (never leaves the device; it's meaningless off-device anyway).
2. **Monitoring:** a `DeviceActivityMonitor` extension registers the threshold. When the user crosses it, iOS wakes the extension with an `eventDidReachThreshold` callback. The extension writes a flag to a shared **App Group** container and can fire a local notification.
3. **What the sidekick learns:** a boolean per day — *budget kept* or *budget blown* (and optionally "blown by a lot" via a second, higher threshold). The chat pipeline reads this flag from the App Group at check-in time and the sidekick reacts in-voice ("saw you stayed under your limit today, proud of u" / "the scroll got you today huh — no shame, reset tomorrow?"). This becomes a normal `progressEvents` row (`outcome: hit|missed`, `source: 'device'`) — same model as every other goal, so streaks/home-checklist/memory all just work.

Framing this as *the user's own commitment the OS enforces*, not us watching them, is both the privacy-correct story and the better product story. We never see what they browse; we see whether they kept a promise to themselves.

**Build path:** use the existing community module **[`react-native-device-activity`](https://github.com/kingstinct/react-native-device-activity)** (kingstinct) rather than writing the native module from scratch — it wraps `FamilyControls` + `ManagedSettings` + `DeviceActivity`, exposes the picker/threshold/monitor surface to JS, and, critically, handles the EAS/Expo provisioning of the extension targets and the **Family Controls (Distribution)** entitlement (set up once, then automatic). Two non-negotiable lead-time items: (a) the Distribution entitlement requires an **Apple approval request that has run days-to-weeks** in practice — file it the moment we commit, well before we need it; (b) it needs a config-plugin/dev-client build (the extensions can't exist in Expo Go). Because of the approval lead time and native surface, this ships **Phase 4**, gated behind a capability check, with self-report live from v1 so the goals are never blocked on it.

## Daily check-in engine

Cron (per-timezone shard, see 01) at each user's reminder time:

1. Gather context: yesterday's progress events, current streak, memory highlights (upcoming events, recent life context — from user-memory.md), weather for user's city (one cheap API call; enables "it's soo hot today, did you get your run in?"), day-of-week.
2. Generate the **opener** with a dedicated prompt (not the chat prompt): 1–2 sentences, references at most ONE context signal, rotates tone archetypes (hype / cozy / curious / playful callback) with recent-opener history in context to prevent repetition. Variability is a product feature — sameness kills the "friend texting you" illusion.
3. Insert as an assistant message in the main conversation, create the `checkIns` row, send push (payload deep-links to chat). If push is off, it's waiting in-app + badge.
4. **Quiet failure handling:** if the user hasn't opened chat by evening, one softer follow-up push max ("no stress, just thinking about u"). Never more than 2 pushes/day. Missed check-ins auto-close as `skipped` at local midnight — tomorrow's opener may reference it gently ("we don't talk about yesterday lol. fresh start?").

## In-chat goal inference (tool calls)

The chat system prompt includes today's check-in state + active action items. The primary tool is **`log_checkin(goal_id, date, result, note)`** — full definition and context-rendering contract in [user-memory.md](user-memory.md) §2 (goal IDs are rendered inline in the memory block so no lookup is needed). v1 keeps **one active action item per goal**, so `goal_id` unambiguously identifies what's being logged; the `actionItems` table still holds the chosen action + history.

Additional tools: `complete_check_in()` (marks today done once goals are covered or the user clearly wants to move on) and `adjust_action_item(goalId, cadence?)` for "3x a week is too much, can we do 2" — renegotiation in chat is a retention saver, not a failure.

Prompting rules that matter: infer, don't interrogate ("how was the gym?" not "did you complete: Gym?"); one goal thread at a time; missing a goal gets empathy + a smaller next step, never guilt. Progress recording must be silent (no "I've logged that!") — the UI reflects it via the home screen checklist updating in realtime (client invalidates queries on tool-call events in the stream).

## Home screen

Port of `home.tsx` direction: sidekick character front and center (wearing equipped cosmetics), today's checklist (action items with state from `progressEvents`), streak flame, chat entry. The checklist updating *because of what you said in chat* is the magic moment — prioritize that polish.

## Live Activities (later, iOS)

Post-v1: a Live Activity during the evening showing today's remaining items + sidekick expression; needs a native module (`expo-live-activity` or custom widget extension). Keep behind a flag; push-based check-ins must work standalone first.

## Metrics

Check-in open rate (push→chat), completion rate, inference precision (sampled human eval of `record_progress` calls vs. conversation — target >95%; wrong logging destroys trust), D7/D30 retention by goal count, streak length distribution.

## Effort

- Schema + catalogs + home checklist: **3 days**
- Check-in cron + opener generation: **3 days**
- Chat tools + inference prompting + eval harness: **4 days**
- Weather/context enrichment + follow-up logic: **2 days**
