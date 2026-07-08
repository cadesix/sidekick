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
	faceScale: number;
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

export const DEFAULT_SETTINGS: SidekickSettings = {
	shading: "physical",
	toonBands: 3,
	toonSoftness: 0.25,
	toonSpecStrength: 0.35,
	toonSpecSize: 0.35,
	toonRimStrength: 0.25,
	toonShadowColor: "#d97b4f",
	toonShadowAmt: 0.35,
	rampMid: "#f0a860",
	rampLight: "#ffedc4",
	goochCool: "#7a86b8",
	goochWarm: "#fff1d6",
	halftoneScale: 10,
	sssColor: "#ff9e63",
	sssStrength: 0.4,
	outline: false,
	outlineWidth: 0.006,
	outlineColor: "#4a2c17",
	faceScale: 1.15,
	poseArmDown: 1.15,
	poseArmTwist: 1.35,
	poseRollSplit: 0.5,
	poseArmForward: 0,
	poseForeBend: -0.3,
	skyTop: "#b8dcf2",
	skyHorizon: "#eef7ee",
	grassHill: "#4d9634",
	grassBase: "#3f8a2c",
	grassTip: "#a5d75e",
	grassHeight: 1,
	grassClumping: 0,
	tint: "#ffffff",
	roughness: 0.26,
	clearcoat: 1.0,
	clearcoatRoughness: 0.22,
	sheen: 0.55,
	sheenRoughness: 0.4,
	sheenColor: "#ffb36b",
	emissiveColor: "#3d1a05",
	emissiveIntensity: 0.08,
	exposure: 0.95,
	envIntensity: 1.0,
	keyIntensity: 1.1,
	keyColor: "#fff0da",
	fillIntensity: 0.5,
	fillColor: "#ffc9d0",
	rimIntensity: 1.4,
	rimColor: "#fff8ec",
	hemiIntensity: 0.3,
	bloomEnabled: true,
	bloomStrength: 0.15,
	bloomRadius: 0.5,
	bloomThreshold: 0.92,
	shadowOpacity: 0.16,
	autoRotate: false,
	fov: 35,
	camPos: null,
	camTarget: null,
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
