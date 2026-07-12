// @sidekick/core — platform-agnostic shared logic consumed by both apps.
//
// Populated incrementally (see docs/SYNC-PLAN.md). Rule of thumb: if it's a
// number, a color, a table, a formula, or a shader string, it belongs here —
// zero DOM / React Native imports. Renderer plumbing and UI stay in the apps.
//
// Planned first extractions: cosmetics manifest, settings/scene presets,
// face/bone tables, interaction spring math, grass layout math, GLSL sources.

export {};
