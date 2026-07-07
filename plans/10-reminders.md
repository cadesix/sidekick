# 10 — Reminders & Scheduled Messages

"remind me to call mom friday" — the sidekick as the friend who actually remembers. One-time and recurring reminders, created/edited/deleted conversationally through chat tools, delivered back **in the thread, in-voice**, with a push. Reminders are deliberately a separate system from check-ins (03): check-ins are the goal engine's own cadence; reminders are arbitrary user-initiated commitments. They share delivery infrastructure, nothing else.

## Data model

```ts
reminders: {
  id, userId,
  text,               // what to remind, verbatim-ish: "call mom about the flight"
  schedule jsonb,     // { type:'once', at: '2026-07-10T17:00:00' /* user-local */ }
                      // { type:'recurring', rrule: 'FREQ=WEEKLY;BYDAY=MO,WE,FR', time: '07:30' }
  timezone,           // frozen at creation from users.timezone; recomputed on tz change
  nextFireAt,         // timestamptz, precomputed — the only column the cron queries
  status /* active|paused|done|deleted */,
  createdFromMessageId, createdAt, updatedAt
}
// index: (status, nextFireAt)
```

`rrule` strings via the `rrule` npm package — battle-tested recurrence math (every weekday, first Monday monthly, every 3 days) without inventing a cadence DSL. `nextFireAt` is recomputed after every fire and on any edit; a nightly job recomputes all active reminders for users whose timezone changed. Cap: 50 active per user (the tool returns a friendly error past that).

## Chat tools

Four tools join the registry (01). Active reminders render in the memory block under a `REMINDERS (ids for reminder tools)` section — same inline-id pattern as goals, so no lookup step.

```json
{ "name": "create_reminder",
  "description": "Set a reminder when the user asks for one or clearly wants one. Resolve relative times ('friday', 'tonight') against the user's local date in your context. Confirm naturally in your reply ('got it, friday 5pm') — never robotically.",
  "parameters": { "type": "object", "properties": {
    "text": { "type": "string" },
    "schedule": { "type": "object", "description": "once: {type:'once', at:'YYYY-MM-DDTHH:mm'} local time. recurring: {type:'recurring', rrule:'FREQ=...', time:'HH:mm'}" }
  }, "required": ["text", "schedule"] } }

{ "name": "update_reminder", "parameters": { "reminder_id", "text?", "schedule?", "status?" } }
{ "name": "delete_reminder", "parameters": { "reminder_id" } }
{ "name": "list_reminders",  "parameters": {} }
```

(`update_reminder`/`delete_reminder`/`list_reminders` shown abbreviated — same JSON-schema shape.) `list_reminders` exists for "what do you have for me this week?" even though the active set is already in context — it returns fired-recently and paused ones too. Ambiguity rule in the prompt: if the time is genuinely unclear ("remind me later"), ask **one** clarifying question, then create; never create with a guessed time silently.

## Delivery

A per-minute cron (Vercel cron floor) runs `select ... where status='active' and nextFireAt <= now() limit 500`:

1. **Phrase it in-voice:** one cheap-model call — persona prompt + a trimmed memory block + the reminder text → a 1–2 sentence delivery message ("hey! you wanted me to bug you about calling your mom — flight stuff 📞"). On any LLM failure, fall back to the template `"reminder: {text}"` — a robotic reminder beats a missed one.
2. Insert as an assistant message in the main thread (it's part of the friendship, scrolls back like everything else — and the 08 tail/summary sees it, so "did you call her?" follow-through happens naturally).
3. Push notification, body = the delivery message, deep-links to chat. Reminders fire **exactly when set** — quiet-hours suppression (03's rule for sidekick-initiated pushes) does not apply to a time the user explicitly chose.
4. `once` → `status='done'`. `recurring` → recompute `nextFireAt` from the rrule.

Post-delivery conversation is where this beats a reminders app: "done" → the sidekick celebrates (and `log_checkin` if it maps to a goal); "ugh not yet, ask me in an hour" → `update_reminder` bumps it. The prompt gets one line: *after delivering a reminder, follow the user's lead — snooze, complete, or drop it without ceremony.*

## Reminders screen (view/manage)

Route: `app/reminders.tsx`, pushed from a bell row in Settings and a Caption "see all" link wherever the sidekick lists reminders. Per 06/07 conventions:

```
┌──────────────────────────────┐
│ ← Reminders                  │   Heading, back chevron 44px tap target
│                              │
│ TODAY                        │   Caption, text-ink/40, uppercase, tracking-wide
│ ┌──────────────────────────┐ │
│ │ call mom about flight    │ │   SolidShadow card, radius 16, bg-white, p-4
│ │ 5:00 PM            once  │ │   Body + Caption/60 right-aligned
│ └──────────────────────────┘ │
│ UPCOMING                     │
│ ┌──────────────────────────┐ │
│ │ take creatine            │ │
│ │ 7:30 AM · Mon Wed Fri  ⟳ │ │   recurring rows get a 14px ink repeat icon
│ └──────────────────────────┘ │
└──────────────────────────────┘
```

- Sections: TODAY / UPCOMING / PAUSED. Empty state: sidekick character small + "nothing on the books. tell me in chat and i'll remember for you" (Body, centered) — teaches the creation path.
- Swipe-left on a row → ink delete action (RN Gesture Handler `Swipeable`); haptic `impactMedium`; row animates out with Reanimated `Layout`.
- Tap a row → edit bottom sheet (06 §3 sheet): text field (field-gray input recipe), native `DateTimePicker` for time/date, a segmented once/recurring control (two ReplyChips, selected = `bg-sun`), weekday chips (7 circular 36px toggles, selected `bg-ink text-white`) shown only in recurring mode via ternary. Save = PrimaryButton pill. No delete button in the sheet — swipe owns delete.
- Data via React Query `['reminders']`, invalidated on any reminder tool-call event in the chat stream (same mechanism as the goals checklist in 03).

## Effort

- Schema + rrule/nextFireAt engine + tz recompute job: **1d**
- Four tools + prompt rules + memory-block section: **1d**
- Delivery cron + in-voice phrasing + push: **1d**
- Reminders screen + edit sheet + swipe delete: **1.5d**

Ships in **Phase 2** — reminders are a top-3 organic ask in every companion app and each delivery is a free re-engagement (a push we didn't have to invent a reason for).
