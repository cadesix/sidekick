# Native-fidelity pass (SF Symbols · Liquid Glass · native scroll)

## Goal
Our `packages/expo/src/imessage/` was ported from `~/Downloads/imessage-llm`. The port
replaced the reference's **iOS-only native primitives** with cross-platform stand-ins:
- `SymbolView` (SF Symbols) → Lucide SVG (`Icon.tsx`)
- `GlassView` (iOS-26 liquid glass) → opaque `chrome.*` fills (`theme.ts`)

Reintroduce the native primitives **behind fallbacks** so iOS gets full fidelity and
web/Android keep working. Both `expo-symbols` and `expo-glass-effect` are already
installed; `SymbolView` and `GlassView` each ship a web shim (fallback / plain View).

## Approach: fallback at the primitive, call-sites unchanged
- **`Icon.tsx`** → render `SymbolView` with our existing Lucide glyph as `fallback`.
  One file; all ~24 call-sites keep `<Icon name="plus" .../>`. SF name map derived
  from the reference (`arrow.up`, `chevron.left`, `arrowshape.turn.up.left(.fill)`,
  `heart.fill`, `waveform`, `face.smiling`, `selection.pin.in.out`, …). `filled` picks
  the `.fill` SF variant / paints the Lucide fill. `strokeWidth` → SF `weight`.
- **`Glass.tsx`** (already built): `GlassView glassEffectStyle="regular"` on iOS 26,
  `BlurView` (backdrop-filter on web, native blur on older iOS/Android) otherwise.

## Work items
1. **Icon → SF Symbols** (`Icon.tsx`). ✅ web-verifiable (Lucide still shows).
2. **Route `chrome` glass through `Glass`** — reference makes these glass:
   - `ChatInputBar` `+` button ✅ done · text field pill
   - `VoiceRecorder` bar
   - `PlusDrawer` panel
   - `TapbackOverlay` reaction pill + menu groups
   - `SettingsScreen` / `AdPreviewScreen` nav back buttons
   Each: swap surface `View`→`Glass`, drop `chrome.*` fill, add `overflow:"hidden"`,
   keep `borderCurve:"continuous"`. Send button stays solid blue (matches reference).
3. **Native elastic scroll** — chat `FlatList` already has `keyboardDismissMode`;
   add `contentInsetAdjustmentBehavior="automatic"` where a scroll sits under chrome.
4. **`borderCurve:"continuous"`** on rounded glass containers (iOS squircle).

## Constraints / verification
- iOS liquid-glass + SF-symbol rendering can't be visually verified in this env (needs an
  iOS 26 sim); web is the check surface. Verify per step: `tsc` clean, web renders (Lucide
  fallback visible, glass elements carry `backdrop-filter`), 0 console errors.
- Don't break Reanimated entrance animations when swapping a surface `View`→`Glass`
  (read each animated container first; wrap rather than replace where the surface is the
  `Animated.View`).
- Keep the untouched-on-web contract: no `Platform`-gated code paths that crash the web bundle.

## Out of scope (flag, don't do blind)
- TrueSheet migration of home sheets (installed, unused) — larger, separate.
- Unifying the second icon system (`@expo/vector-icons` Ionicons in `src/components`).
- Native context-menu library for tapback (custom overlay already high-fidelity).
