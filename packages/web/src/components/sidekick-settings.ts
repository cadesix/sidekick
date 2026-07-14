import { type ScenePreset, type TimeOfDay, SCENE_DEFAULTS } from "./sidekick-scene";

// Shared look-dev settings for the 3D Sidekick. The /sidekick-3d route is the
// editor (lil-gui writes here on every change); /home3 reads the same state so
// lighting, material, and camera stay in sync across routes.

// v2: yellow_final.glb bakes the brand yellow into its albedo, so tint
// defaults to white — the key bump discards stale amber tints
export const SETTINGS_KEY = "sidekick3d-settings-v2";

export type ShadingMode = "physical" | "toon" | "ramp" | "gooch" | "halftone" | "sss" | "matcap" | "cel";

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
	// clean cel mode: one soft terminator, a tinted (multiply) shadow, no spec.
	// celBodyColor replaces the body's baked-shading albedo with a flat color —
	// the baked highlights are exactly what keep it from reading as clean cel
	celBodyColor: string;
	celShadowColor: string;
	celSoftness: number;
	celShadowAmt: number;
	// cel rim light: a fresnel edge band added on top of the two tones
	celRimColor: string;
	celRimStrength: number; // 0 = off (ships off; a look-dev dial)
	celRimWidth: number;
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
	// equipment / cosmetics (phase 1: a single skinned shirt slot)
	shirtEnabled: boolean;
	shirtColor: string;
	// idle pose (armature fine-tuning; radians)
	poseArmDown: number;
	poseArmTwist: number;
	poseRollSplit: number;
	poseArmForward: number;
	poseForeBend: number;
	// time-of-day scene: which preset is active + the per-time editable presets
	// (each drives sky + fog + grass + character tint + lights + exposure)
	timeOfDay: TimeOfDay;
	scenes: Record<TimeOfDay, ScenePreset>;
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
	// lens / depth-of-field / tilt-shift (editor post-processing)
	dofEnabled: boolean;
	dofFocus: number; // focus distance in world units
	dofAperture: number; // bokeh strength (×1e-4 in the GUI)
	dofMaxBlur: number;
	tiltEnabled: boolean;
	tiltFocusY: number; // screen-space band center (0 bottom → 1 top)
	tiltBand: number; // half-height of the sharp band
	tiltBlur: number; // max blur radius (px)
	// camera — null means "use the route's own default framing"
	fov: number;
	camPos: [number, number, number] | null;
	camTarget: [number, number, number] | null;
};

// baked from the cel-bloom-tilt-5173 checked-in preset (the prod look) so a
// FRESH user — e.g. straight out of the onboarding funnel — sees the approved
// look with no saved state. Face placement uses the corrected face-sheet-v6
// values (the preset predates the sheet fix), and the camera keeps the neutral
// default rather than the preset's pulled-back editor framing.
export const DEFAULT_SETTINGS: SidekickSettings = {
	shading: "cel",
	toonBands: 2,
	toonSoftness: 0.323,
	toonSpecStrength: 0,
	toonSpecSize: 0.132,
	toonRimStrength: 0.348,
	toonShadowColor: "#cc8d05",
	toonShadowAmt: 0.506,
	rampMid: "#ffb061",
	rampLight: "#ffedc4",
	celBodyColor: "#ffbb29",
	celShadowColor: "#c98f52",
	celSoftness: 0,
	celShadowAmt: 0.501,
	celRimColor: "#fff2dc",
	celRimStrength: 0,
	celRimWidth: 0.35,
	goochCool: "#7a86b8",
	goochWarm: "#fff1d6",
	halftoneScale: 7.432,
	sssColor: "#ce7036",
	sssStrength: 0.552,
	outline: false,
	outlineWidth: 0.00722,
	outlineColor: "#b77d1a",
	faceZoom: 1.0,
	faceHeight: 0.015,
	shirtEnabled: true,
	shirtColor: "#5c8ad6",
	poseArmDown: 1.29,
	poseArmTwist: 1.08,
	poseRollSplit: 0.08,
	poseArmForward: 0.25,
	poseForeBend: -0.13,
	timeOfDay: "evening",
	scenes: SCENE_DEFAULTS,
	skyTop: "#8aceff",
	skyHorizon: "#47d1ff",
	grassHill: "#fcffe5",
	grassBase: "#68bd00",
	grassTip: "#80db00",
	grassHeight: 1.18,
	grassClumping: 1,
	tint: "#ffffff",
	roughness: 1,
	clearcoat: 0,
	clearcoatRoughness: 0,
	sheen: 0,
	sheenRoughness: 0,
	sheenColor: "#ffb36b",
	emissiveColor: "#767323",
	emissiveIntensity: 0.08,
	exposure: 0.6757,
	envIntensity: 0.891,
	keyIntensity: 2.156,
	keyColor: "#336970",
	fillIntensity: 0.5,
	fillColor: "#baebf2",
	rimIntensity: 1.4,
	rimColor: "#fff8ec",
	hemiIntensity: 0.3,
	bloomEnabled: true,
	bloomStrength: 0.158,
	bloomRadius: 0.3885,
	bloomThreshold: 0.615,
	shadowOpacity: 0.2316,
	autoRotate: false,
	dofEnabled: false,
	dofFocus: 5.4,
	dofAperture: 2,
	dofMaxBlur: 0.01,
	tiltEnabled: true,
	tiltFocusY: 0.44,
	tiltBand: 0.12,
	tiltBlur: 7.2,
	fov: 19.455,
	camPos: [-0.8622328104178634, 0.8720766906255945, 5.542186848594252],
	camTarget: [0, 0.7, 0],
};

export function loadSettings(): SidekickSettings {
	try {
		const raw = localStorage.getItem(SETTINGS_KEY);
		if (!raw) return { ...DEFAULT_SETTINGS };
		const saved = JSON.parse(raw);
		const merged = { ...DEFAULT_SETTINGS, ...saved };
		// deep-merge the scene presets so newly-added preset fields survive an
		// older saved `scenes` object (shallow spread would drop them)
		const savedScenes = saved.scenes as Partial<Record<TimeOfDay, Partial<ScenePreset>>> | undefined;
		merged.scenes = {
			day: { ...SCENE_DEFAULTS.day, ...savedScenes?.day },
			evening: { ...SCENE_DEFAULTS.evening, ...savedScenes?.evening },
			night: { ...SCENE_DEFAULTS.night, ...savedScenes?.night },
		};
		return merged;
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
