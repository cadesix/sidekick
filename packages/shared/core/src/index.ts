// @sidekick/core — platform-agnostic logic + tables for the Sidekick app
// (packages/expo — one universal app: iOS + Expo Web). ZERO DOM / RN / expo
// imports: pure functions and data only, so every platform computes
// identically and can never drift. The app layer owns persistence
// (AsyncStorage / localStorage) and UI; this owns the numbers.

export * from './rng';
export * from './catalog';
export * from './catalog-variants';
export * from './economy';
export * from './bond';
export * from './streak';
export * from './daily-box';
export * from './shop';
export * from './sessions';
