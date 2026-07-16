# Location settings

## Goal

Let a user explicitly share or stop sharing their coarse location, show what Sidekick currently knows, and include that city-level context in agent turns.

## Implementation

- Add a Location row to the existing grouped Settings screen with clear city-level privacy copy and an interactive switch.
- Persist an app-level location preference separately from the operating-system permission so switching the feature off remains off.
- On enable, request foreground-only permission, reverse-geocode on-device, upload only city/region/country/timezone, and refresh immediately.
- On disable, stop foreground refreshes and clear the stored server-side location.
- Render the stored coarse location in the agent's dynamic memory context.
- Cover the server context and disconnect behavior with tests, then run typecheck, lint, and the relevant test suite.
