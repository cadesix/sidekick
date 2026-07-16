# 06 — Design System (React Native / NativeWind build bible)

**Read this before writing any UI.** Every screen in [07-screen-specs.md](07-screen-specs.md) assumes the tokens and components defined here. The visual language already exists and is locked — it lives in `design-system/*.html` (rendered reference cards) and `src/components/funnel/constants.ts` (the web tokens). This document ports it to **Expo / React Native / NativeWind 4** and spells out the parts RN does *not* do the way the web prototype does. Do not invent new colors, radii, fonts, or shadows. If a value isn't here, it's in the reference cards; if it's in neither, ask before adding.

**The aesthetic in one sentence:** soft rounded sans-serif, white background, pastel fills, a friendly glossy-vinyl mascot, and one signature "neo-brutalist" move — a **2px ink border + a hard 2px offset ink shadow** that presses in when tapped. Warm, toy-like, high-contrast, never flat/corporate.

---

## 0. How to read this doc

- **Tokens are law.** Use the named tokens (§1). Never hardcode a hex that isn't in the table.
- **Copy the component recipes verbatim** (§3). They already encode the states, spacing, and RN gotchas. Don't "improve" them.
- **When RN differs from the web prototype, §5 tells you exactly what to do instead.** Those are the traps.
- Code samples are the target. `className` = NativeWind. Where a thing can't be a class, it's inline `style={{…}}`.

---

## 1. Tokens

### 1.1 Color — put these in `tailwind.config.js` and use the *names*, never raw hex

```js
// tailwind.config.js  → theme.extend.colors
colors: {
  ink:        "#111111", // text, borders, primary button, ALL neo-brutalist shadows
  cream:      "#FBEFC9", // sidekick chat bubbles
  sun:        "#F2C94C", // accent, send button
  sky:        "#9DC4F2", // progress-bar fill
  usergray:   "#E9E9EC", // user chat bubbles + reply chips
  field:      "#F0F0F2", // input backgrounds, progress track
  flame:      "#FF9F43", // streak flame + count
  // Pastels — option cards / goal rows. ROTATE in this order by row index.
  butter:     "#FBF5D0",
  peach:      "#F6D2CB",
  mint:       "#DCF3EF",
  lilac:      "#F1DAF6",
  periwinkle: "#DCE7FB",
},
```

```ts
// Export the pastel rotation as an array too (packages/shared) — many lists index into it.
export const PASTELS = ["#FBF5D0", "#F6D2CB", "#DCF3EF", "#F1DAF6", "#DCE7FB"] as const;
export const pastelFor = (i: number) => PASTELS[i % PASTELS.length];
```

**Ink opacity ladder** (secondary text — use `text-ink/NN` in NativeWind):

| Use | Opacity | Class |
| --- | --- | --- |
| Primary text | 100% | `text-ink` |
| Subtitles / body | 55% | `text-ink/55` |
| Captions / metadata | 45% | `text-ink/45` |
| Placeholders | 40% | `text-ink/40` |
| Hairlines / grabber handle | 12% | `bg-ink/12` |

App background is always white (`bg-white`). There is **no dark mode in v1** — do not add one.

### 1.2 Type — one family, `ABC Diatype Rounded`, weights 100–900

Load once via `expo-font` (see §5.2). Then use this scale. Only these five roles exist — don't introduce new sizes.

| Role | Size | Weight | Tracking | Line height | NativeWind |
| --- | --- | --- | --- | --- | --- |
| **Heading** | 27 | 800 | −0.02em | 1.15 | `text-[27px] font-extrabold tracking-[-0.02em] leading-[1.15]` |
| **Option label** | 17 | 700 | — | 1.2 | `text-[17px] font-bold leading-[1.2]` |
| **Body / subtitle** | 15 | 400 | — | 1.6 | `text-[15px] leading-[1.6] text-ink/55` |
| **Chat** | 15 | 400 | — | 1.375 | `text-[15px] leading-[1.375]` |
| **Caption** | 12 | 500 | — | — | `text-[12px] font-medium text-ink/40` |

Heading on a photo backdrop (home) goes to **28px** and white with a drop shadow — the one documented exception.

**Voice rule (baked into type):** the sidekick always speaks **lowercase**, warm, 1–2 short sentences. UI chrome (buttons, headings, labels) uses **Title Case / sentence case** normally. Never mix these up — lowercase is the character; sentence case is the app.

### 1.3 Spacing, radius, sizing — the fixed vocabulary

| Token | Value | Where |
| --- | --- | --- |
| Screen side padding | **20px** (`px-5`) | every screen's content gutter |
| Card inner padding | **16px** (`p-4`) | solid-shadow cards |
| Option card padding | `10px 20px 10px 12px` (`pl-3 pr-5 py-2.5`) | icon sits closer to the left edge |
| Row gap (lists) | **10px** (`gap-2.5`) | goal rows, option cards |
| Bubble padding | `10px 16px` (`px-4 py-2.5`) | chat bubbles |
| Radius — cards/surfaces | **16px** (`rounded-2xl`) | option cards, solid-shadow surfaces |
| Radius — sheets | **32px** top (`rounded-t-[32px]`) | bottom sheets |
| Radius — pills/buttons | **999px** (`rounded-full`) | buttons, chips, streak pill |
| Radius — chat bubble | `24px` with ONE 6px corner | see §3.3 |
| Avatar (in chat) | **32px** | leading the sidekick bubble |
| Goal-row icon | **40px** | home list |
| Option-card icon | **56px** | onboarding goal cards |
| Send button | **44px** circle | chat input |
| Primary FAB | **68px** circle | home chat button |
| Min tap target | **44×44px** | never smaller, even if the visual is smaller — pad the Pressable |

---

## 2. The signature move: the "solid shadow" (neo-brutalist) surface

This is the brand's single most recognizable detail and **the #1 thing RN will get wrong if you let it.** On web it's `border: 2px solid #111; box-shadow: 2px 2px 0 0 #111`. On press: translate 2px right + 2px down and drop the shadow — the surface physically presses into its own shadow.

**RN does NOT support a crisp, hard, offset box-shadow via `className`.** NativeWind's `shadow-*` maps to iOS `shadowRadius`/elevation, which gives a soft blurred shadow — wrong. **Do not use `shadow-[2px_2px_0_0_#111]` in RN; it will not render correctly.**

**Instead, build this one reusable component and use it everywhere a solid-shadow surface is called for:**

```tsx
// packages/shared/ui/SolidShadow.tsx
import { Pressable, View } from "react-native";
import type { ReactNode } from "react";

// A surface with a hard 2px ink border and a hard 2px offset ink shadow, rendered
// as a second view offset behind the content (the only reliable cross-platform way
// to get a crisp non-blurred offset shadow in RN). Pressing translates the content
// onto its shadow — matching the web PRESS token exactly.
export function SolidShadow({
  children,
  onPress,
  radius = 16,
  className = "",
}: {
  children: ReactNode;
  onPress?: () => void;
  radius?: number;
  className?: string;
}) {
  const Wrapper = onPress ? Pressable : View;
  return (
    <View style={{ position: "relative" }}>
      {/* the hard shadow: a plain ink rectangle, offset 2/2 behind the content */}
      <View
        style={{
          position: "absolute",
          left: 2, top: 2, right: -2, bottom: -2,
          backgroundColor: "#111",
          borderRadius: radius,
        }}
      />
      <Wrapper
        onPress={onPress}
        style={({ pressed }) => ({
          borderWidth: 2,
          borderColor: "#111",
          borderRadius: radius,
          transform: pressed ? [{ translateX: 2 }, { translateY: 2 }] : [],
        })}
        className={className}
      >
        {children}
      </Wrapper>
    </View>
  );
}
```

Rules:
- **Shadow is always ink (`#111`), always offset exactly 2px/2px, never blurred.** Same on every surface, every size.
- **Pressed state = translate 2/2 (onto the shadow).** The `SolidShadow` component handles this; when you press, the content moves and the shadow "disappears" underneath it. Never add a separate opacity/scale press to a solid-shadow surface.
- **Disabled state = 40% opacity, no press movement** (`opacity-40`, and don't pass `onPress`).

---

## 3. Core components

Each is: **anatomy → exact spec → states → recipe.** Build these once in `packages/shared/ui`, then screens just compose them.

### 3.1 Primary button (pill)

Anatomy: full-width black pill, white 16/600 label, centered.

```tsx
// <PrimaryButton label="Continue" onPress={…} disabled={…} />
<SolidShadow radius={999} onPress={disabled ? undefined : onPress}>
  <View className={`w-full py-4 items-center justify-center rounded-full bg-ink ${disabled ? "opacity-40" : ""}`}>
    <Text className="text-white text-[16px] font-semibold">{label}</Text>
  </View>
</SolidShadow>
```
- Height: `py-4` (16px top/bottom). Full width of its container.
- Disabled: `opacity-40`, no press. Loading: swap label for a small white spinner, keep the pill size fixed.

### 3.2 Send button

- **44px circle, `bg-sun` (`#F2C94C`), white up-arrow, no shadow, no border.**
- Icon: up-arrow, `stroke="#fff"`, `strokeWidth={3}`, `strokeLinecap/Linejoin="round"` (use `react-native-svg` or a `lucide-react-native` `ArrowUp`).
- Disabled (empty input): `opacity-40`.
- Press: `active:opacity-80` (this one is NOT a solid-shadow surface, so a simple opacity press is correct).

### 3.3 Chat bubbles — the geometry matters

The signature detail: **the bubble corner nearest its avatar is flattened to 6px; the other three are 24px.**

| | Sidekick | User |
| --- | --- | --- |
| Fill | `bg-cream` (`#FBEFC9`) | `bg-usergray` (`#E9E9EC`) |
| Align | left | right (`self-end`) |
| Corners | `borderRadius: 24, borderBottomLeftRadius: 6` | `borderRadius: 24, borderBottomRightRadius: 6` |
| Avatar | 32px sidekick render, left of bubble, `items-end` (bottom-aligned) | none |
| Max width | 85% | 80% |
| Padding | `px-4 py-2.5` | `px-4 py-2.5` |
| Text | `text-[15px] leading-[1.375] text-ink` | same |

**Typing indicator MUST be built as a one-line bubble with identical padding and line-box** (a cream bubble containing an animated `…`), so that when the real text replaces it, the list does not jump. This is a hard requirement — a weak model will otherwise make a differently-sized spinner and the chat will visibly shift. Animate the dots with Reanimated (see §4), 1.6s loop, `text-ink/40`.

### 3.4 Reply chips ("Choose your reply")

Scripted reply options the user can tap instead of typing. Rendered as **draft user bubbles**, stacked bottom-right:

- A caption label `Choose your reply` (`text-[12px] font-medium text-ink/40`), right-aligned, sits above the stack.
- Each option: same shape as a **user** bubble (`bg-usergray`, `borderRadius:24, borderBottomRightRadius:6`), `px-4 py-2.5`, text `text-[15px] leading-[1.375]`, right-aligned, `self-end`.
- Stack them with `gap-2` at the bottom of the thread, anchored bottom-right.
- **On tap:** that text is sent as the user's actual message *in place* (the chip becomes the sent bubble); the other chips disappear. Press: `active:opacity-70`.

### 3.5 Option card (onboarding goals / multi-select lists)

- Row: pastel fill by index (`pastelFor(i)`), `rounded-2xl`, padding `pl-3 pr-5 py-2.5`, `flex-row items-center gap-4`.
- 56px icon on the left. **See §5.1 — icons must be pre-baked with transparent backgrounds; `mix-blend-multiply` does NOT exist in RN.**
- Label: `text-[17px] font-bold` (Option label token), `flex-1`.
- **Selected indicator:** a 24px ink circle on the right containing a white check (`strokeWidth 3.5`). Unselected: no circle (empty space).
- Press: `active:scale-[0.99]` (Reanimated or `Pressable` transform). This is NOT a solid-shadow surface — the pastel fill + press-scale is the whole affordance.

### 3.6 Progress bar (onboarding, segmented)

- N segments in a row, `gap-1.5`. Each segment: `flex-1 h-2 rounded-full bg-field overflow-hidden`, with an inner fill `h-full bg-sky rounded-full` whose width = that segment's percent.
- **The very first segment is seeded to 15% at step 0** so it never reads as "no progress." Fill animates width over 500ms ease-out (Reanimated `withTiming(pct, {duration:500})`).

### 3.7 Streak pill

- `flex-row items-center gap-1.5 rounded-full px-3 py-1.5`, `bg-white/90` (on the photo header) or `bg-field` (on white).
- Flame icon `color={flame}` (`#FF9F43`), `strokeWidth 2.5`, 16px. Count: `text-[15px] font-bold text-ink`.

### 3.8 Goal row (home list)

- `flex-row items-center gap-3 rounded-2xl pl-3 pr-4 py-2.5`, `backgroundColor: pastelFor(i)`.
- 40px icon (transparent PNG, §5.1). Label `text-[16px] font-bold text-ink flex-1`.
- Right side: flame + per-goal streak count (`text-[13px] font-bold text-ink/55`). If a check-in item is done today, show the 24px ink check circle instead of/alongside the flame (see 07 home spec).

### 3.9 Bottom sheet

- Container: `absolute inset-x-0 bottom-0`, `bg-white rounded-t-[32px]`, top soft shadow `shadow-[0_-10px_30px_rgba(0,0,0,0.14)]` (this soft shadow IS fine in RN — it's blurred, not the hard brand shadow).
- **Grabber handle:** `w-10 h-1.5 rounded-full bg-ink/12`, centered, `pt-3 pb-1`.
- Slide up/down with the `sheet-up`/`sheet-down` motion (§4). Content max width `max-w-md mx-auto w-full px-5`.

---

## 4. Motion vocabulary → Reanimated

The prototype's animations (in `src/globals.css`) are the canonical motion. In RN, implement them with **`react-native-reanimated` v3** — do not use `Animated` from `react-native`, and never use `setTimeout` to fake animation. Map:

| Web keyframe | Feel | RN implementation |
| --- | --- | --- |
| `fade-in` / `fade-up` / `fade-in-up` | content entering | Reanimated `FadeIn` / `FadeInDown` layout-entering animations (`entering={FadeInDown.duration(400)}`) |
| `scale-in` (cubic-bezier 0.34,1.56,0.64,1) | **springy pop** — the brand's "arrival" feel | `withSpring(1, { damping: 12, stiffness: 180 })` on scale, from 0 |
| `peek-pop` (mascot appears, overshoots, settles) | sidekick peeking in | scale `0.72 → 1.06 → 1` via `withSpring`, `transformOrigin` bottom-center |
| `float` (±10px, 4s loop) | idle mascot bob | `withRepeat(withTiming(-10, {duration:2000}), -1, true)` on translateY |
| `sheet-up` / `sheet-down` (0.45s cubic 0.32,0.72,0,1) | bottom-sheet open/close | `translateY` from screen height → 0 with `withTiming(…, { duration: 450, easing: Easing.bezier(0.32,0.72,0,1) })` |
| `shake-strong` / `shake-soft` | reveal excitement | small rotation keyframes via `withSequence`, `transformOrigin` center |
| `confetti-fall` | reward celebration | per-particle `translateY` + `rotate` with staggered delays (or a vetted lib; see 07 spinner) |
| `glow-pulse` | ambient highlight behind mascot | opacity+scale `withRepeat` |
| `bar-grow` | progress fill | `withTiming(width, {duration:500, easing: Easing.out(Easing.ease)})` |
| typing `…` dots | chat pending | `withRepeat` over 3 opacity states, or step through 1/2/3 dots on a 1.6s loop |

**Haptics:** pair the juicy moments with `expo-haptics` — light impact on send, success notification on check-in complete, medium impact on each spinner tick, heavy on a legendary reward. Never haptic-spam (no haptics on ordinary scrolling/typing).

---

## 5. RN porting gotchas (where the web prototype does NOT translate)

These are the specific traps. Get them wrong and the UI looks broken.

### 5.1 `mix-blend-mode: multiply` does not exist in React Native
The web goal icons use `mix-blend-mode:multiply` to kill the white halo so the icon sits cleanly on a pastel card. **RN has no blend modes for images.** Do not try to polyfill it.
**Fix:** all mascot/goal/cosmetic icons ship as **PNGs with real transparent backgrounds** (no white box), pre-baked in the asset pipeline (04-gamification.md). Then they composite onto any pastel with a plain `<Image>` — no blend needed. This is an asset-production requirement: reject any generated icon that has a non-transparent background.

### 5.2 Fonts
Load the family once at app root before rendering UI:
```tsx
const [loaded] = useFonts({ "Diatype-Rounded": require("./assets/ABCDiatypeRounded.ttf") });
if (!loaded) return null; // or a splash
```
Because it's a single variable font (weights 100–900), set the family in the NativeWind theme (`fontFamily.sans`) and rely on `font-*` weight classes. If weight classes don't visibly change on device (variable-font weight axis not honored), ship the specific static weights you use (400/500/700/800) as separate files and map them.

### 5.3 Shadows
- The **hard brand shadow** → always the `SolidShadow` component (§2), never `shadow-*`.
- **Soft shadows** (sheet top-shadow, floating FAB) → fine to use, but on Android also set `elevation` since iOS `shadow*` props are ignored there. The FAB's web `shadow-[0_5px_0_0_rgba(0,0,0,0.16)]` (a hard drop) → replicate with a `SolidShadow`-style backing view or accept a soft `elevation` on Android.

### 5.4 Safe areas & keyboard
- Wrap screens in `react-native-safe-area-context`; the photo backdrop bleeds to the top edge but text respects the safe inset.
- Chat input: use `KeyboardAvoidingView` (iOS `padding`) or `react-native-keyboard-controller` so the input rides above the keyboard and the last message stays visible. Auto-scroll the thread to bottom on new message and on keyboard open.

### 5.5 Lists
- Chat thread and goal lists → `FlatList`/`FlashList`. Hide the scroll indicator (the web uses `.no-scrollbar`) via `showsVerticalScrollIndicator={false}`.
- Ad impression tracking (05) uses `onViewableItemsChanged` — that's the RN equivalent of the web IntersectionObserver.

### 5.6 No `&&` for conditional render, no ternary-in-logic
Per house style: in JSX, conditionally render with a **ternary returning `null`** (`cond ? <X/> : null`), never `cond && <X/>`. Outside JSX avoid ternaries entirely. (RN renders a stray `false`/`0` as a crash or a literal, so this rule also prevents real bugs here.)

---

## 6. Do / Don't (hand this list to the implementer)

**Do**
- Reuse the `packages/shared/ui` components; compose screens from them.
- Use named color tokens and the 5-role type scale — nothing else.
- Use `SolidShadow` for every bordered card/button; keep the 2px/2px hard shadow identical everywhere.
- Keep the sidekick lowercase and UI chrome sentence-case.
- Match the reference cards in `design-system/*.html` pixel-for-pixel when in doubt.

**Don't**
- Don't add colors, gradients (except the documented home header scrim), fonts, or radii.
- Don't use `shadow-[…]` classes for the hard brand shadow, or `mix-blend-mode`, or `Animated`, or `setTimeout` for animation.
- Don't make the typing indicator a different size than a text bubble.
- Don't put the sidekick's voice in Title Case or the UI chrome in lowercase.
- Don't build dark mode, don't paywall anything in v1, don't attach any reward to viewing an ad.
```
