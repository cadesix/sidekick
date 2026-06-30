// Branding placeholder. Swap this single constant (and drop a logo into /public)
// when the real product identity is ready — it's wired into the header + welcome.
export const PRODUCT_NAME = "Northstar";

// Sidekick — the product's mascot. Per-pose renders (glossy vinyl, flat white) live in
// /public, generated via the `illustrate` skill from the Sidekick character sheet.
export const CHARACTERS = {
	wave: "/sidekick-wave.webp", // welcome
	cheer: "/sidekick-cheer.webp", // transition
	think: "/sidekick-think.webp", // personality
} as const;

// --- Design system: pastel + solid-shadow ("neo-brutalist") ---
// App background (white).
export const APP_BG = "#FFFFFF";
// Rotating pastel fills for option cards/pills.
export const PASTELS = ["#FBF5D0", "#F6D2CB", "#DCF3EF", "#F1DAF6", "#DCE7FB"];
// Shared class fragments (kept here so Tailwind's JIT scans the literal arbitrary
// values). 2px black border + subtle 2px offset solid shadow + a pressed-in active state.
export const SOLID = "border-2 border-[#111] shadow-[2px_2px_0_0_#111]";
export const PRESS = "transition active:translate-x-[2px] active:translate-y-[2px] active:shadow-none";
// Black pill primary button (Get Started / Continue / Next).
export const BTN_PRIMARY =
	"w-full py-4 rounded-full bg-[#111] text-white text-base font-semibold border-2 border-[#111] shadow-[2px_2px_0_0_#111] transition active:translate-x-[2px] active:translate-y-[2px] active:shadow-none disabled:opacity-40 disabled:active:translate-x-0 disabled:active:translate-y-0";
