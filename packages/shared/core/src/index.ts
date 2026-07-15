// @sidekick/core — platform-agnostic logic + tables shared by the Expo app
// (production) and the Vite web app (dev reference). ZERO DOM / RN / expo
// imports: pure functions and data only, so both apps compute identically and
// can never drift. App layers own persistence (localStorage vs AsyncStorage)
// and UI; this owns the numbers.

export * from './rng';
export * from './economy';
export * from './bond';
export * from './streak';
export * from './daily-box';
export * from './goals';
