/**
 * Shared Tailwind preset for Sidekick apps (web + expo/nativewind).
 * Both apps should `presets: [sidekickPreset]` and add only platform-specific
 * `content` globs. Kept intentionally small — brand tokens live here so the two
 * apps can't drift on type/color. See docs/SYNC-PLAN.md.
 */

/** @type {import('tailwindcss').Config['theme']} */
export const sidekickTheme = {
	extend: {
		fontFamily: {
			sans: ['"ABC Diatype Rounded"', "ui-rounded", "system-ui", "sans-serif"],
		},
	},
};

/** @type {Omit<import('tailwindcss').Config, 'content'>} */
const sidekickPreset = {
	theme: sidekickTheme,
	plugins: [],
};

export default sidekickPreset;
