# @sidekick/expo

React Native (Expo) port of the sidekick web app's `/home4` interface — a
full-screen cel-shaded 3D mascot with a chat drawer. Lives in the sidekick
monorepo alongside its source-of-truth web app (`packages/web`). Stack: Expo
SDK 54, expo-router, NativeWind, Zustand, Reanimated, plus a native GL layer
(`expo-gl` + `expo-three` + `three`) for the imperative Three.js scene ported
from `packages/web/src/components/sidekick-*`.

## Running (requires a dev client — NOT Expo Go)

`expo-gl` is a native module, so Expo Go can't load it. You must build a dev
client once, then Metro reloads JS instantly after that.

```bash
pnpm install                          # at the repo root (workspace install)
pnpm --filter @sidekick/expo ios      # or: ... android  (prebuilds + builds the dev client)
```

Subsequent runs: `pnpm --filter @sidekick/expo start` (Metro with the dev client).

Optional real AI replies: copy `.env.example` → `.env` and set
`EXPO_PUBLIC_OPENAI_API_KEY`. Without a key the chat uses canned replies so the
UI is fully usable offline.

## What's in v1 (MVP)

- Mascot GLB (cel shading + inverted-hull outline), rigged, idle breathing
- Face expression atlas (blink / talk / expressions) on the FaceSprite plane
- Phone-hold arm pose + camera framing ease when the chat drawer opens
- Chat drawer (Reanimated slide) + persisted conversation (AsyncStorage)

## What's in v2 (home4 parity pass)

- iOS-style home dock (Messages / Shop / Map / Settings) — `HomeDock.tsx`
- Cosmetics engine (`src/three/cosmetics.ts`): manifest-driven slot GLBs,
  skinned rebind (shirt/pants) + rigid bone attach (hat/shoes/phone), variant
  textures + solid-color overrides, cel item materials
- Wardrobe persistence (`sidekick-wardrobe-v1` in AsyncStorage) — same key and
  shape as the web app
- Shop bottom sheet (`ShopSheet.tsx`) driving the live character through the
  canvas-published `CosmeticsControls`; studio backdrop + contact shadow
  crossfade while it's open
- Visible phone prop parented to `R_Hand`, toggled with the phone-hold pose
- Full-screen world map (`WorldMap.tsx`) with circle-mask reveal (hand-built:
  a scaling `overflow: hidden` circle whose inner content counter-scales),
  emoji area pins, lock badges, place cards, "Explore the World" promo card
- MAP / SHOP camera framings (verbatim from web `home4.tsx`)

Still deferred: the 20k-blade grass field and poke/drag interaction.

### Gotcha: css-interop drops function-form Pressable styles

`style={({ pressed }) => ({...})}` on a `Pressable` renders NOTHING from that
style under this NativeWind/react-native-css-interop setup — backgrounds,
sizes, positions all silently vanish. Use static style objects (press-scale
feedback is sacrificed until this is fixed upstream).

### Known issue: simulator GL rendering is unreliable (see also 2026-07-10)

Long-standing: skinned meshes draw only intermittently on the iOS simulator,
and the ground/sky z-fight into radial "spike" artifacts (both documented
during the v1 bring-up; not code bugs — a byte-identical restore of the v1
renderer reproduces them). New on 2026-07-10 (correlates with Xcode 26.1 being
installed, which updates the system CoreSimulator): a sky+ground-only scene
rendered fully blank on a fresh iOS 26.1 device with a freshly rebuilt dev
client, with either MSAA setting. RN-level UI (dock/map/shop/chat) is always
unaffected. The reliable verification path for anything 3D remains a PHYSICAL
device. The app now detects simulators and uses the static scene fallback
automatically; `EXPO_PUBLIC_DISABLE_3D=1` provides the same fallback on a
physical device. Alternatively, migrate to a newer Expo SDK whose expo-gl
tracks the current simulator stack.

## Asset pipeline

The mascot/phone GLBs are texture-stripped (`pnpm --filter @sidekick/expo strip-glb`) because three's
GLTFLoader can't decode a GLB's embedded images in RN. In cel mode the body is a
flat color and the face uses a separate bundled sheet, so no baked texture is
needed. Re-run `strip-glb` if you replace a source `.glb` in `assets/models/`.

## Notes / gotchas baked into the config

- `babel-preset-expo` MUST match the Expo SDK (54). A mismatched (e.g. SDK-57)
  preset leaves modern class syntax in that SDK-54's Hermes rejects.
- `metro.config.js` registers `glb`/`gltf` in `assetExts`.
- GLBs load via `expo-asset` → base64 → `GLTFLoader.parse` (avoids RN `file://`
  fetch quirks). Textures load via `expo-three`'s `loadTextureAsync`.
- Procedural canvas textures from the web (sky gradient) are rebuilt as
  DataTextures (`src/three/gradient.ts`) since RN has no DOM `<canvas>`.

## Source layout

```
app/                     expo-router routes
  _layout.tsx            root Stack + providers
  index.tsx              /home4 port (canvas + chat drawer)
src/
  three/                 ported Three.js scene (imperative)
    renderer.ts          scene build + RAF loop (was sidekick-canvas.tsx)
    shading.ts           cel material + outline + item materials
    cosmetics.ts         equipment engine (was sidekick-equipment.ts)
    cosmetics-manifest.ts bundled manifest (was public/cosmetics/manifest.json)
    wardrobe.ts          outfit state + AsyncStorage (was sidekick-wardrobe.ts)
    face.ts              expression atlas controller
    settings.ts          baked DEFAULT_SETTINGS + scene presets
    gradient.ts          canvas-free gradient + radial-shadow DataTextures
    assets.ts            GLB / texture loaders + de-interleave for expo-gl
  components/
    SidekickCanvas.tsx   GLView wrapper (was sidekick-canvas.tsx's React seam)
    Chat.tsx             chat UI
    HomeDock.tsx         iOS-style dock (was home-dock.tsx)
    ShopSheet.tsx        wardrobe bottom sheet (was shop-sheet.tsx)
    WorldMap.tsx         full-screen map overlay (was world-map.tsx)
  store/chat.ts          zustand + AsyncStorage
  lib/chat-api.ts        OpenAI-compatible reply (or canned fallback)
assets/models/           texture-stripped GLBs
assets/cosmetics/        slot GLBs (stripped) + variant PNGs (from web .webp)
assets/images/           world-map-day.webp
assets/textures/         face-sheet-v3.png
scripts/strip-glb.mjs    GLB texture stripper (mascot + phone + cosmetics)
```
