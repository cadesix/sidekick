import { loadSettings, saveSettings } from "./sidekick-settings";
import { WARDROBE_EVENT } from "./sidekick-wardrobe";

// The sidekick's skin (cel body color + its darker shadow tint) — shared by
// the onboarding color pick and the Appearance sheet so there's one palette
// and one persistence path. applySkin saves to the shared settings (what the
// canvas reads at mount) and pings the wardrobe event so avatar snapshots and
// other outfit-derived surfaces regenerate; LIVE recolor of an already-mounted
// canvas goes through its handleRef.setColors alongside this.

export type SkinColor = { id: string; body: string; shadow: string };

export const SKIN_COLORS: SkinColor[] = [
	{ id: "sunny", body: "#f2b13c", shadow: "#c98f52" },
	{ id: "coral", body: "#f57e63", shadow: "#c85f4a" },
	{ id: "sky", body: "#5fa8e0", shadow: "#3f7db0" },
	{ id: "mint", body: "#6cc98f", shadow: "#4a9b6b" },
	{ id: "grape", body: "#a988e0", shadow: "#7d63b0" },
	{ id: "bubblegum", body: "#f28cc0", shadow: "#c86a99" },
];

export function applySkin(c: SkinColor): void {
	saveSettings({ ...loadSettings(), celBodyColor: c.body, celShadowColor: c.shadow });
	window.dispatchEvent(new CustomEvent(WARDROBE_EVENT)); // regenerate avatars
}

export function currentSkinId(): string {
	try {
		const body = loadSettings().celBodyColor.toLowerCase();
		return SKIN_COLORS.find((c) => c.body.toLowerCase() === body)?.id ?? SKIN_COLORS[0].id;
	} catch {
		return SKIN_COLORS[0].id;
	}
}
