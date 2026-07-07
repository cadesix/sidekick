# 13 — Focus Mode: App Blocking, Budgets & Negotiated Unlocks

03's screen-time section built the *passive* tier: threshold events telling the sidekick whether you kept your budget. Focus mode is the *active* tier — Daimon parity: **setup, edit blocked apps, set a daily budget, force block, temporary unlock, disable** — where the OS actually shields the apps and, crucially, **your sidekick is the face of the shield**. The product frame stays the one from 03: this is the user's own commitment that the OS enforces and the sidekick mediates — we never see which apps they picked (opaque tokens) or what they browse.

Same foundation as 03: `react-native-device-activity`, Family Controls (Distribution) entitlement — **4 approval forms** (main app + the 3 generated extension targets: ActivityMonitorExtension, ShieldConfiguration, ShieldAction), filed day one; config plugin with `appleTeamId` + `appGroup` (the App Group's shared UserDefaults is the JS↔extension bridge); iOS deployment target 15.1+; dev-client builds. Android deferred (`UsageStatsManager` has no shield equivalent worth faking).

## State model

Selections and shields live **on-device** (App Group) — tokens are meaningless off-device. The server keeps a mirror with zero app identity, just enough for the sidekick's context and cross-device sanity:

```ts
focusSettings: {   // server mirror — NO app names, ever (we can't know them anyway)
  userId, enabled boolean,
  budgetMinutes int nullable,          // null = block-on-demand only, no daily budget
  selectionCount int,                  // "7 apps" — the only identity-shaped thing available
  updatedAt
}
// device-side (App Group): activitySelectionId 'focus', shield config, monitor schedules
```

Daily kept/blew outcomes keep flowing exactly as 03 specced (`progressEvents`, `source:'device'`) — focus mode adds enforcement on top of the same events.

## Mechanics (module calls, exact)

- **Budget enforcement (works with the app killed):** `startMonitoring('focus-daily', { intervalStart: 00:00, intervalEnd: 23:59, repeats: true }, events)` with two events on the `focus` selection: `warn` at `{ minute: budget * 0.8 }` (action: local notification — "you're at 80% of your {budget} min") and `limit` at `{ minute: budget }` with `actions: [{ type: 'blockSelection', familyActivitySelectionId: 'focus', shieldId: 'sidekick' }]`. The block fires **natively in the monitor extension** — no JS required. `intervalDidStart` (midnight) carries the `unblockSelection` action so every day starts fresh.
- **Force block:** `ReactNativeDeviceActivity.blockSelection({ activitySelectionId: 'focus' })` from JS.
- **Unblock:** `unblockSelection(...)`; temporary unlock = unblock + a one-off monitor over `[now, now + N min]` whose `intervalDidEnd` action is `blockSelection` — the re-block happens natively even if the user never returns to our app.
- **Max 20 concurrent monitors** platform-wide: we use at most 3 (daily, one-off re-block, 03's passive threshold) — fine, but assert in code.

## The shield is a sidekick moment

`updateShield(config, actions)` before any shield can appear (extensions read it from the App Group):

- Config: `title: "hey. it's {sidekickName}."`, `subtitle` = one in-voice line from a rotation of ~12 written lines ("you said {budget} minutes. i counted." / "the scroll can wait. your thing can't." / "day {streak} of us. don't make it weird.") — **refreshed once daily** by the app on foreground/check-in (the shield is static between refreshes; it cannot call the LLM). `backgroundBlurStyle: "systemThickMaterialDark"`, `titleColor` white, `primaryButtonBackgroundColor` sun `#F2C94C` with ink label, `iconSystemName: "moon.stars.fill"` (SF Symbols only — our character PNG can't render here; accepted limitation).
- Buttons: **primary "ok, closing"** → `{ type: 'dismiss', behavior: 'close' }`. **Secondary "let me ask {sidekickName}"** → `{ type: 'dismiss', behavior: 'close' }` paired with a local notification (fired via the ShieldAction extension writing an App-Group flag the notification schedules from) that deep-links into chat: *"heard you knocking 👀 what's up?"*. The shield **cannot open our app directly** (iOS rule) and we deliberately don't put raw unblock on the shield — **the negotiation happens in chat**, which is the entire product: "i need 10 min to reply to my group chat" → the sidekick judges vibe, calls `focus_unblock(10)`, and follows up when the re-block lands. Friction with personality instead of a bypass button.

## Chat tools

All are **device-tools** (the `execution:'client'` pattern from [12-life-integrations.md](12-life-integrations.md) — the module calls must run on-device; the user is mid-chat so the app is alive). Server updates `focusSettings` on acked results.

- `focus_open_setup()` — navigates the app to the setup screen (picker can't be driven by the model; it's a native system view).
- `focus_set_budget(minutes)` — reconfigures the daily monitor. Prompt rule: confirm the number back casually; budgets under 15 min get one reality-check ("bold. sure?").
- `focus_block_now()` — force block ("lock me out, i'm studying"). Sidekick's reply sets the re-see-you ("locked. crush it — i'll be here").
- `focus_unblock(minutes)` — temporary unlock, 5–60 clamp; the one-off re-block monitor is created in the same client execution. Prompt guidance: grant freely the first ask of the day, get playfully skeptical after ("third time today… is the group chat *that* good?"), never lecture, never refuse outright more than once.
- `focus_status()` — reads `focusSettings` + today's warn/limit events for "how am i doing today?"
- `focus_disable()` — one in-voice "you set this up for a reason — sure?" then comply immediately and fully. Never hold the user hostage; that's an uninstall, and it's wrong.

## Setup screen (UI spec)

Route `app/focus-setup.tsx` (extends 07's screen-time-setup), reached from goal adoption (doomscroll goals), `focus_open_setup`, and Settings:

```
┌──────────────────────────────┐
│ ← Focus                      │
│ pick what i guard            │   Heading 27
│ i can't see what you choose  │   Body text-ink/60 — the privacy line, always visible
│ — apple only tells me time.  │
│ ┌──────────────────────────┐ │
│ │  [DeviceActivitySelection │ │   native picker embedded in a SolidShadow card,
│ │        View]              │ │   radius 16, min-height 320
│ └──────────────────────────┘ │
│ DAILY BUDGET                 │   Caption uppercase ink/40
│ (15m)(30m)(45m)(1h)(custom)  │   ReplyChips, selected bg-sun; custom → native picker
│ ┌──────────────────────────┐ │
│ │ shield preview            │ │   static mock of the shield (dark card, title/
│ │ "hey. it's momo."         │ │   subtitle/buttons in shield colors) — show them
│ └──────────────────────────┘ │   exactly what interruption they're signing up for
│ [        start guarding     ]│   PrimaryButton pill; disabled until selection non-empty
└──────────────────────────────┘
```

Editing later reuses the same screen with current state loaded; "Turn off" lives at the bottom as flame-text (same copy path as `focus_disable`). Home (07 §1): active-budget days show a small shield StreakPill-style chip on the relevant goal row — `🛡 under budget` / `🛡 blocked` states.

## Metrics & risks

Metrics: budget-kept rate, unlock-negotiations per day (rising trend = budget set wrong — sidekick suggests adjusting, which is 03's renegotiation-as-retention play), disable rate within 7 days, D30 retention of focus users vs. not (this feature should be a retention monster; verify).

Risks: entitlement approval is the schedule (weeks — filed at project start per 03); shield config is static between refreshes (mitigated by daily line rotation); users can delete the app to escape blocks (fine — the commitment framing means we never pretend to be uncircumventable).

## Effort

- Monitors + block/unblock + one-off re-block composition: **2d**
- Shield config + line rotation + ShieldAction → notification deep-link: **1.5d**
- Six device-tools + prompt guidance + `focusSettings` mirror: **1.5d**
- Setup screen + shield preview + home chip: **1.5d**

Ships in **Phase 4** with 03's Tier-4 (same entitlement gate), behind a capability check; self-report fallback keeps the goals alive everywhere else.
