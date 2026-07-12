import sidekickPreset from "@sidekick/tailwind-config";

/** @type {import('tailwindcss').Config} */
export default {
	presets: [sidekickPreset],
	content: ["./index.html", "./src/**/*.{ts,tsx}"],
};
