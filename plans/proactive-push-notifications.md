# Proactive Sidekick Messages & Expo Push Notifications

## Status

Proposed implementation plan for iOS-first launch. Expo Push Service is the push provider. The design keeps the provider behind an interface so Android and a future direct APNs/FCM provider do not require rewriting product logic.

## Product outcome

Sidekick can start a conversation when the user has been away long enough, at a humane and non-repetitive time. The result should feel like a friend texting, not a daily engagement campaign:

- Sidekick waits until the user has not sent a message for more than 12 hours.
- It only initiates during the user's configured awake window.
- Its delivery time varies instead of repeating at a fixed clock time.
- It backs off when the user repeatedly ignores it.
- The first notification hides the generated message and says exactly: `your sidekick sent you a message, tap to read it`.
- When one proactive turn contains multiple message bubbles, every later bubble produces its own notification with that bubble's actual text while the app is backgrounded, matching the cadence of a messaging app.
- Tapping any notification opens the main conversation at the associated message.
- Messages are always persisted before a push is attempted. Push is an alert about durable chat state, never the source of truth.

## Current-state audit

The repository already contains most of the domain pieces, but not a production push lifecycle:

- `packages/server/src/checkins/engine.ts` generates daily assistant openers, persists them, and calls the current push seam.
- `packages/server/src/reminders/engine.ts` persists reminder messages and sends pushes.
- `packages/server/src/checkins/push.ts` calls Expo's HTTP endpoint, but treats the send as fire-and-forget. It does not inspect HTTP errors, store push tickets, fetch receipts, retry transient failures, or invalidate dead tokens.
- `users.pushToken` allows only one device per user. The existing `devices` table is the correct owner for per-installation push state.
- `packages/expo` does not currently depend on or initialize `expo-notifications`.
- `packages/expo/app/_layout.tsx` has no foreground notification handler, cold-start notification response handling, or deep-link observer.
- `packages/server/vercel.json` schedules reminders and maintenance jobs, but the check-in routes are not currently registered there.
- One assistant response is currently one `messages` row. Multi-bubble proactive turns need an explicit one-to-many representation.

This feature should replace the separate push implementations with one delivery pipeline. Reminders, check-ins, and friend-like proactive messages can have different product policies while sharing tokens, outbox processing, receipts, deep links, badges, and analytics.

## Product policy

### Message classes

| Class | Trigger | Quiet hours | Attention budget | First notification body | Later bubble bodies |
|---|---|---:|---:|---|---|
| Proactive friend text | Sidekick chooses to reach out | Enforced | Counts | Generic | Actual bubble text when safe |
| Daily/goal check-in | Existing goal engine | Enforced | Counts | Generic | Actual bubble text when safe |
| Check-in follow-up | Existing follow-up engine | Enforced | Counts | Generic | Actual bubble text when safe |
| User-created reminder | User chose an exact time | Not shifted | Does not count | Actual reminder delivery | Actual bubble text |
| Operational/account | Security or account state | Policy-specific | Does not count | Explicit operational copy | N/A |

Reminders are exempt because the user explicitly requested an exact-time interruption. They still use the same delivery infrastructure and permission state.

### Consent

Notification permission and proactive-message consent are separate:

1. During onboarding, after Sidekick has demonstrated value, ask: `want me to actually text you sometimes?`
2. An affirmative answer sets `proactiveEnabled=true` and then opens the iOS permission dialog.
3. If iOS permission is denied, proactive messages may still be written into the conversation, but no push is attempted. Settings explains how to enable notifications later.
4. Settings exposes independent toggles for:
   - `Messages from Sidekick`
   - `Goal check-ins`
   - `Reminders`
5. Turning off `Messages from Sidekick` cancels scheduled friend-text runs immediately. It does not delete previously delivered messages.

Push permission cannot be required for the rest of the app to function.

### Awake window

Use an explicit user-local awake window rather than trying to infer sleep from memories or device health data.

- Default: `09:00–21:30` in `users.timezone`.
- Settings label: `Sidekick can text me between` with start and end time controls.
- Onboarding can offer `morning person`, `daytime`, and `night owl` presets, but always stores concrete wall-clock values.
- Support windows crossing midnight, such as `16:00–02:00`, for shift workers.
- A timezone change recomputes the next scheduled proactive send using the new local wall clock.
- DST conversion reuses the repository's existing wall-clock scheduling utilities.

### Eligibility

A proactive friend text is eligible only when all conditions are true at dispatch time:

1. Onboarding is complete.
2. `proactiveEnabled=true`.
3. At least one active device has authorized or provisionally authorized notifications, or product policy permits creating in-app-only proactive messages.
4. The latest user-authored message in the main conversation is older than 12 hours.
5. Local time is inside the awake window.
6. There is no already-scheduled or delivered proactive turn for the same idempotency slot.
7. No user-authored message arrived after the run was scheduled.
8. The global attention budget permits another unsolicited turn.
9. No reminder, check-in, or other proactive notification was sent inside the collision window.
10. The account is not deleted, suspended, or in onboarding.

The 12-hour rule is based on the latest `role='user'` message, not the latest assistant message. Assistant-generated messages must never keep resetting eligibility.

### Randomized scheduling

Do not run an hourly query and send immediately when a user crosses 12 hours; that would create a recognizable pattern. Store a stable randomized time, then recheck eligibility at dispatch.

For each candidate:

1. Compute `eligibleAt = lastUserMessageAt + 12 hours`.
2. Find the first awake window whose end is after `eligibleAt`.
3. Compute `windowStart = max(eligibleAt, awakeWindow.start)`.
4. Choose a uniformly random minute in `[windowStart, awakeWindow.end]`.
5. If the candidate is within 60 minutes of either of the previous two proactive local delivery times, redraw up to five times.
6. Store the chosen UTC instant in `proactive_runs.scheduledFor`; never recalculate it on each cron tick.
7. If the remaining awake window is less than 30 minutes, schedule inside the next awake window instead of texting at the edge of bedtime.

Randomness chooses timing, not whether safety and attention rules apply. Tests inject the random-number source and clock.

### Attention budget and backoff

Defaults should be feature-flagged so they can be tuned without a release:

- At most one unsolicited turn per rolling 24 hours.
- At most three unsolicited turns per rolling seven days.
- A reminder does not consume this budget.
- A check-in, check-in follow-up, and friend text all consume the same budget.
- Do not deliver a friend text within two hours of a check-in or non-reminder push. Prefer the already scheduled check-in and cancel the friend-text run for that awake window.
- After one ignored unsolicited turn, wait at least 36 hours before another.
- After two consecutive ignored turns, wait at least 72 hours.
- After three consecutive ignored turns, pause unsolicited pushes for seven days.
- Any new user-authored message resets the ignored count.
- Opening a proactive notification records engagement but does not reset the ignored count until the user actually sends a message.

An ignored turn means no later user message exists within 24 hours of its final bubble. This definition is evaluated asynchronously and does not depend on push delivery being provable.

### Content policy

The generation prompt produces one coherent thought split into one to three short bubbles:

- One bubble is preferred; two or three are allowed only when the voice naturally calls for it.
- Each bubble should be at most 180 characters.
- Do not manufacture urgency.
- Do not guilt the user for being absent or mention the 12-hour threshold.
- Do not ask generic engagement-bait questions when there is no meaningful context.
- Prefer a fresh event, an unfinished conversational thread, something timely about an interest, or a lightweight affectionate check-in.
- Never initiate from health metrics, Screen Time data, emotional inferences, advertising state, or sensitive relationship details.
- Do not include ads in a proactive turn.
- Avoid repeating the topic or opening shape of the last five proactive turns.
- Generation failure creates no proactive message. Unlike an explicit reminder, there is no need for a robotic fallback.

The model returns structured output containing `bubbles`, not delimiter-parsed prose. All bubbles are generated and persisted in one transaction before any notification is queued.

### Notification copy

For a proactive/check-in turn containing one bubble:

```text
Title: <sidekickName>
Body: your sidekick sent you a message, tap to read it
```

For a turn containing multiple bubbles:

```text
Notification 1
Title: <sidekickName>
Body: your sidekick sent you a message, tap to read it

Notification 2+
Title: <sidekickName>
Body: <exact persisted bubble text>
```

Every bubble after the first gets a separate push and a unique notification identifier. Do not use Expo `collapseId`: on iOS it coalesces notifications in transit and replaces an already displayed notification, which would destroy the desired stacked-message behavior.

Actual-text follow-ups are allowed only when the persisted message is notification-safe. If a deterministic sensitive-content rule flags names of third parties, health, location detail, financial distress, sexual content, or other confidential information, use the same generic body for that bubble. Apple advises against putting sensitive, personal, or confidential information in notification content. This privacy fallback wins over the exact-text behavior.

### Foreground, background, and terminated behavior

The server does not need to know whether the app is backgrounded. The OS and client handler determine presentation:

- Foreground with chat visible: suppress banner, sound, and Notification Center insertion; invalidate the transcript query so new bubbles appear in place.
- Foreground elsewhere in the app: suppress the system banner and show a subtle in-app unread indicator; transcript data is invalidated.
- Background or terminated: iOS presents every push as a separate notification.
- Tapping any notification opens the main chat and targets that notification's `messageId`.
- Cold start reads the last notification response before normal navigation settles, preventing the tap from being lost.
- Opening the conversation clears its delivered notifications and resets its unread badge.

### Notification grouping

All bubbles in the main Sidekick conversation must share one iOS `threadIdentifier`, derived from a stable opaque conversation identifier. Each notification remains unique; threading groups them visually rather than replacing them.

Expo Push Service currently exposes `collapseId` but does not expose APNs `thread-id` in its send payload. Keep Expo as the transport and add an iOS Notification Service Extension:

1. Send `mutableContent: true` and `data.notificationThreadId` with each relevant push.
2. The extension copies the request content to `UNMutableNotificationContent`.
3. It validates that the provided thread ID has the expected opaque format.
4. It assigns `content.threadIdentifier` and immediately calls the completion handler.
5. `serviceExtensionTimeWillExpire` returns the best available content so the notification is never lost.

No network request is needed inside the extension. If the extension fails, iOS displays the original notification, so delivery degrades to unthreaded rather than disappearing.

Communication Notifications with SiriKit avatars are out of scope for v1. The desired value is individual stacked messages, not impersonating the system Messages app.

## Technical architecture

```text
User message / scheduled sweep
            │
            ▼
 Proactivity scheduler ── stores a randomized proactive_run
            │
            ▼ at scheduledFor
 Eligibility recheck ── cancelled if user returned or budget changed
            │
            ▼
 Proactive generator ── structured 1–3 bubbles
            │
            ▼ one transaction
 messages + proactive_turn + notification_outbox rows
            │
            ▼
 Push worker ── Expo Push Service ── APNs
            │                         │
            │                         ▼
            │             Notification Service Extension
            │                         │
            ▼                         ▼
 ticket/receipt worker          iOS presentation
```

### Database changes

#### Remove the single-token model

Deprecate `users.pushToken`. Keep it for one migration window, backfill valid values into the new table when the owning device can be identified, then remove it.

Add `device_push_tokens`:

```sql
create table device_push_tokens (
  id uuid primary key,
  device_id uuid not null references devices(id),
  user_id uuid not null references users(id),
  provider text not null default 'expo',
  expo_token text not null unique,
  native_token text,
  platform text not null,
  project_id text not null,
  permission_status text not null,
  status text not null default 'active',
  last_registered_at timestamptz not null,
  last_seen_at timestamptz not null,
  invalidated_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index device_push_tokens_user_status_idx
  on device_push_tokens (user_id, status);
```

`user_id` is duplicated intentionally so account reattachment and fan-out are simple, but registration must verify that `device_id` belongs to the authenticated user.

Add `notification_preferences`:

```sql
create table notification_preferences (
  user_id uuid primary key references users(id),
  proactive_enabled boolean not null default false,
  checkins_enabled boolean not null default true,
  reminders_enabled boolean not null default true,
  awake_start text not null default '09:00',
  awake_end text not null default '21:30',
  next_proactive_at timestamptz,
  consecutive_ignored integer not null default 0,
  proactive_paused_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

Add denormalized conversation activity columns:

```sql
alter table conversations add column last_user_message_at timestamptz;
alter table conversations add column last_assistant_message_at timestamptz;
```

Backfill these once from `messages`; update them in every server-controlled message insert path. Centralize message persistence so chat, reminders, check-ins, and proactive generation cannot forget the activity columns.

Add `proactive_turns`:

```sql
create table proactive_turns (
  id uuid primary key,
  user_id uuid not null references users(id),
  conversation_id uuid not null references conversations(id),
  kind text not null,
  local_slot_date date not null,
  scheduled_for timestamptz not null,
  eligibility_user_message_at timestamptz not null,
  status text not null,
  cancellation_reason text,
  prompt_version text,
  model text,
  opened_at timestamptz,
  replied_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index proactive_turns_user_slot_kind_idx
  on proactive_turns (user_id, local_slot_date, kind);

create index proactive_turns_status_scheduled_idx
  on proactive_turns (status, scheduled_for);
```

Add nullable linkage to `messages`:

```sql
alter table messages add column proactive_turn_id uuid references proactive_turns(id);
alter table messages add column proactive_sequence integer;
```

The pair `(proactive_turn_id, proactive_sequence)` is unique when non-null. Sequence starts at zero and determines generic-first versus actual-text notification behavior.

Add `notification_outbox`:

```sql
create table notification_outbox (
  id uuid primary key,
  user_id uuid not null references users(id),
  device_push_token_id uuid not null references device_push_tokens(id),
  message_id bigint references messages(id),
  kind text not null,
  title text not null,
  body text not null,
  data jsonb not null,
  available_at timestamptz not null,
  expires_at timestamptz,
  status text not null default 'pending',
  attempts integer not null default 0,
  expo_ticket_id text,
  last_error text,
  sent_at timestamptz,
  receipt_checked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index notification_outbox_token_message_kind_idx
  on notification_outbox (device_push_token_id, message_id, kind);

create index notification_outbox_status_available_idx
  on notification_outbox (status, available_at);
```

The outbox fans one logical notification out to every active device. Its unique index makes retries and concurrent workers idempotent.

Add `notification_events` for product analytics without storing notification bodies:

```sql
create table notification_events (
  id uuid primary key,
  outbox_id uuid references notification_outbox(id),
  user_id uuid not null references users(id),
  device_id uuid references devices(id),
  event text not null,
  occurred_at timestamptz not null default now(),
  metadata jsonb not null default '{}'
);
```

Events include `scheduled`, `cancelled`, `generated`, `ticketed`, `provider_accepted`, `provider_rejected`, `opened`, and `replied`. Do not send raw message text to analytics.

### Server modules

Create a cohesive notification feature rather than extending `checkins/push.ts`:

```text
packages/server/src/notifications/
  provider.ts          PushProvider contract and payload types
  expo-provider.ts     expo-server-sdk-node adapter
  register.ts          per-device registration and invalidation
  outbox.ts            enqueue, claim, retry, and expiry logic
  receipts.ts          ticket receipt polling and token invalidation
  policy.ts            quiet hours, budgets, collisions, privacy bodies
  cron.ts              authenticated worker routes

packages/server/src/proactivity/
  scheduler.ts         candidate discovery and randomized scheduling
  eligibility.ts       authoritative dispatch-time policy
  generator.ts         structured LLM generation
  delivery.ts          transactional persistence and outbox fan-out
  prompt.ts            voice and safety prompt
  cron.ts              schedule and dispatch routes
```

`PushProvider` should accept provider-neutral notification data and return per-recipient ticket outcomes. Product code must never import Expo SDK types.

Use `expo-server-sdk-node` for token validation, chunks of at most 100 messages, compression, connection limiting, and rate smoothing. Enable Expo enhanced push security and provide `EXPO_ACCESS_TOKEN` in production.

### API surface

Add protected procedures:

- `notifications.registerDeviceToken`
  - Input: Expo token, optional native token, platform, project ID, permission status.
  - Authenticated device ID comes from the request header, not caller-controlled user data.
  - Upserts the current device token and invalidates a replaced token for the same installation/project.
- `notifications.unregisterDeviceToken`
  - Marks the current installation's token disabled on logout or explicit notification opt-out.
- `notifications.preferences`
  - Returns proactive/check-in/reminder toggles and awake window.
- `notifications.updatePreferences`
  - Validates wall-clock values and reschedules/cancels `nextProactiveAt`.
- `notifications.opened`
  - Records notification ID, message ID, and device ID idempotently.
- `notifications.appActive`
  - Best-effort last-foreground timestamp for analytics and short collision suppression, not as a requirement for correctness.

Remove `pushToken` from onboarding completion input. Permission/token registration is an installation concern and must not be coupled to the one-time profile transaction.

### Scheduling jobs

Use two proactivity jobs:

1. `schedule`: runs every 15 minutes, finds users without a valid future `nextProactiveAt`, and stores randomized runs in bounded batches.
2. `dispatch`: runs every minute, claims due runs with `status='scheduled' AND scheduled_for <= now()`, rechecks every eligibility condition, then generates and persists bubbles.

Use claim-first guarded updates or `FOR UPDATE SKIP LOCKED` so overlapping Vercel invocations cannot generate duplicate turns. A failed generation marks the run `failed` and does not retry until the next awake window unless the error is clearly transient.

Use two notification jobs:

1. `send`: runs every minute and drains due outbox rows in bounded chunks. Retry network errors, HTTP 429, and HTTP 5xx with exponential backoff. Do not retry invalid payloads.
2. `receipts`: runs every 15 minutes for ticketed rows old enough to have receipts. `DeviceNotRegistered` invalidates that token. Expire receipt lookups before Expo's 24-hour receipt retention window.

Suggested Vercel cron entries:

```json
{ "path": "/cron/proactivity/schedule", "schedule": "*/15 * * * *" }
{ "path": "/cron/proactivity/dispatch", "schedule": "* * * * *" }
{ "path": "/cron/notifications/send", "schedule": "* * * * *" }
{ "path": "/cron/notifications/receipts", "schedule": "*/15 * * * *" }
```

At larger scale, the database outbox can move behind a queue without changing policy or provider interfaces.

### Push payload

Each bubble's payload contains identifiers, not hidden conversation content:

```json
{
  "to": "ExponentPushToken[...]",
  "title": "Milo",
  "body": "your sidekick sent you a message, tap to read it",
  "sound": "default",
  "priority": "high",
  "interruptionLevel": "active",
  "mutableContent": true,
  "ttl": 21600,
  "badge": 2,
  "data": {
    "notificationId": "uuid",
    "type": "proactive-message",
    "conversationId": "uuid",
    "messageId": 1234,
    "proactiveTurnId": "uuid",
    "sequence": 0,
    "notificationThreadId": "opaque-stable-id",
    "url": "/chat?messageId=1234"
  }
}
```

- Use `interruptionLevel='active'`, never `time-sensitive` or `critical`, for friend texts.
- Use a six-hour TTL for proactive friend texts so stale messages are not surfaced the next morning.
- Do not set `collapseId` for conversation bubbles.
- Badge equals the server's unread assistant-message count. Opening the main conversation marks through the latest visible message as read and clears the badge.
- Keep the payload well below APNs' 4 KiB limit.

### Expo app integration

Install the SDK-54-compatible `expo-notifications` version using `npx expo install expo-notifications`, add its config plugin, rebuild the dev client, and configure EAS/APNs credentials.

Add a notifications module:

```text
packages/expo/src/lib/notifications/
  permissions.ts       permission and contextual request flow
  registration.ts      Expo token acquisition, rotation listener, API sync
  observer.ts           foreground receipt and tap routing
  presented.ts          conversation notification cleanup
  payload.ts            strict runtime payload parsing
```

Registration lifecycle:

1. Read current permissions without prompting.
2. Prompt only after the in-product consent step.
3. Obtain the Expo token with the EAS `projectId` already present in `app.json`.
4. Upsert the token against the authenticated `deviceId`.
5. Subscribe to push-token rotation and immediately register the replacement.
6. Retry token acquisition on a later foreground when the device was offline.
7. On sign-out or account switching, disable the old device/user binding before attaching the token to the new account.

Notification observer lifecycle:

- Register the handler and response observer as early as possible in the root layout.
- Check the initial notification response for terminated-app launches.
- Validate payload fields before navigation; ignore unknown or malformed URLs.
- On foreground receipt, invalidate `['chat', 'transcript', conversationId]`.
- Do not show a system banner while foregrounded.
- On tap, record `opened`, open the existing chat presentation, and target `messageId` after transcript data loads.
- On chat open, call `getPresentedNotificationsAsync`, filter by `conversationId`, dismiss each matching notification, and clear the app badge.

The notification listeners are a justified lifecycle effect because they subscribe to native external events; they must return and remove their subscriptions cleanly.

### Notification Service Extension

Add an iOS target under `packages/expo/targets/NotificationService` using the same EAS app-extension pattern already used by the repository's Screen Time extensions.

The Swift extension should:

- Subclass `UNNotificationServiceExtension`.
- Copy `request.content` into mutable content.
- Read `notificationThreadId` from `userInfo`.
- Set `threadIdentifier` only after validating length and allowed characters.
- Call the completion handler immediately.
- Return the best attempt from `serviceExtensionTimeWillExpire`.
- Never log titles, bodies, user IDs, or message IDs.
- Perform no network access and share no secrets.

Use one stable thread for the main conversation. If Sidekick later supports multiple conversations, use one opaque thread per conversation.

### Multi-bubble delivery

Persist and enqueue every bubble in one transaction. Set all outbox rows available immediately; Expo/APNs delivery order is generally expected but not guaranteed, so correctness must not depend on order.

To make the UI deterministic:

- `proactive_sequence` controls transcript ordering after timestamp ties.
- Chat history orders by monotonic `messages.id`.
- Notification bodies stand alone if APNs presents a later bubble first.
- Do not use server sleeps or `setTimeout` to simulate typing delays.

If product later requires visible seconds-long spacing between bubbles, add delayed `availableAt` values and a sub-minute queue worker. Vercel's minute cron is not precise enough for that behavior, so it is explicitly out of scope for v1.

## Reliability and failure behavior

- Push delivery is best-effort. A provider receipt confirms APNs accepted the notification, not that the phone displayed it.
- Persist chat messages and outbox rows atomically. A database rollback means neither exists.
- Claim outbox rows before network sends and use unique recipient/message keys. At-least-once worker execution must not create duplicate logical rows.
- A crash after Expo accepts a push but before the ticket is stored can still cause a duplicate retry. Store a sending lease and keep this narrow; Expo does not offer end-to-end idempotency keys.
- Retry transient provider failures with bounded exponential backoff and jitter.
- Mark malformed payloads permanently failed.
- Mark `DeviceNotRegistered` tokens invalid and stop sending until the app registers a new token.
- A user message arriving during generation must cause a final pre-commit eligibility check; cancel rather than inserting an awkward opener into an active conversation.
- A timezone or awake-window update cancels future scheduled runs and computes a new stored time.
- Disabled notifications stop new outbox fan-out; existing unsent rows for that device are cancelled.
- If the Notification Service Extension fails, original notification content still displays without explicit thread grouping.

## Privacy and security

- Enable Expo enhanced push security so possession of an Expo token alone cannot authorize a send.
- Store Expo access credentials server-side only.
- Treat push tokens as credentials: never log them, expose them through `users.me`, or send them to analytics.
- Never include memory blocks, hidden prompts, or full conversation context in push `data`.
- The first proactive bubble is always generic.
- Later actual-text notifications pass the notification-safety policy; flagged messages fall back to generic copy.
- Device and user ownership is verified on every token mutation.
- Account deletion invalidates tokens, cancels scheduled runs/outbox rows, and deletes notification preference/event data according to retention policy.
- Analytics stores message identifiers and categories, not notification bodies.

## Metrics

Track these server-side funnels by message class and experiment variant:

- Eligible users
- Scheduled runs
- Cancellation reason distribution
- Generated turns and bubble count
- Outbox success/error rate
- APNs acceptance rate from Expo receipts
- `DeviceNotRegistered` rate
- Notification opens within 1 hour, 6 hours, and 24 hours
- User reply within 1 hour, 6 hours, and 24 hours
- Consecutive ignored distribution
- Notification opt-in and opt-out rate
- App-level notification disable detection rate
- Seven-day retention split by proactive enabled/disabled

Do not optimize for opens alone. The primary quality metric is meaningful replies without increased notification opt-outs. Guardrails are opt-out rate, ignored streaks, and reports/negative feedback.

## Testing strategy

### Pure policy tests

- Exactly 12 hours is not eligible; greater than 12 hours is eligible.
- Latest assistant message does not reset the clock.
- Latest user message does reset the clock.
- Awake windows work in normal and overnight forms.
- DST gaps and repeated hours produce valid UTC schedules.
- Random time stays inside the window and avoids recent local send times when possible.
- A nearly closed awake window rolls to the next window.
- Attention caps, collision windows, and backoff rules compose correctly.
- Reminders bypass quiet hours and unsolicited budgets.
- Check-ins consume the shared unsolicited budget.
- Sensitive follow-up content falls back to generic copy.
- First bubble is always generic; later safe bubbles use exact text.

### Database/integration tests

- Concurrent scheduler runs create one proactive slot.
- Concurrent dispatch runs generate one proactive turn.
- A user message arriving before dispatch cancels the run.
- A user message arriving during generation prevents commit.
- One turn with three bubbles creates three ordered messages and one outbox row per active device per bubble.
- Multiple devices receive independent outbox rows.
- Disabled/invalid devices receive none.
- Push registration cannot attach a token to another user's device.
- Ticket errors, receipt errors, retryable failures, and expiry produce the correct state transitions.
- `DeviceNotRegistered` invalidates only the affected token.
- Opening a notification records one idempotent event.

Use a local fake `PushProvider` at the interface boundary; do not mock domain/database behavior. Run database tests against the existing test Postgres setup.

### Prompt/eval tests

- Structured output always contains one to three non-empty bubbles.
- Bubbles meet length limits.
- No guilt, invented urgency, or mention of inactivity duration.
- No sensitive source categories.
- No duplicate topic/opening against recent proactive history.
- Output feels coherent when bubbles are read separately.
- Each later bubble is safe enough to appear independently on a lock screen.

### Device QA

Test on a physical iPhone with a development build and production-like EAS credentials:

- Permission granted, denied, provisional, and later changed in Settings.
- Foreground chat, foreground elsewhere, background, terminated, and cold-start tap.
- One-, two-, and three-bubble turns.
- Notifications remain distinct and group under one conversation thread.
- No notification is replaced by a later bubble.
- Generic first body and exact later bodies render correctly.
- Sensitive fallback stays generic.
- Tap opens the correct message.
- Opening chat clears grouped notifications and badge.
- Focus modes, Scheduled Summary, notification previews disabled, and device lock.
- Token rotation, reinstall, logout, account switch, and two-device accounts.
- Notification Service Extension failure fallback.

## Rollout

### Phase 1: delivery foundation

1. Add `expo-notifications`, EAS/APNs credentials, permission flow, and device token registration.
2. Add per-device token schema and remove token handling from onboarding.
3. Build provider-neutral outbox, Expo adapter, ticket persistence, receipt worker, and invalid-token handling.
4. Add tap routing, foreground transcript invalidation, badge/read state, and notification cleanup.
5. Migrate reminders and existing check-ins onto the shared pipeline.
6. Ship internally with a developer-only test-push screen.

### Phase 2: proactive friend texts

1. Add preferences, awake-window UI, conversation activity columns, and scheduling tables.
2. Build randomized scheduler, dispatch-time policy, shared attention budget, and backoff.
3. Build structured proactive generation and evals.
4. Persist multi-bubble turns and fan out notification rows.
5. Add the generic-first/actual-follow-up body policy.
6. Roll out to staff/TestFlight behind a user cohort flag.

### Phase 3: iMessage-like notification polish

1. Add the Notification Service Extension and stable thread grouping.
2. Verify grouping, clearing, badges, and failure fallback across current supported iOS versions.
3. Add notification analytics dashboards and opt-out guardrail alerts.
4. Run controlled timing/cadence experiments, changing one variable at a time.

Suggested effort: 6–9 engineering days for the delivery foundation, 5–7 days for proactivity and product controls, and 2–3 days for the iOS extension/device hardening. Device QA and EAS credential debugging are included because push work is not complete when it passes unit tests.

## Launch defaults

- Provider: Expo Push Service
- Awake window: `09:00–21:30` local
- Eligibility: more than 12 hours since latest user-authored message
- Unsolicited cap: one per 24 hours, three per seven days
- Collision suppression: two hours around another unsolicited push
- Ignored backoff: 36 hours, 72 hours, then seven days
- Bubble count: one preferred, maximum three
- First notification: generic exact copy
- Later notifications: exact bubble text when notification-safe, otherwise generic
- Interruption level: active
- Proactive TTL: six hours
- Collapse ID: omitted
- Notification thread: one stable opaque ID for the main conversation
- Foreground banners: suppressed
- Ads: never included

## Acceptance criteria

The feature is ready when:

- A user cannot receive a proactive friend text until more than 12 hours after their last sent message.
- Every proactive delivery occurs inside the stored awake window in the user's current timezone.
- Scheduled times demonstrably vary and remain stable across repeated cron runs.
- Budgets, collisions, backoff, opt-out, and idempotency prevent spam and duplicates.
- The first proactive notification always uses the exact generic copy.
- A multi-bubble proactive turn creates distinct notifications for later bubbles using their safe persisted text.
- Backgrounded/terminated iOS devices retain separate notifications grouped as one Sidekick conversation.
- Foreground use updates chat without presenting redundant system banners.
- Taps work from foreground, background, and terminated states.
- Messages remain available even when push delivery fails.
- Multiple devices, token rotation, invalid tokens, tickets, receipts, and retries work end to end.
- Reminder timing remains exact and existing check-in behavior is migrated without double notifications.
- All policy, integration, prompt/eval, lint, typecheck, and physical-device QA checks pass.

## Sources

- [Expo SDK 54 Notifications API](https://docs.expo.dev/versions/v54.0.0/sdk/notifications/): permissions, Expo token acquisition, push-token rotation, foreground handlers, notification responses, deep linking, presented-notification cleanup, and thread identifiers on received content.
- [Expo Push Service sending guide](https://docs.expo.dev/push-notifications/sending-notifications/): batching, 600 notifications/second limit, retries, tickets, receipts, invalid-token handling, payload limits, interruption levels, `mutableContent`, and `collapseId` replacement behavior.
- [Expo notification behavior guide](https://docs.expo.dev/push-notifications/what-you-need-to-know/): foreground/background/terminated presentation and preference for regular alert notifications when background execution is unnecessary.
- [Apple notification permission guidance](https://developer.apple.com/documentation/usernotifications/asking-permission-to-use-notifications): contextual authorization, provisional authorization, and current-settings checks.
- [Apple notification design guidance](https://developer.apple.com/design/human-interface-guidelines/notifications/): consent, foreground handling, avoiding repeated notifications, badges, and avoiding sensitive notification content.
- [Apple notification thread identifiers](https://developer.apple.com/documentation/usernotifications/unmutablenotificationcontent/threadidentifier): grouping related notifications with a shared thread identifier.
- [Apple Notification Service Extension](https://developer.apple.com/documentation/usernotifications/unnotificationserviceextension): modifying alert notification content before delivery and required timeout fallback behavior.
- [Apple App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/): push notifications must not be required for app functionality and must not contain sensitive or confidential information.
