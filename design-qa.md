**Source Visual Truth**

- `/Users/cj/Downloads/Screenshot 2026-07-14 at 09.43.27.png`.
- The source is a competitor reference, so the target is its clear location capability and switch—not a direct copy of its profile/skills screen.
- The existing Sidekick grouped Settings screen remains the product-specific layout and visual system.

**Implementation Evidence**

- Screenshot: `/Users/cj/Code/sidekick/plans/location-settings-implementation.png`.
- Full-view comparison: `/Users/cj/Code/sidekick/plans/location-settings-comparison.png`.
- Viewport: iPhone 17 Pro Simulator in portrait; screenshot captured at 1206 × 2622 physical pixels.
- State: authenticated fresh install, foreground location enabled, synthetic New York simulator coordinate shared through a local ephemeral backend, developer controls visible in the development build.

**Findings**

- No actionable P0, P1, or P2 differences remain.
- Fonts and typography: the implementation uses Sidekick's established iOS system typography. The 17-point Location label and 13-point supporting copy preserve a clear two-level hierarchy without clipping or awkward wrapping.
- Spacing and layout rhythm: the 76-point integration row, 40-point icon tile, native switch, continuous 14-point card radius, and 12-point internal gaps align with the existing grouped settings screen. The privacy explanation sits directly below the capability it describes.
- Colors and visual tokens: the screen preserves Sidekick's grouped gray background, white cards, blue accent, secondary-label gray, and native green enabled state. Contrast and grouping remain clear.
- Image quality and asset fidelity: location uses the native SF Symbol through Expo Symbols, which is the appropriate code-native asset for a standard platform icon. It renders sharply at device density with no placeholder or custom-drawn substitute.
- Copy and content: the row explains the user benefit, while the footer states foreground-only use, on-device coordinate disposal, and the exact city-level fields retained. The language is materially clearer about privacy than the reference.
- Interaction and states: the real native switch requested iOS “Allow While Using App” permission, reverse-geocoded the synthetic coordinate, and rendered `Sharing New York with your Sidekick`. Switching it off removed location from the live server context; switching it on again reused the saved foreground permission and restored New York. A denied permanent permission offers a route to system Settings.
- Responsiveness and accessibility: the primary row, switch, privacy copy, and navigation fit the phone viewport with no horizontal overflow or clipped action. The native switch and Symbol retain platform behavior.

**Open Questions**

- None.

**Implementation Checklist**

- [x] Add the location capability to Sidekick's existing Settings screen.
- [x] Make foreground permission and app-level opt-in separate states.
- [x] Upload only reverse-geocoded city/region/country and discard coordinates on-device.
- [x] Delete the server copy and stop refreshes when switched off.
- [x] Add coarse location to the agent's dynamic context.
- [x] Verify the native layout in the iPhone simulator.
- [x] Exercise enable, native permission, city display, agent context, disable, and re-enable against an authenticated local test backend.

**Comparison History**

- Pass 1: the native simulator capture preserves the reference's clear icon/title/description/switch relationship while intentionally using Sidekick's grouped settings language. No actionable P0/P1/P2 mismatch was found.
- Pass 2: a clean authenticated install used a synthetic New York coordinate. The native permission prompt, on-device reverse geocode, server update, agent context, disconnect deletion, and permission-preserving re-enable all completed successfully. The run exposed a switch loading-state issue after disconnect; invalidation was made non-blocking and the full off→on cycle then passed.

**Focused Region Rationale**

- A separate focused crop was not needed because the location row, native switch, and privacy footer are fully legible in the 1178-pixel-wide full-view comparison.

## Focus and Apple Health

**Source Visual Truth**

- `/Users/cj/Downloads/Screenshot 2026-07-14 at 09.43.27.png` and the four Focus screenshots captured between 09:48 and 09:49.
- The screenshots are competitive references. The implementation preserves the understandable capability, permission, app-selection, limit, and active-state hierarchy while using Sidekick's grouped iOS settings language and original copy.

**Implementation Evidence**

- Settings comparison: `/Users/cj/Code/sidekick/plans/qa/settings-polish-comparison.png`.
- Focus intro comparison: `/Users/cj/Code/sidekick/plans/qa/focus-polish-comparison.png`.
- Final Focus intro: `/Users/cj/Code/sidekick/plans/qa/focus-polished-final.png`.
- Final Apple Health intro: `/Users/cj/Code/sidekick/plans/qa/health-polished-final.png`.
- Viewport: iPhone 17 Pro Simulator in portrait at 944 × 2048 physical pixels.

**Findings**

- No actionable P0, P1, or P2 visual differences remain. Settings uses the existing Sidekick grouped layout; Focus and Health use platform-native symbols, continuous corners, system typography, and clear bottom actions.
- Focus is visually distinct from the reference: it replaces the competitor mascot illustration with a native shield, uses original benefit-led copy, and makes the on-device selection boundary explicit.
- Apple Health clearly enumerates the four shared summary groups and separates Apple authorization from explicit Sidekick/AI sharing consent.
- Long content scrolls beneath a persistent primary action with enough bottom inset to reach every privacy disclosure.
- Accessibility inspection exposed meaningful labels for Settings rows, the Location switch, both integration disclosures, all four Health data groups, and the primary actions.

**Interaction Verification**

- Focus opened from the real native build, requested Apple's individual Screen Time authorization, and reached Apple's passcode-protected authorization sheet.
- This polish pass ran the authenticated app against the local server, opened Settings, Focus, and Apple Health through the app's real router, and captured each rendered native screen. The integration rows, modal navigation, authenticated foreground services, and final layouts rendered without a redbox or clipped horizontal content.
- Simulator home verification: `/Users/cj/Code/sidekick/plans/qa/simulator-static-fallback.png` confirms the app uses the lightweight static mascot and never initializes the GL renderer on Simulator.
- The final app/category picker, device-activity thresholds, and HealthKit data reads require a physical iPhone with the distribution entitlements and user-owned data; they cannot be proven in the simulator.
- Type checking, unit/integration tests, changed-file lint, and the native iOS build cover the application logic and extension wiring separately from that physical-device gate.

**Implementation Checklist**

- [x] Add Focus and Apple Health disclosures to Settings.
- [x] Build native Screen Time authorization, Apple app/category/site selection, daily limits, weekday schedules, manual blocking, timed sessions, temporary unlock, re-block, and disable flows.
- [x] Keep opaque Screen Time selection tokens and configuration on-device and expose only minimal command success to the agent.
- [x] Add explicit Apple Health/AI sharing consent for steps, sleep, workouts, and active energy.
- [x] Retain at most 30 days of Health summaries and delete stored summaries on disconnect.
- [x] Mark Health-derived assistant output sensitive and exclude it from advertising context.
- [x] Compare the native Settings and Focus screens side-by-side with the references.
- [x] Verify the Apple Screen Time system authorization handoff in the simulator.
- [x] Move foreground refreshes behind authentication and refresh visible Settings state after successful sync.
- [x] Add agent guidance for natural, coverage-aware, non-diagnostic Health responses.
- [x] Make Focus quick actions single-flight and reject false-positive unlocks without a guarded selection.
- [x] Tighten the Focus and Health hierarchy so the benefit, privacy boundary, and primary action fit cleanly in the modal viewport.
- [ ] Complete the final Screen Time picker/enforcement and HealthKit sample read on a signed physical iPhone.

**Comparison History**

- Earlier pass: Focus and Health were functionally complete, but the intro hierarchy was looser and foreground services could run before authentication.
- Polish pass: reduced hero scale and vertical gaps, kept all four Health summary groups visible, corrected the light-screen status bar, added honest action error/loading states, and moved integration refresh behind authentication.
- Final comparison: the combined source/implementation images show a distinct Sidekick design with equivalent permission clarity, stronger privacy copy, balanced vertical rhythm, and no remaining P0/P1/P2 mismatch. Focus uses a native shield instead of copying the competitor illustration; Health uses the same card and typography system as Sidekick Settings.

**Focused Region Evidence**

- The combined full-height comparisons keep the reference and implementation at the same 944 × 2048 viewport. The primary headers, benefit copy, integration rows, icons, controls, and bottom actions are legible at original resolution, so a separate focused crop was not needed.

final result: passed
