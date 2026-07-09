// Shared look-dev settings for the 3D Sidekick. The /sidekick-3d route is the
// editor (lil-gui writes here on every change); /home3 reads the same state so
// lighting, material, and camera stay in sync across routes.

// v2: yellow_final.glb bakes the brand yellow into its albedo, so tint
// defaults to white — the key bump discards stale amber tints
export const SETTINGS_KEY = "sidekick3d-settings-v2";

export type ShadingMode = "physical" | "toon" | "ramp" | "gooch" | "halftone" | "sss" | "matcap";

export type SidekickSettings = {
	// shading mode + stylized params (see sidekick-shading.ts)
	shading: ShadingMode;
	toonBands: number;
	toonSoftness: number;
	toonSpecStrength: number;
	toonSpecSize: number;
	toonRimStrength: number;
	toonShadowColor: string;
	toonShadowAmt: number;
	rampMid: string;
	rampLight: string;
	goochCool: string;
	goochWarm: string;
	halftoneScale: number;
	sssColor: string;
	sssStrength: number;
	outline: boolean;
	outlineWidth: number;
	outlineColor: string;
	// face sprite zoom (>1 = artwork bigger relative to the head)
	faceZoom: number;
	// face vertical placement in cell fractions (positive = higher on the head).
	// NOTE: renamed from faceOffsetY on purpose — stale saved values from the
	// pre-plane-move era kept overriding the centered default
	faceHeight: number;
	// idle pose (armature fine-tuning; radians)
	poseArmDown: number;
	poseArmTwist: number;
	poseRollSplit: number;
	poseArmForward: number;
	poseForeBend: number;
	// environment colors
	skyTop: string;
	skyHorizon: string;
	grassHill: string;
	grassBase: string;
	grassTip: string;
	grassHeight: number;
	grassClumping: number;
	// material
	tint: string;
	roughness: number;
	clearcoat: number;
	clearcoatRoughness: number;
	sheen: number;
	sheenRoughness: number;
	sheenColor: string;
	emissiveColor: string;
	emissiveIntensity: number;
	// lighting
	exposure: number;
	envIntensity: number;
	keyIntensity: number;
	keyColor: string;
	fillIntensity: number;
	fillColor: string;
	rimIntensity: number;
	rimColor: string;
	hemiIntensity: number;
	// bloom (viewer only — home3 renders on a transparent canvas, no post)
	bloomEnabled: boolean;
	bloomStrength: number;
	bloomRadius: number;
	bloomThreshold: number;
	// scene
	shadowOpacity: number;
	autoRotate: boolean;
	// camera — null means "use the route's own default framing"
	fov: number;
	camPos: [number, number, number] | null;
	camTarget: [number, number, number] | null;
};

// baked from the look-dev session of 2026-07-08 (copied out of the tuned
// localStorage state) so prod ships the approved look without any saved state
export const DEFAULT_SETTINGS: SidekickSettings = {
	shading: "sss",
	toonBands: 3,
	toonSoftness: 0.478,
	toonSpecStrength: 0,
	toonSpecSize: 0.275,
	toonRimStrength: 0.348,
	toonShadowColor: "#99670f",
	toonShadowAmt: 0.504,
	rampMid: "#ffb061",
	rampLight: "#ffedc4",
	goochCool: "#7a86b8",
	goochWarm: "#fff1d6",
	halftoneScale: 10,
	sssColor: "#ce7036",
	sssStrength: 0.552,
	outline: true,
	outlineWidth: 0.00722,
	outlineColor: "#b77d1a",
	faceZoom: 1.0,
	faceHeight: 0,
	poseArmDown: 0.18,
	poseArmTwist: 1,
	poseRollSplit: 0,
	poseArmForward: 0.15,
	poseForeBend: -1,
	skyTop: "#66d9ff",
	skyHorizon: "#c7f1ff",
	grassHill: "#498f24",
	grassBase: "#649825",
	grassTip: "#569400",
	grassHeight: 2.5,
	grassClumping: 0.39,
	tint: "#ffffff",
	roughness: 1,
	clearcoat: 0,
	clearcoatRoughness: 0,
	sheen: 0,
	sheenRoughness: 0,
	sheenColor: "#ffb36b",
	emissiveColor: "#767323",
	emissiveIntensity: 0.08,
	exposure: 0.7896,
	envIntensity: 1.038,
	keyIntensity: 1.1,
	keyColor: "#dac5a4",
	fillIntensity: 0.5,
	fillColor: "#baebf2",
	rimIntensity: 1.4,
	rimColor: "#fff8ec",
	hemiIntensity: 0.3,
	bloomEnabled: true,
	bloomStrength: 0.15,
	bloomRadius: 0.5,
	bloomThreshold: 0.92,
	shadowOpacity: 0,
	autoRotate: false,
	fov: 19.455,
	camPos: [-0.1624955088332611, 1.5336097879571755, 5.116429421879912],
	camTarget: [0, 0.7, 0],
};

export function loadSettings(): SidekickSettings {
	try {
		const raw = localStorage.getItem(SETTINGS_KEY);
		if (!raw) return { ...DEFAULT_SETTINGS };
		return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
	} catch {
		return { ...DEFAULT_SETTINGS };
	}
}

export function saveSettings(s: SidekickSettings): void {
	try {
		localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
	} catch {
		// storage full/blocked — nothing to do
	}
}
