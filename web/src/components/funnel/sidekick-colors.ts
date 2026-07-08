// The sidekick's customizable properties (color + name), shared by the color and
// name onboarding steps and stored in localStorage so the app can load
// color-specific assets later.
//
// NOTE: each color's hero is a separate AI-generated render, so the pose/framing
// isn't perfectly deterministic between colors (small differences). To be made
// deterministic later.
export type SidekickColor = { id: string; label: string; hex: string; asset: string };

export const SIDEKICK_COLORS: SidekickColor[] = [
	{ id: "yellow", label: "Amber", hex: "#E8A33D", asset: "/choose-color/yellow.webp" },
	{ id: "red", label: "Red", hex: "#DE3A32", asset: "/choose-color/red.webp" },
	{ id: "pink", label: "Pink", hex: "#EFB2BE", asset: "/choose-color/pink.webp" },
	{ id: "purple", label: "Purple", hex: "#D2A8E0", asset: "/choose-color/purple.webp" },
	{ id: "lightblue", label: "Blue", hex: "#7DB2E2", asset: "/choose-color/lightblue.webp" },
	{ id: "green", label: "Green", hex: "#89BB5A", asset: "/choose-color/green.webp" },
	{ id: "white", label: "White", hex: "#F2F2F2", asset: "/choose-color/white.webp" },
];

export function colorById(id: string): SidekickColor {
	return SIDEKICK_COLORS.find((c) => c.id === id) ?? SIDEKICK_COLORS[0];
}

export type SidekickProfile = { color: string; name: string };

const KEY = "sidekick_profile_v1";

export function loadProfile(): SidekickProfile {
	try {
		const raw = localStorage.getItem(KEY);
		if (raw) {
			const p = JSON.parse(raw) as Partial<SidekickProfile>;
			return { color: p.color ?? "yellow", name: p.name ?? "" };
		}
	} catch {
		// ignore corrupt storage
	}
	return { color: "yellow", name: "" };
}

export function saveProfile(patch: Partial<SidekickProfile>): SidekickProfile {
	const next = { ...loadProfile(), ...patch };
	try {
		localStorage.setItem(KEY, JSON.stringify(next));
	} catch {
		// ignore
	}
	return next;
}
