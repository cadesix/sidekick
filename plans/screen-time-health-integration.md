# Screen Time + Apple Health integration plan

Date: 2026-07-14

Implementation status: built on 2026-07-14. The application, server, database migration, agent tools, privacy controls, tests, and native iOS extensions are implemented. Simulator QA reached Apple's Screen Time authorization flow. Final enforcement and real HealthKit sample validation remain a signed physical-iPhone release check because those system capabilities are not testable end to end in Simulator.

This plan supersedes the privacy and data-flow assumptions in `13-focus-mode.md` and the Apple Health consent language in `12-life-integrations.md`. The repo already contains partial implementations of both features; this document defines what is safe to ship and the work needed to align them with Apple's current rules.

## Product decisions

### Screen Time

Ship Focus as a free, device-local control feature. Sidekick can help the user configure a daily allowance, block now, temporarily unlock, and turn Focus off. Apple keeps app selections and Screen Time usage on the iPhone.

The cloud agent may send control commands that the user requested, but it must not receive Screen Time-derived data. In particular, do not send selected apps, selected-item counts, app/category/domain identities, usage minutes, pickups, notification counts, threshold events, under-budget outcomes, shield state, or authorization state to the server or model. Aggregating or removing app names does not make Screen Time usage exportable.

The agent can know values that came directly from the user or the agent itself, such as “set my limit to 30 minutes,” and can acknowledge whether a requested device command succeeded. It must not claim it can see how the user is doing.

Do not put Focus behind a paywall or sell it as a premium capability. App Review Guideline 4.10 explicitly prohibits monetizing Screen Time APIs.

### Apple Health

Ship Health as an optional, read-only agent context connection. Start with four useful, understandable groups:

- steps
- sleep duration and sleep window
- workouts: type, start time, and duration
- active energy

Do not request heart rate or resting heart rate in v1. They add sensitivity without enough Sidekick value yet and can be added later through a separate, contextual permission request.

With explicit consent, Sidekick may upload minimized daily aggregates for health-management and goal-support features. The consent must say that the data is stored by Sidekick and shared with Sidekick's AI provider to personalize the user's coaching. Health data and health-derived messages must never enter advertising, ad measurement, general profiling, or third-party analytics.

Keep a rolling 30-day server window. Do not upload raw HealthKit samples, source device identifiers, sample UUIDs, or unnecessary metadata. The Health app remains the source of truth.

## What the references contribute

The five reference screens establish a useful product sequence:

1. one discoverable capability in Settings
2. a benefit-and-privacy explanation before system permission
3. Apple's picker for apps, categories, and websites
4. a dedicated allowance step
5. a simple active-state screen with editing and disable actions

Reference mapping:

| Screenshot | Useful pattern | Sidekick adaptation |
| --- | --- | --- |
| `Screenshot 2026-07-14 at 09.43.27.png` | Capability discovery in Settings | Add Focus and Apple Health to the existing Connected group with native disclosure rows |
| `Screenshot 2026-07-14 at 09.48.42.png` | Explain benefit, privacy, reversibility before permission | Use a concise Sidekick introduction with accurate local-data copy and no competitor artwork |
| `Screenshot 2026-07-14 at 09.49.01.png` | Let Apple own app, category, site, and search selection | Present the native Family Activity picker with minimal Sidekick chrome |
| `Screenshot 2026-07-14 at 09.49.11.png` | Give the allowance its own step and presets | Use compact mode cards and chips instead of a giant decorative meter |
| `Screenshot 2026-07-14 at 09.49.29.png` | Make active status, allowance, selection editing, and disable easy to find | Use a local Focus detail screen with grouped rows, contextual actions, and a privacy footer |

Keep that sequence, but do not reproduce the competitor's card proportions, mascot artwork, hourglass icon, giant circular meter, exact copy, or all-black CTA treatment. Sidekick should feel like the rest of this app: native grouped settings, restrained SF Symbols, compact sheets, conversational copy, and clear system boundaries.

The reference Settings toggle is not the right interaction for Sidekick. Focus and Health both have multi-step permission and configuration flows, so use disclosure rows with statuses. Reserve switches for truly reversible one-step settings such as the existing Location connection.

## Capability map

| Capability | Runs where | User can see it | Agent can control it | Agent can read it |
| --- | --- | --- | --- | --- |
| Select apps, categories, and websites | Device | Yes, in Apple's picker | Can open picker only | No |
| Selected-item count | Device | Yes, on local Focus screens | No | No |
| Daily allowance | Device | Yes | Yes, when the user requests a value | Only the value supplied by the user or agent |
| Scheduled Focus window | Device | Yes | Yes, when the user requests a schedule | Only that user-supplied schedule |
| Block now or start a Focus session | Device | Yes | Yes | Only success of the requested command |
| Temporary unlock | Device | Yes | Yes | Only requested duration and success |
| Usage minutes, pickups, and notifications | Device Activity report extension | Optional local report | No | No |
| Limit warning, limit reached, and shield active | Device | Yes, locally | No | No |
| Local Focus streaks or history | Device | Optional | No | No |
| Steps, sleep, workouts, and active energy | HealthKit, then consented daily aggregates | Yes | Can request summaries | Yes, after explicit AI-sharing consent |
| Heart rate and other sensitive Health types | HealthKit | Not in v1 | No | No |

## Product principles

- **The device enforces; Sidekick supports.** The agent is never positioned as surveillance or an authority the user must bargain with.
- **Permission follows intent.** Ask for Screen Time when the user chooses Focus and Health when they connect Apple Health, not during onboarding.
- **Apple owns Apple UI.** Use the system Family Activity and Health authorization surfaces instead of imitating them.
- **Local means local.** Anything derived from Screen Time stays on the iPhone, including harmless-looking aggregates and streaks.
- **Health context is earned trust.** Request a small set of useful metrics and explain the AI path before any upload.
- **Escape is always obvious.** Users can pause, change, disconnect, delete, or manage system permission without arguing with the agent.
- **No false certainty.** HealthKit gaps, duplicate sources, limited history, and delayed sync are normal states, not user failure.

## Why the boundary is different

Apple's current Developer Program License Agreement says Family Controls device or usage data may only be used for family controls or individual device management and may not be shared beyond the individual and their device. Apple's Screen Time materials also describe activity reports as privacy-preserving, on-device UI. That prevents the cloud Sidekick agent from reading Screen Time usage, even if the user opts in.

Apple now also offers `FamilyActivityData`, which can reveal installed-app bundle identifiers, visited domains, and category names after stronger authorization. Customer use is currently limited to eligible EU devices/accounts and requires the separate Family Controls App and Website Usage entitlement. Sidekick does not need this for blocking, and requesting it would create far more privacy and review risk without improving the core experience. Keep using opaque picker tokens instead.

HealthKit permits health-management use with permission, but App Review requires explicit disclosure when personal data is shared with third-party AI and prohibits health data from advertising, marketing, or use-based data mining. This makes minimized agent context possible, but only behind a dedicated consent and a hard data firewall.

## Screen Time experience

Use Sidekick's current iOS grouped-settings visual language. Borrow the useful hierarchy from the references—intro, picker, allowance, active status—but not their illustration, copy, oversized dial, or card styling.

### Settings row

Add `Focus` to the Connected group as a disclosure row, not a one-tap switch. The setup includes system authorization and a native picker, so a switch implies a simplicity that does not exist.

States:

- Not set up: `Block distractions on this iPhone`
- Active: `On · 30 min daily limit`
- Paused: `Off · settings saved on this iPhone`
- Unsupported: `Requires iOS 16 or later`

Do not show the selected-item count in the cloud-backed settings response. A count may be shown within the local Focus screen if read directly from the on-device selection.

Recommended Connected group order:

1. Location — current switch behavior
2. Focus — disclosure row
3. Apple Health — disclosure row

Focus row anatomy:

- leading symbol: `shield.lefthalf.filled`, blue on a soft blue circular background
- title: `Focus`
- subtitle: one of the state strings above
- trailing control: chevron, never a switch
- tap target: the entire row, at least 44 points high

### First-run flow

1. **Focus intro** — “Make space for what matters.” Explain that Apple performs the blocking and that selections and usage remain on this iPhone. CTA: `Continue with Screen Time`.
2. **System authorization** — request Family Controls individual authorization. Explain denial without pressure and provide a link to Settings when appropriate.
3. **Choose distractions** — present Apple's `FamilyActivityPicker` for apps, categories, and websites. Do not recreate the picker or inspect identities from its opaque tokens.
4. **Set an allowance** — simple chips for 15, 30, 45, and 60 minutes plus Custom. Also offer `Block whenever I ask` for users who do not want a daily allowance.
5. **Review** — summarize the allowance and local item count, preview the shield copy, and activate.

Individual authorization was introduced in iOS 16, so the self-control feature's real minimum is iOS 16 even though the underlying frameworks began in iOS 15.

### Screen 1 — Focus introduction

Presentation: pushed full-height screen from Settings, with a close or back affordance and one bottom CTA.

Content order:

1. small Sidekick shield symbol or existing character asset; no new competitor-like 3D illustration
2. title: `Less autopilot. More of your day.`
3. body: `Choose the apps and sites that pull you in. Apple handles the blocking on this iPhone.`
4. three short facts:
   - `Your choices stay on this iPhone.`
   - `Sidekick can change a limit when you ask.`
   - `You can pause or turn it off anytime.`
5. primary CTA: `Continue with Screen Time`
6. secondary action: `Not now`

Permission failure states:

- Cancelled: remain on the introduction screen with no warning banner.
- Denied or revoked: show `Screen Time access is off` and `Open Settings`.
- Unsupported OS: explain that Focus requires iOS 16 or later; keep all other Sidekick features available.
- Entitlement or build unavailable: use diagnostic copy only in development; production should simply say the feature is unavailable on this device.

### Screen 2 — Choose distractions

Use Apple's native `FamilyActivityPicker` as the dominant content. It already provides apps, categories, websites, search, and opaque selection handling.

Sidekick-owned chrome:

- navigation title: `Choose distractions`
- helper: `Pick the things you'd like a little help stepping away from.`
- persistent privacy caption below the picker: `Sidekick can't see what you choose.`
- bottom CTA: `Next`, disabled while the local selection is empty

Do not add a custom category hierarchy, app icons, search box, or selection rows around the system picker. Those would be a brittle recreation of Apple UI and could imply Sidekick receives app identity.

### Screen 3 — Choose how Focus works

Replace the reference's giant daily-limit dial with two compact grouped cards.

Mode card:

- `Daily allowance` — let selected items work until their combined daily allowance is reached
- `Scheduled focus` — block selected items during one or more user-defined time windows
- `Only when I ask` — no automatic limit; block immediately from chat or the Focus screen

Configuration by mode:

- Daily allowance: 15, 30, 45, and 60 minute chips plus Custom.
- Scheduled focus: day chips, start and end time, and an optional label such as `Work` or `Bedtime`.
- Only when I ask: no additional fields.

Helper: `You can change this here or ask Sidekick later.`

CTA: `Review Focus`

### Screen 4 — Review and activate

Show a plain-language summary rather than a decorative preview:

- `Guarding 6 selections` — computed and displayed locally
- `30 minutes each day`
- `Resets at midnight`
- shield preview with Sidekick title, one supportive line, and the two possible actions
- privacy note: `Selections and usage stay on this iPhone.`

CTA: `Turn on Focus`

Activation should be transactional: save the local configuration, register the native monitor, configure the shield, verify the monitor exists, and only then show success. If registration fails, keep the user's choices and offer `Try again`.

### Success state

Return to the Focus detail screen with a subtle confirmation: `Focus is ready.` Avoid a celebratory modal; the active state itself is the confirmation.

If the user entered through chat, return to chat after activation and let the agent acknowledge only what the user configured: `done — 30 minutes a day.`

### Focus modes we can support

#### Daily allowance

Accumulate time across the selected opaque tokens. Warn locally near the threshold, shield at the threshold, and remove the threshold shield when the next daily interval begins.

#### Scheduled focus

Shield during selected day and time windows regardless of accumulated usage. Useful for work blocks, bedtime, school, or meals. Multiple named schedules are a later phase; v1 should allow one schedule to keep monitor management understandable.

#### Focus session

Block immediately for a fixed duration such as 25, 45, or 90 minutes, then release automatically. This is better than using a daily allowance for `help me study for an hour`. The agent may start it after an explicit user request.

#### Manual guard

Block immediately with no automatic end. The user can unlock or disable from the local Focus screen or ask Sidekick.

#### Temporary unlock

Release the shield for 5–60 minutes and reapply it natively when the window ends. The unlock should survive the main app being terminated.

#### Health-triggered release, later

An opt-in local automation can release a block after an on-device Health condition such as completing a workout. This combines the two integrations without exporting Screen Time data. It is not v1 because it needs particularly clear consent, failure handling, and a guaranteed manual escape.

### Active Focus screen

Show only local state:

- Focus on/off
- daily allowance
- selected-item count
- `Change distractions`
- `Change daily limit`
- `Block now`
- `Turn off Focus`

Do not build an agent-facing usage dashboard. If a usage visualization is valuable later, render it solely through a `DeviceActivityReportExtension` inside the app and keep the result on-device.

Recommended structure, informed by the reference active-state screen:

1. navigation title: `Focus`
2. state card: green status dot, `Focus is on`, and the active rule
3. local-only rows:
   - `How it works` → daily allowance, scheduled, ask-only, or active session
   - `Distractions` → local count only
   - `Schedule` or `Daily allowance`, depending on mode
4. contextual action:
   - inactive automatic mode: `Block now`
   - active timed session: `End session`
   - shield temporarily released: `Block again now`
5. destructive outline action: `Turn off Focus`
6. footer: `Your selections and Screen Time activity never leave this iPhone.`

Do not put the Sidekick character above the fold. The job of this screen is status and control, and the shield itself already carries the relationship moment.

### Optional local insights

Apple's Device Activity report extension can render local views containing total activity duration, per-app or category activity, pickups, and notifications. If added, make it a secondary `Activity on this iPhone` screen with explicit `On-device only` labeling.

Useful local-only cards:

- selected-item time today
- time by hour
- pickups today
- week-over-week selected-item trend
- times the limit was reached

This report is for the user, not Sidekick. Do not serialize its configuration, screenshot it for the model, sync totals, or derive cloud streaks from it.

### Shield behavior

Use a compact Sidekick-branded shield with static, supportive copy. The primary action closes the blocked app. The secondary action can guide the user back to Sidekick through a local notification/deep link, because the shield action extension cannot directly launch the host app.

Temporary unlocks are always reversible and bounded. The agent can execute `focus_unblock(minutes)` after a user asks, but the tool result sent back to the model contains only `{ ok: true, minutes }`; it contains no current shield state or usage history. Turning Focus off must always be available without argument.

Suggested shield copy rotation, selected locally and independent of usage details:

- title: `A little space?`
- subtitles:
  - `This can wait. You picked Focus for a reason.`
  - `Take a breath before you jump back in.`
  - `Still want it? Sidekick can give you a few minutes.`
- primary: `Close app`
- secondary: `Ask Sidekick`

Do not shame, mention streak loss, claim to know what app is open, or imply the agent observed the attempted launch. The shield configuration extension may receive an opaque token, but that identity is not agent context.

Tapping `Ask Sidekick` should close or defer the shield and create a local notification that opens the Focus conversation entry point. If the user never opens it, no cloud event is created.

### Agent contract for Focus

Supported requests:

- `Set my daily limit to 30 minutes.`
- `Block my distractions for the next hour.`
- `Give me ten minutes.`
- `Turn Focus off.`
- `Open the app picker.`
- `Set Focus from 10 PM to 7 AM on weeknights.` in a later schedule phase

Unsupported data questions:

- `How much time did I spend on Instagram?`
- `Did I stay under my limit yesterday?`
- `Which app distracted me most?`
- `How many times did I open TikTok?`

Reply pattern for unsupported questions: `I can't see your Screen Time activity or which apps you picked. You can check the on-device Focus activity view.` Do not suggest the user grant broader access; broader cloud access is not an option.

Minimal client tool set:

- `focus_open_setup()`
- `focus_set_daily_allowance(minutes)`
- `focus_set_schedule(days, start, end)` — later phase
- `focus_start_session(minutes)`
- `focus_block_now()`
- `focus_unblock(minutes)`
- `focus_disable()`

Tool results contain command success, the requested value, and actionable errors only. They never contain current selections, activity, threshold, or authorization data.

### Device architecture

- Main app: authorization, local settings, picker, and control commands.
- App Group: opaque selection tokens, local allowance, enabled state, shield copy, and extension coordination.
- Device Activity Monitor extension: daily reset, warning, limit, and automatic re-block events.
- Shield Configuration extension: Sidekick appearance.
- Shield Action extension: close/defer behavior and local notification handoff.
- Server: no Screen Time selection, authorization, event, report, or usage mirror.

Retain the client tools `focus_open_setup`, `focus_set_budget`, `focus_block_now`, `focus_unblock`, and `focus_disable`. Remove `focus_status`, the server `selectionCount` mirror, and every tool result containing warned/blocked/usage-derived state. An acknowledgement that the requested command ran is enough.

The Account Holder must request Family Controls distribution entitlement approval for the main app and separately for every Screen Time extension bundle identifier. Development entitlement availability is not distribution approval.

## Apple Health experience

### What Health can power

#### Everyday agent context

- acknowledge a completed workout without requiring manual reporting
- answer `How has my sleep been this week?`
- answer `Am I moving more than last week?`
- notice a low-activity day only when relevant and without moral judgment
- distinguish `I feel exhausted` after short sleep from a generic mood statement
- tailor check-ins after a run, long walk, or late night

#### Goal support

- verify running, walking, workout, step, and sleep goals from consented summaries
- avoid double logging when multiple devices record the same workout
- allow the user's statement to override a missing or inaccurate sensor record
- suggest realistic goal adjustments from 7-day and 30-day trends
- celebrate milestones without revealing sensitive numbers in notifications

#### User-requested summaries

- today and yesterday comparison
- 7-day average and trend
- 30-day average and trend
- workout count and minutes by broad type
- sleep duration consistency and approximate bedtime and wake consistency
- active-energy trend, described as activity rather than weight-loss advice

#### Explicit non-goals

- diagnosis, treatment, emergency detection, medication advice, or clinical interpretation
- fertility, reproductive health, medications, medical records, ECG, blood glucose, weight, or mental-health types in v1
- ranking users, sharing leaderboards, or social comparison from Health data
- ad targeting, user-value scoring, or retention scoring from Health behavior
- unprompted comments about weight, calories, heart rate, or `bad` sleep

### Settings row

Add `Apple Health` as a disclosure row beneath Location.

States:

- Not connected: `Use activity and sleep in your coaching`
- Connected: `Sharing steps, sleep, workouts, and active energy`
- Sync delayed: `Updates when Sidekick next opens`
- Unavailable: `Apple Health isn't available on this device`

Use Apple's Health mark only in accordance with its artwork and editorial guidance. Do not invent a look-alike Health icon.

Health row anatomy:

- leading asset: official Apple Health artwork where permitted, otherwise a neutral `heart.text.square` SF Symbol that does not imitate the Health app icon
- title: `Apple Health`
- subtitle: one of the state strings above
- trailing control: chevron
- tap while connected: open the connected detail screen
- tap while disconnected: open the connection explanation

### Connect flow

1. Show a short benefit and data-use sheet, not a replica of Apple's permission UI.
2. List the exact data types requested and state that Sidekick is read-only.
3. Add a distinct consent: `Allow Sidekick to store daily summaries and share them with its AI provider for personalized health and goal support.` Link the privacy policy and deletion terms before the CTA.
4. Present the system Health authorization sheet.
5. After authorization resolves, read permitted types and show the first sync result. Do not call an empty result “denied”; HealthKit intentionally does not disclose read-denial status and users may grant a limited history window.

The current Info.plist statement says Sidekick “never shares,” which is incompatible with cloud-agent use. Replace it with accurate, benefit-led copy before shipping.

### Screen 1 — Health explanation and AI consent

Presentation: compact sheet from Settings that can expand if accessibility text requires it.

Content:

- title: `Let activity speak for itself`
- body: `Sidekick can use daily summaries from Apple Health to support your goals and answer questions about your routines.`
- read-only groups:
  - `Steps and active energy`
  - `Sleep duration and timing`
  - `Workouts and workout duration`
- privacy card:
  - `Read only`
  - `Daily summaries, not raw samples`
  - `Kept for 30 days`
  - `Shared with Sidekick's AI provider for your coaching`
- link: `How Sidekick handles health data`
- primary CTA: `Continue to Apple Health`
- secondary action: `Not now`

Do not put separate fake permission toggles on this sheet. Apple presents the real type-by-type controls next.

### Screen 2 — System Health authorization

Present Apple's authorization UI with only the four v1 groups. The purpose string should accurately say that Sidekick reads daily activity, sleep, and workout summaries for personalized goal support and may process those summaries with its AI provider.

Possible outcomes:

- Some readable data: sync it and open the connected detail screen.
- No readable data: show `No Health data is available to Sidekick yet` with `Manage in Health` and `Try again`.
- Limited history: sync the available window and avoid implying a full-history trend.
- Health unavailable: explain that the connection needs an iPhone with Health data; do not show retry loops.
- Query error: retain consent, show last successful sync if one exists, and retry on a later foreground.

Because HealthKit hides read-denial status, never show a definitive `Permission denied` state based on empty query results.

### Connected detail screen

Show:

- shared metric groups
- last successful sync
- 30-day retention statement
- `Manage in Health` to open the system management path
- `Stop sharing with Sidekick`

Stopping sharing disables future sync immediately and deletes all server-side health aggregates and derived health memory. It cannot silently revoke Apple's system permission; say this clearly and provide the system management link.

Recommended connected detail layout:

1. status: `Connected` with last sync time
2. `Sidekick can use` rows for steps, sleep, workouts, and active energy
3. `Stored by Sidekick` row: `Daily summaries from the last 30 days`
4. `Used for` row: `Goal support and answers in chat`
5. `Manage Apple Health access`
6. destructive action: `Stop sharing with Sidekick`
7. footer: `Stopping deletes Sidekick's copy. Apple Health permissions are managed separately in Health.`

### Health in chat

The agent should receive a compact context block, not a data dump. Example:

```text
HEALTH CONTEXT — user explicitly shared for coaching
today: 8,420 steps; 36 active min; 28-min run
yesterday: 6h 42m sleep, roughly 12:41 AM–7:23 AM
7d: steps +12% vs prior 7d; sleep avg 6h 51m
```

Only include fields relevant to the current turn or proactive check-in. Avoid including all 30 days in every prompt.

Agent behavior:

- Use neutral observation: `you've averaged about seven hours this week`.
- Use uncertainty where needed: `Health has six nights for this week`.
- Never criticize missing days or assume the device captured everything.
- Mention a specific health number only in a private in-app response, not a lock-screen notification.
- For medical or alarming questions, explain the limit and recommend appropriate professional or emergency help rather than interpreting the metric.

Server summary tool:

- `health_summary(metric, rangeDays)` where `rangeDays` is 1–30
- allowed metrics: `steps`, `sleep`, `workouts`, and `active_energy`
- output: day coverage, average or total, direction versus the comparable prior window when available, and broad workout-type counts
- no raw samples, source devices, exact routes, heart-rate series, or hidden permission inference

### Health data pipeline

1. Request only the four v1 metric groups.
2. Read on app foreground and aggregate on-device by local calendar day.
3. Upload at most 30 daily aggregates after explicit AI-sharing consent.
4. Upsert the rolling window and delete older rows.
5. Render compact agent context for today, yesterday, and relevant 7/30-day trends.
6. Replace the live `read_health` device tool with a server-side summary tool over the already-consented aggregate window. This avoids another device-to-model transfer path and works when the app is not open.
7. Treat a user correction as authoritative over sensor-derived goal progress.

Foreground sync is enough for v1. Background HealthKit observer delivery can follow after a physical-device reliability pass; anchored queries can then process changes and deletions efficiently.

### Health privacy firewall

- Encrypt health rows in transit and at rest, with access limited to the health/agent path.
- Never copy health values into general memories, interest extraction, analytics properties, crash breadcrumbs, logs, notifications, or ad profiles.
- Suppress ads for any turn whose prompt contains Health context.
- Mark every assistant message generated from a Health-enriched prompt as sensitive, not only turns that explicitly call a Health tool.
- Exclude sensitive messages from every ad request and any downstream ad vendor.
- Do not make diagnoses, treatment claims, or unvalidated accuracy claims.
- Document the AI processor, purpose, retention, revocation, and deletion behavior in the privacy policy and App Store privacy disclosures.

## Combined product moments

These integrations are stronger when they support an existing intention rather than becoming dashboards.

### Focus from chat

User: `I need to finish this deck. Keep me off distractions for 45 minutes.`

Sidekick starts a local 45-minute Focus session and replies only after the command succeeds: `locked for 45. go make the deck unfairly good.`

The agent does not receive later launch attempts, usage, or whether the shield appeared.

### Temporary access

User reaches the shield and chooses `Ask Sidekick`, which creates a local notification. If they open chat and ask for ten minutes, Sidekick runs the unlock command. The device re-blocks automatically. The conversation contains the user's request and command success, not Screen Time telemetry.

### Health-backed goal check-in

Sidekick can say `you already got a 28-minute run in today — want to count that toward the 5K plan?` because the user explicitly shared a daily Health summary. It should not silently create a goal completion the user cannot correct.

### Optional earned break, later

The user can create an on-device rule such as `Release Focus after a workout is recorded today`. HealthKit evaluation and the Managed Settings change both happen locally. The cloud agent may help the user create the rule but does not receive the Screen Time outcome.

## Notifications

Screen Time notifications are local and generic:

- warning: `Your Focus allowance is almost used.`
- session end: `Your Focus session is complete.`
- shield handoff: `Open Sidekick to ask for more time.`

Health notifications should never expose steps, sleep, calories, or workout details on the lock screen by default. A generic `Sidekick noticed progress on your goal` is acceptable only when the user has enabled proactive health check-ins.

## Analytics and success measures

### Safe Focus analytics

Measure product UI events that originate in Sidekick without including Family Controls data:

- Focus introduction viewed
- system authorization CTA tapped
- setup completed, without selection count or mode details derived from the picker
- Focus settings screen opened
- user explicitly requested block, unlock, budget change, or disable in Sidekick
- command succeeded or failed, with coarse error category

Do not record selected counts, token hashes, usage thresholds firing, shield impressions, app launch attempts, local report views tied to values, or limit outcomes.

Success questions:

- Can users finish setup without confusion?
- Do they understand Sidekick cannot see app choices or activity?
- Do block, unlock, and disable commands work reliably?
- How often do users keep Focus enabled after seven days, measured only from explicit local settings interaction if it can remain on-device?

### Safe Health analytics

Allowed operational events after consent:

- Health connection started or completed
- coarse readable metric groups, only if required for connection diagnostics and never sent to ad vendors
- sync success or failure without metric values
- disconnect and server deletion completed
- agent health-summary request succeeded or lacked enough days

Success questions:

- Does Health reduce manual goal reporting?
- Are health-backed answers useful and correctly cautious?
- Do users understand what is stored and how to delete it?
- Are ads reliably suppressed for all Health-enriched turns?

## Accessibility and content requirements

- Support Dynamic Type without truncating statuses or pinning the CTA over content.
- Give every symbol a text label; never rely on green or red alone for connection state.
- Keep native picker and permission screens unobscured.
- Use at least 44-point tap targets and visible pressed states.
- Announce activation, monitor-registration errors, and deletion completion to VoiceOver.
- Avoid motion-heavy progress dials; respect Reduce Motion for any state transition.
- Use `Focus`, `Screen Time`, `Apple Health`, and `Health app` consistently with Apple's editorial guidance.
- Avoid `detox`, `addicted`, `failed`, `cheated`, or other moralizing language.

## Edge-state matrix

| State | Focus behavior | Health behavior |
| --- | --- | --- |
| User cancels system permission | Return to explainer; no warning | Return to explainer; no sync |
| Permission later revoked | Local controls show recovery link | Stop receiving data; show manage link without claiming known denial |
| App reinstalled | Require local Focus setup again | Require explicit Sidekick sharing consent again before upload |
| No network | Focus continues locally | Queue no raw data; retry aggregate sync on foreground |
| Main app terminated | Monitors, shields, and re-block continue | Background sync is not assumed in v1 |
| Time zone changes | Re-register local schedules deliberately | Aggregate by user-local dates and avoid duplicate boundary days |
| Daylight saving change | Rebuild affected schedules | Preserve timestamps and recompute local-day grouping |
| Multiple Apple devices | Each device has independent Focus setup | Health summaries merge through HealthKit, then deduplicate on-device |
| Agent unavailable | Local Focus UI remains fully controllable | Health stays connected; no agent claim until service returns |
| Server deletion fails | Not applicable to local Screen Time | Stop future upload immediately and retry deletion visibly |

## Required changes to the current repo

### Screen Time compliance changes

- Move Focus enabled state, budget, and selection count out of `focus_settings` and into the App Group/local storage.
- Delete or stop using the `focus.update` server mirror for Screen Time-derived state.
- Remove `focus_status` and its warned, blocked, and app-count result.
- Remove cloud-generated “under budget” or threshold progress events.
- Keep only user-requested control tools with minimal acknowledgements.
- Change the Focus availability copy and deployment gate to iOS 16+.
- Add a Focus disclosure row and local detail/setup flow to the current Settings screen.
- Verify the main app and all three existing extension identifiers have distribution approvals and valid provisioning profiles.

### Apple Health product and privacy changes

- Add the Apple Health settings row, consent sheet, connected detail, and delete flow.
- Add an explicit app-level `healthAgentSharingEnabled` consent; do not infer it from HealthKit authorization or the presence of samples.
- Remove heart-rate permissions and server fields from v1.
- Change the Health usage description so it accurately describes storage and AI use.
- Enforce a rolling 30-day deletion job.
- Replace the client `read_health` tool with a server summary over consented aggregates.
- Tighten sensitive-turn marking so any Health-enriched prompt disables advertising for that turn.
- Delete server aggregates when consent is withdrawn, while linking users to Health for OS permission management.

## Delivery sequence

1. **Compliance first:** remove Screen Time telemetry/model exposure, correct Health consent copy, and add consent state.
2. **Focus shell:** Settings row, authorization, native picker, local allowance, activation, and off state.
3. **Focus enforcement:** physical-device daily threshold, reset, shield, block-now, temporary unlock, and re-block tests.
4. **Health connection:** exact four-type authorization, foreground aggregate sync, connected detail, retention, and deletion.
5. **Agent behavior:** minimal Focus control tools; Health summary context/tool; sensitive-turn ad suppression.
6. **Distribution:** entitlement approvals, privacy policy/App Store disclosures, TestFlight build, and physical-device test matrix.

## Acceptance criteria

### Focus

- A user can authorize, select apps/categories/sites, set a limit, reach the limit, see the shield, temporarily unlock, automatically re-block, edit, and disable on a physical iPhone.
- Enforcement continues while the main app is terminated.
- Selected tokens and usage-derived state never cross the device boundary.
- The cloud agent can run requested control actions but cannot answer “how much time did I spend?” from Screen Time.
- Revoking Screen Time access in Settings produces a clear recovery state.
- Focus is not paywalled or sold as a premium Screen Time capability.

### Health

- No HealthKit query runs before availability, system authorization, and explicit AI-sharing consent are handled.
- Partial or empty reads are described as unavailable data, never as a known denial.
- Only the four v1 aggregate groups reach the server, with no raw sample metadata.
- The agent can answer a 7- or 30-day steps/sleep/workout/active-energy question from the retained aggregates.
- Withdrawing consent stops sync and deletes server-side health data and derived context.
- Health-enriched turns never trigger ads or enter ad/analytics payloads.
- Foreground sync, edits/deletions, time-zone boundaries, duplicate sources, and limited-history authorization are tested on a physical device.

## Primary sources

- [Apple Developer Program License Agreement, §3.3.3(P) Family Controls](https://developer.apple.com/support/terms/apple-developer-program-license-agreement/)
- [App Review Guidelines, §§4.10, 5.1.2, and 5.1.3](https://developer.apple.com/app-store/review/guidelines/)
- [What's new in Screen Time API (WWDC22)](https://developer.apple.com/videos/play/wwdc2022/110336/)
- [Requesting the Family Controls entitlement](https://developer.apple.com/documentation/familycontrols/requesting-the-family-controls-entitlement)
- [DeviceActivityReportExtension](https://developer.apple.com/documentation/deviceactivity/deviceactivityreportextension)
- [FamilyActivityData regional and authorization limits](https://developer.apple.com/documentation/familycontrols/familyactivitydata)
- [Authorizing access to health data](https://developer.apple.com/documentation/healthkit/authorizing-access-to-health-data)
- [HealthKit Human Interface Guidelines](https://developer.apple.com/design/human-interface-guidelines/healthkit)
- [Executing observer queries](https://developer.apple.com/documentation/healthkit/executing-observer-queries)
- [Executing anchored object queries](https://developer.apple.com/documentation/healthkit/executing-anchored-object-queries)
