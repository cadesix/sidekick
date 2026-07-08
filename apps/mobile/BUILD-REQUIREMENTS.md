# Focus Mode — Build Requirements (plan 13)

Focus mode (app blocking, budgets, negotiated unlocks) uses Apple **Family Controls
/ DeviceActivity / ManagedSettings** via `react-native-device-activity`. None of the
native side can be built or run in this environment — it needs Apple approvals, a
dev-client build, and real provisioning. Everything below is what a human must do to
ship it. The JS/TS half is complete, typechecks, tests green, and `expo export` bundles.

## 1. Apple entitlement approval — FILE THIS FIRST (weeks of lead time)

Family Controls **(Distribution)** requires an Apple approval request that has
historically taken days-to-weeks. Until it's approved you cannot even build an Expo
Dev Client — only local Xcode builds. Request it the moment this feature is committed:

- Request form: https://developer.apple.com/contact/request/family-controls-distribution

You need approval for **4 bundle identifiers** (main app + the 3 generated extension
targets). With our bundle id `software.sans.sidekick` (set in `app.json`), the four are:

- `software.sans.sidekick`
- `software.sans.sidekick.ActivityMonitorExtension`
- `software.sans.sidekick.ShieldAction`
- `software.sans.sidekick.ShieldConfiguration`

After approval, in the Apple Developer portal add **Family Controls (Distribution)**
under Additional Capabilities for **each** of those 4 identifiers. With EAS this is a
one-time step; provisioning is automatic afterward.

## 2. Fill in the two placeholders in `app.json`

- `ios.appleTeamId` and the `react-native-device-activity` plugin's `appleTeamId` are
  both `"REPLACE_WITH_APPLE_TEAM_ID"` — set to the real Apple Team ID (Xcode → Signing).
- `appGroup` is `group.software.sans.sidekick`. Confirm this App Group exists on the
  App ID (it's the shared-UserDefaults bridge between JS and the extensions). If you
  change the bundle id, update the App Group and the 4 identifiers above to match.

## 3. Config plugins already wired (`app.json`)

- `["expo-build-properties", { ios: { deploymentTarget: "15.1" } }]` — DeviceActivity
  needs iOS 15.1+. Verified: `expo config` resolves with `deploymentTarget: '15.1'`.
- `["react-native-device-activity", { appleTeamId, appGroup }]` — generates the three
  extension targets. Verified via `expo config`: the targets appear with correct bundle
  ids (ShieldConfiguration / ShieldAction / ActivityMonitorExtension).

## 4. Native extension sources (`apps/mobile/targets/`)

The plugin copied the module's Swift extension templates into `targets/` (bacons
apple-targets convention — this is where the customizable native code lives, so it
belongs in version control):

- `ActivityMonitorExtension/` — runs the daily monitor; fires the block/unblock
  actions natively with no JS running (works with the app killed).
- `ShieldConfiguration/` — renders the shield UI, reading our config from the App
  Group (pushed by JS via `updateShieldWithId`).
- `ShieldAction/` — handles the shield buttons. Its template already handles the
  `sendNotification` action our secondary "let me ask {name}" button uses.

**Deep-link into chat from the shield (the one piece to verify on device):** the
shield cannot open our app directly (iOS rule). Our secondary button is
`behavior: "close"` + a `sendNotification` action whose payload carries
`userInfo: { type: "focus" }`. Tapping that local notification deep-links into chat —
handled by `lib/notifications.ts` (`"focus"` is in `DEEP_LINK_TYPES`). Confirm the
ShieldAction extension's `sendNotification` fires with our payload once running on a
real device; if the template needs the notification content adjusted, edit
`targets/ShieldAction/ShieldActionExtension.swift`.

## 5. Build path

1. Get the entitlement approved (step 1).
2. `npx expo prebuild --platform ios` (generates `ios/` with the 3 targets).
3. Verify in Xcode that the 3 extension targets exist alongside the app target.
4. Dev-client build (`eas build --profile development` or local Xcode). **No Expo Go**
   — the extensions can't exist there (same constraint plan 03 already imposes).

## What cannot be verified in this environment

- Actual app blocking / shield rendering / threshold monitoring (all native, need a
  provisioned device with the entitlement).
- The FamilyActivityPicker (`DeviceActivitySelectionViewPersisted`) rendering + token
  persistence — it's a native system view; here we only typecheck its props/usage.
- The ShieldAction → local-notification → chat deep-link round-trip on device.
- Whether the daily monitor's wall-clock `intervalEnd` for a temporary unlock that
  crosses **midnight** behaves as intended (DeviceActivity schedules are wall-clock;
  a re-block window spanning midnight is an inherent platform edge — `reblockMonitorPlan`
  computes the components correctly but the OS behavior across midnight should be
  spot-checked on device).

## Dependencies added

- `react-native-device-activity` (native module + config plugin).
- `expo-build-properties` (SDK-53-matched `~0.14.8`, for the 15.1 deployment target).
- `expo-constants` — was **missing from the repo baseline** (a transitive of
  `@expo/metro-runtime`/`expo-router`); `expo export` failed on it before and for any
  feature, not this one. Installing it makes `expo export` green again. Unrelated to
  focus mode but required for the export to pass.
