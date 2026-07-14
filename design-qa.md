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

final result: passed
