/**
 * Shared Tailwind preset for Sidekick apps (web + expo/nativewind).
 * Both apps `presets: [...]` this and add only platform-specific content globs
 * and presets (nativewind on expo). Brand tokens live here so the two apps
 * can't drift on type/color. CommonJS on purpose: expo's tailwind.config.js
 * is CJS (`require`), and web's ESM config imports CJS fine.
 *
 * Note: this shares the *token* only. On expo, using `font-sans` additionally
 * requires loading the font file at runtime (expo-font) — not wired up yet;
 * web bundles the .ttf in public/fonts.
 */

/** @type {Omit<import('tailwindcss').Config, 'content'>} */
const sidekickPreset = {
	theme: {
		extend: {
			fontFamily: {
				sans: ['"ABC Diatype Rounded"', "ui-rounded", "system-ui", "sans-serif"],
			},
		},
	},
	plugins: [],
};

module.exports = sidekickPreset;
