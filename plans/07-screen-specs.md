# 07 — Screen Specs (build-ready wireframes)

**Read [06-design-system.md](06-design-system.md) first.** This document specifies every screen: an ASCII wireframe, the exact layout tree (which shared component goes where), all states (loading / empty / error / success), and the exact copy. It is written so an implementer who is weak at UI can build each screen correctly by following it literally. When this doc says "use X component," it means the one defined in 06 — do not re-style it.

**Wireframe legend:** `┌─┐` = screen/edge · `[ Label ]` = button/pill · `( )` = circle · `▓▓░░` = progress fill · `«text»` = exact copy to ship · `‹Comp›` = a shared component from 06.

**Navigation model (decided):** **no bottom tab bar.** The **Home** screen is the app's root. Chat opens as a **bottom sheet over Home** (per `src/home2.tsx`). Everything else (goal detail, locker, settings) is a **pushed stack screen** via Expo Router. This keeps the app feeling like one warm surface, not a dashboard. Router layout:

```
app/
  _layout.tsx          // font load, providers, safe-area
  index.tsx            // Home (root)
  onboarding/…         // funnel (see 02) — shown until onboarding complete
  goal/[id].tsx        // goal detail
  add-goal.tsx         // add/adopt a goal (modal)
  screen-time-setup.tsx// Family Controls picker flow (see 03)
  locker.tsx           // cosmetics
  settings.tsx         // account, ads/consent, email
```
Chat is NOT a route — it's a sheet component rendered by Home.

---

## 1. Home

The emotional center. A cinematic photo backdrop with the mascot, today's date and streak, a sheet of the user's goals, and one big button to talk to the sidekick. Ported from `src/home2.tsx` — that file is the reference; match it.

```
┌───────────────────────────────┐
│  ‹photo backdrop, mascot›      │  ← full-bleed image, dark scrim top
│  «Monday, July 7»             │  ← date, white/85, 13/600
│  «Good morning»    (🔥 3)     │  ← 28/800 white + ‹StreakPill›
│                               │
│      [ mascot peeks here ]     │
│                               │
│ ╭───────────────────────────╮ │  ← goals sheet, rounded-t-32
│ │        ▁▁ (grabber)        │ │
│ │  «Your goals»          3   │ │  ← 18/800 + count ink/45
│ │ ┌───────────────────────┐ │ │
│ │ │ 🏃  Get Fit      🔥 4 │ │ │  ← ‹GoalRow› pastel[0]
│ │ │ 😴  Sleep Better ✓    │ │ │  ← ‹GoalRow› pastel[1], done today
│ │ │ 📵  Stop Scroll  🔥 0 │ │ │  ← ‹GoalRow› pastel[2]
│ │ └───────────────────────┘ │ │
│ │                    ( 💬 )  │ │  ← 68px FAB, bottom-right
│ ╰───────────────────────────╯ │
└───────────────────────────────┘
```

**Layout tree**
- Root: `View flex-1 bg-white` with `<Image>` backdrop `absolute inset-0` `resizeMode="cover"`, plus a top scrim `absolute inset-x-0 top-0 h-44` linear-gradient `from black/35 to transparent` (`expo-linear-gradient`).
- **Header** (`px-5 pt-7`, respects safe-area top): left column = date (`text-[13px] font-semibold text-white/85`) + greeting (`text-[28px] font-extrabold tracking-[-0.02em] text-white`, drop-shadow). Right = `‹StreakPill›` on `bg-white/90`.
  - Greeting text is time-of-day: «Good morning» / «Good afternoon» / «Good evening».
- **Goals sheet**: `absolute inset-x-0 bottom-0 top-[46%] bg-white rounded-t-[32px]` + soft top shadow. Grabber handle, then a header row (`«Your goals»` `text-[18px] font-extrabold` + count `text-[13px] font-bold text-ink/45`), then a scroll list of `‹GoalRow›` (`gap-2.5`).
- **FAB**: `absolute bottom-6 right-5` 68px white circle with `chat-tab` mascot icon; press translates down 2px. Opens the chat sheet (§2).

**Per-goal right-side state** (in `‹GoalRow›`):
- Not yet checked in today → flame + streak count.
- Checked in & item done today → 24px ink check circle (white check).
- Checked in & item missed → keep flame + count, no red, no guilt (honesty never punished — see 03).

**States**
- **Loading:** show the backdrop + header immediately; the sheet shows 3 skeleton rows (`bg-field rounded-2xl h-16` with a subtle shimmer). Never a blank white sheet.
- **Empty (no goals yet — shouldn't happen post-onboarding, but handle):** sheet shows «no goals yet — let's pick one» and a `‹PrimaryButton label="Add a goal">` routing to `add-goal`.
- **Check-in available today:** the FAB gets a small `sun` dot badge (top-right of the FAB) and the greeting subline adds «‹name› has something to say 👀». Tapping the FAB opens chat straight to today's opener.

**Interactions**
- Tap FAB → chat sheet slides up (`sheet-up`), mascot peeks in (`peek-pop`), Home header fades to 0 (300ms).
- Tap a `‹GoalRow›` → push `goal/[id]`.
- Pull the sheet grabber down slightly → no-op in v1 (don't build a drag-to-dismiss; the sheet is fixed). Keep it visual.

---

## 2. Chat (bottom sheet over Home)

Where everything happens: the daily check-in, goal talk, memory-building, and where sponsored cards render. Ported from `src/chat.tsx`.

```
┌───────────────────────────────┐
│                         ( ⌄ )  │  ← close chevron, top-right
│  (mascot peeking, top)         │
│ ┌───────────────────────────┐ │
│ │ 🙂 «hey! how'd the run go  │ │  ← ‹SidekickBubble›
│ │     this morning?»        │ │
│ │            «i actually    │ │  ← ‹UserBubble›
│ │             made it!»     │ │
│ │ 🙂 «proud of u. logging    │ │  ← ‹SidekickBubble› (tool ran silently)
│ │     that 🔥»              │ │
│ │  ┌─────────────────────┐  │ │
│ │  │ ‹SponsoredCard›     │  │ │  ← only sometimes; see 05
│ │  └─────────────────────┘  │ │
│ │              «Choose your │ │  ← reply-chip caption
│ │                  reply»   │ │
│ │              [ Go run ]   │ │  ← ‹ReplyChip› stack, bottom-right
│ │              [ Rest day ] │ │
│ └───────────────────────────┘ │
│ ┌─────────────────────┐ ( ↑ ) │  ← input field + ‹SendButton›
│ │ «Message…»          │       │
│ └─────────────────────┘       │
└───────────────────────────────┘
```

**Layout tree**
- Sheet container: `absolute inset-x-0 bottom-0 top-[7%]`, animates `sheet-up`/`sheet-down`. Close chevron top-right (`w-9 h-9 rounded-full bg-white/85`, `LuChevronDown`). Tapping the exposed backdrop strip above the sheet also closes.
- **Thread:** `FlatList` inverted or auto-scroll-to-end, `showsVerticalScrollIndicator={false}`, `px-4`, `gap-3`. Renders `‹SidekickBubble›` / `‹UserBubble›` (06 §3.3), optional `‹SponsoredCard›` (§8 here), and the `‹ReplyChip›` stack (06 §3.4) when the turn offers scripted replies.
- **Input bar:** pinned bottom, `flex-row items-end gap-2 px-4 py-3`. Field: `flex-1 bg-field rounded-full px-4 py-2.5 text-[15px]`, placeholder «Message…» (`text-ink/40`), multiline grows to ~4 lines then scrolls. `‹SendButton›` to its right (disabled + `opacity-40` when input empty AND no streaming in progress).

**Message send / streaming**
- On send: append the user bubble immediately, clear the field, show the **typing bubble** (06 §3.3 — identical size to a text bubble), fire the request.
- Stream the sidekick reply token-by-token into a cream bubble that replaces the typing bubble in place (no layout jump).
- **Tool calls are silent.** When a `log_checkin` / memory tool runs mid-stream, do NOT print "logged it!". Instead: (a) let the natural language reply stand, and (b) invalidate the goals query so Home's checklist updates — if the user pops back to Home the item is already ticked. If a check-in item ticks while chat is open and Home is behind it, that's fine (they see it on close).
- Errors: if the request fails, replace the typing bubble with a small inline retry affordance inside a cream bubble: «hmm, i glitched — tap to resend ↻». Never a red error toast; stay in character.

**Reply chips**: when the server marks a turn as offering scripted replies, render `‹ReplyChip›`s bottom-right. Tapping one sends it as the user's message in place and removes the others.

**Check-in entry:** when chat opens from a pending check-in, the first sidekick bubble is the pre-generated **opener** (03). It's already in the thread as an assistant message — just render it and let the user respond.

---

## 3. Daily check-in (a state on top of Chat, not a separate screen)

The check-in is not its own UI — it's the daily chat framed by a lifecycle. What to build:

1. **Push notification** (03) deep-links into the chat sheet with the opener visible.
2. **Opener bubble**: the generated 1–2 sentence message, in sidekick voice, at most one context signal. Already rendered as the first `‹SidekickBubble›`.
3. **Progress reflected silently** as goals get logged through conversation (§2).
4. **Completion moment:** when the sidekick calls `complete_check_in()`, trigger:
   - a brief celebratory beat in-thread (streak flame animates up if it advanced),
   - then the **reward spinner** (§6) slides up.
5. **Home reflects it:** the checked-in goals show their done state; the streak pill increments with a small pop.

**Missed check-in:** if not opened by evening, one softer follow-up push (03). No in-app nag screen. Missed items auto-close at local midnight; tomorrow's opener may reference it gently.

---

## 4. Goal detail (`goal/[id]`)

Pushed screen. Shows one goal's commitment, streak, and recent history — read-mostly; editing is light.

```
┌───────────────────────────────┐
│ ‹←›              «Get Fit»     │  ← back + title 27/800
│                               │
│   ( 🏃 large mascot-style )    │
│                               │
│  «3× a week · gym»       [edit]│  ← cadence summary + edit
│  🔥 4 day streak              │
│ ─────────────────────────────  │
│  «This week»                  │
│  ● Mon  ✓   ● Wed  ✓   ○ Fri  │  ← week dots
│ ─────────────────────────────  │
│  «Recent»                     │
│  ‹HistoryRow ran 5k · Mon›    │
│  ‹HistoryRow missed · last Fri›│
│                               │
│        [ Pause this goal ]     │  ← secondary
└───────────────────────────────┘
```

**Layout tree**
- Header: back chevron (`‹←›`) left, goal name (Heading token) centered/left.
- Hero: the goal's 56px+ icon or a mascot-in-context render, `animate-float`.
- **Cadence summary card** (`‹SolidShadow›`, pastel-tinted): «3× a week · gym» with a small `[edit]` that opens an inline editor (a stepper for target count + a cadence type segmented control). This maps to `adjust_action_item` (03) — renegotiating down is a save, not a failure; copy the edit sheet's confirm as «got it, updated».
- **Week strip:** 7 dots Mon–Sun; filled ink `✓` for hit, hollow for pending, small dash for missed. Today's dot ringed in `sun`.
- **History list:** `‹HistoryRow›` = date + outcome + note (`text-[15px]`, note `text-ink/55`). `source: 'device'` rows (screen-time) get a small phone glyph.
- **Pause**: secondary text button at the bottom, `text-ink/55`; confirms via a small sheet «pause Get Fit? your streak is saved.»

**States:** loading → skeleton hero + 3 skeleton history rows. Empty history (brand-new goal) → «no history yet — talk to ‹name› and it'll show up here». Fuzzy (tier-3) goals show the current weekly micro-challenge instead of a cadence («this week: talk to one stranger»).

---

## 5. Add / adopt a goal (`add-goal`, modal)

Reuses the onboarding goal cards. Modal sheet.

```
┌───────────────────────────────┐
│         ▁▁ (grabber)          │
│  «What do you want to work on?»│  ← Heading
│  «Pick one to start.»         │  ← subtitle 15/ink55
│  ┌───────────────────────────┐ │
│  │ 🏃  Get Fit           ( ) │ │  ← ‹OptionCard› pastel rotation
│  │ 😴  Sleep Better      ( ) │ │
│  │ 📵  Stop Doomscrolling( ) │ │
│  │ 📚  Read More         ( ) │ │
│  │ ➕  Something else…       │ │  ← custom → text input
│  └───────────────────────────┘ │
│        [ Add goal ]            │  ← ‹PrimaryButton›, disabled until pick
└───────────────────────────────┘
```

- Cards are `‹OptionCard›` from the goal catalog (`packages/shared`, 03). Single-select here (one at a time keeps commitment focused). Selected → ink check circle.
- «Something else…» reveals a `‹SolidShadow›` text input for a custom goal → stored as `slug:'custom'`.
- After adding: if the chosen goal has suggested action items, immediately show a lightweight follow-up («how often? ») with cadence chips (`3×/week`, `daily`, `custom`), then drop the user into a short chat with the sidekick to set it up. **Screen-time goals (stop-doomscrolling/procrastinating) route to §7 setup after selection on iOS.**

---

## 6. Reward spinner (post-check-in)

The variable-reward payoff. One juicy moment; make it feel good (06 §4 motion + haptics). Server decides the result; the client only animates it (04).

```
┌───────────────────────────────┐
│      «nice work today 🎉»      │  ← 27/800, confetti behind
│                               │
│     ╭─────────────────────╮   │
│     │   spinning item...   │   │  ← item cards blur past
│     ╰─────────────────────╯   │
│         ( slowing… )           │
│      ★ «Cozy Beanie» ★        │  ← lands on the reward, scale-in pop
│         «Rare»                 │  ← rarity label, color by tier
│                               │
│        [ Equip ]  [ Later ]    │
└───────────────────────────────┘
```

- Full-screen overlay, `bg-white`, `confetti-fall` particles behind the result (haptic heavy on land for rare+).
- The reel: a horizontal strip of cosmetic item images that scrolls fast then eases to a stop on the granted item (Reanimated `withDecay`/`withTiming` ease-out). Land with a `scale-in` pop + haptic.
- Rarity label color: common ink/55, rare `sky`, epic `lilac`-ink, legendary `sun` with a glow-pulse ring.
- **Sparks fallback:** if the roll grants sparks not an item, show a sparks coin count-up «+15 ✨» and current total, with «‹N› more to pick anything you want».
- Buttons: `[Equip]` (`‹PrimaryButton›`, only for wearables) applies it and returns to Home with the mascot now wearing it; `[Later]` just closes. **No purchase, no "watch an ad to spin again" — ever** (05 ban).

**Idempotency:** the grant is server-authoritative and keyed to the checkIn id; if the user backgrounds mid-animation, re-opening shows the already-granted result, never re-rolls.

---

## 7. Screen-time goal setup (`screen-time-setup`, iOS)

The Family Controls flow (03). This screen exists because we cannot read usage numbers — we set a **commitment the OS enforces**. Frame it as the user's promise, never surveillance.

```
┌───────────────────────────────┐
│ ‹←›   «Set your scroll limit»  │
│  «pick the apps that eat your  │  ← subtitle 15/ink55
│   time and a daily budget.     │
│   ‹name› only ever sees        │
│   whether you kept it — never  │
│   what you look at.»           │
│                               │
│   [ Choose apps ]              │  ← opens system FamilyActivityPicker
│   «3 apps selected»           │  ← confirmation after picking
│                               │
│   «Daily budget»              │
│   ⊖   «30 min»   ⊕            │  ← stepper 15–180, 15-min steps
│                               │
│   ( first-time only )          │
│   «we'll ask iOS for           │  ← permission explainer
│    permission next »           │
│        [ Start ]              │  ← requests auth, registers monitor
└───────────────────────────────┘
```

**Build notes (critical — see 03 for the why):**
- Use **`react-native-device-activity`** (kingstinct). Requires a dev-client build (not Expo Go) and the **Family Controls (Distribution) entitlement** (Apple approval — request early).
- `[Choose apps]` opens Apple's **system `FamilyActivityPicker`** — you do NOT build this UI; iOS provides it. It returns an **opaque `ActivitySelection` token**; you cannot show app names/icons, so the confirmation is just a count («3 apps selected»).
- `[Start]` triggers the Family Controls **authorization prompt** (system) then registers a `DeviceActivityMonitor` with the selected token + threshold. Store the token + minutes locally only.
- **What the sidekick receives** is a daily boolean (kept / blew it), read from the shared App Group at check-in — not a number. Design all downstream copy around kept/blew-it, never «you spent 47 min».
- **Non-iOS / no entitlement / user declines:** this screen is skipped entirely; the goal falls back to tier-2 self-report (03) and the sidekick just asks «how'd the scroll-avoidance go today?». The goal must be fully usable without this screen.

**States:** picker not yet done → `[Start]` disabled. Permission denied → inline «no worries — i'll just check in with you about it instead» and continue as self-report. Already set up → this screen shows current apps count + budget with an `[edit]`.

---

## 8. Sponsored card (‹SponsoredCard›, in chat)

The only monetization surface. Must be unmistakably an ad, never in the sidekick's voice, never a chat bubble (05). Rendered from Gravity's returned JSON.

```
   ┌─────────────────────────────┐
   │ (favicon) «Brand»  ·Sponsored│  ← label row, ink/45
   │ «Card title in normal case»  │  ← 15/700 ink
   │ «One line of ad copy here.»  │  ← 14/ink55
   │              [ Learn more → ]│  ← CTA, ‹SolidShadow› small pill
   └─────────────────────────────┘
```

**Anatomy & rules**
- Container: a `‹SolidShadow›` card (`rounded-2xl`, white or `bg-field`), **visually distinct from bubbles** — full width, card chrome, NOT cream/gray, NOT the bubble corner geometry. Inset from the thread edges (`mx-4`), with a hairline gap above/below so it reads as a separate object.
- **Top row (required):** brand favicon (16px) + brand name + a `·Sponsored` tag (`text-[12px] text-ink/45`). The «Sponsored» label is non-negotiable (FTC + Gravity policy).
- Title: `text-[15px] font-bold text-ink` — this is the advertiser's copy; render sentence case as given, do NOT lowercase it (it's not the sidekick).
- Body: `text-[14px] text-ink/55`, one line, ellipsize.
- CTA: small `‹SolidShadow›` pill with the returned `cta` label; opens `clickUrl` in `expo-web-browser` (`SFSafariViewController`/Custom Tab).
- **Impression pixel** (`impUrl`) fires only when the card is ≥50% visible via `FlatList` `onViewableItemsChanged` (`viewabilityConfig: { itemVisiblePercentThreshold: 50 }`) — not on render.
- **Dismiss / feedback:** long-press → a tiny sheet «hide ads like this» → fires Gravity's feedback endpoint and adds the topic to `excludedTopics`.
- No-fill → render nothing; the chat flows normally. The card must never block or delay a message (05: request runs in parallel with the LLM call).
- **Frequency/eligibility is server-decided** (05). The client just renders what arrives — do not add client-side ad logic.

---

## 9. Settings (`settings`)

Pushed screen. Account, consent, email capture, cosmetics entry.

- **Account:** anonymous state shows «Save your progress» → Apple/Google sign-in buttons (`‹SolidShadow›` rows). Signed-in shows the identity.
- **Email capture** (CPM lever, 05): a row «Weekly recap from ‹name›?» with a toggle; enabling asks for email (hashed client-side SHA-256 for ad attribution — the plaintext is only used for the recap). Frame as a feature, not an ad ask.
- **Ads & privacy:** «Personalized ads» toggle (EU opt-in default, US opt-out default), a «Do not sell/share my info» link (CCPA), and «Delete my account & data» (cascades per 05). Under-16 accounts hide the personalized-ads toggle entirely (no ads at all).
- **Cosmetics:** a row → `locker`.
- Each row is a `‹SolidShadow›` surface or a plain `flex-row justify-between py-4` with a hairline `border-b border-ink/12`.

---

## 10. Locker (`locker`) — cosmetics

Grid of owned + locked cosmetic items; equip to dress the mascot (04).

```
┌───────────────────────────────┐
│ ‹←›   «Locker»                 │
│   ( mascot wearing current )   │  ← live preview, updates on equip
│  «Head · Face · Outfit · Acc»  │  ← slot tabs
│  ┌────┐ ┌────┐ ┌────┐ ┌────┐   │
│  │item│ │item│ │ 🔒 │ │ 🔒 │   │  ← grid, locked dimmed
│  └────┘ └────┘ └────┘ └────┘   │
└───────────────────────────────┘
```

- Live mascot preview at top (equipped items composited per the mask-region system in `src/sidekick-cosmetics.tsx`), `animate-float`.
- Slot tabs (Head/Face/Outfit/Accessory) — a simple segmented control; filter the grid.
- Grid: 4-col `‹SolidShadow›` tiles, pastel-tinted by rarity. Owned = tappable to equip (ink check when equipped). Locked = `opacity-40` + 🔒 + a caption of how to earn it («day 7 streak», «spinner»).
- Equipping updates the preview instantly and persists; no confirm needed.

---

## 11. Global states & polish checklist (apply to every screen)

- **Loading:** skeletons in the real layout's shape (`bg-field` blocks, subtle shimmer), never a centered spinner on blank white, never a layout that jumps when data lands.
- **Empty:** a warm one-liner in the sidekick's lowercase voice + one clear `‹PrimaryButton›` action. Never a dead end.
- **Error:** stay in character, offer a retry, never a red system error. (Chat: inline resend. Data screens: «couldn't load that — tap to retry».)
- **Safe areas:** every screen wrapped for safe-area insets; backdrops may bleed to edges, text/controls never under the notch or home indicator.
- **Tap targets:** ≥44×44px, even when the visual is smaller.
- **Motion:** entering content uses the 06 §4 vocabulary (fade-up for lists, spring/scale-in for arrivals, sheet-up for sheets). Reward/celebration moments get haptics. Nothing animates via `setTimeout`.
- **Voice:** sidekick = lowercase warm; UI chrome = sentence case. Advertiser copy = as-given.
- **Consistency check:** if a surface has a 2px ink border, it MUST have the 2px/2px hard ink shadow (`‹SolidShadow›`) and the press-in state. No exceptions.
```
