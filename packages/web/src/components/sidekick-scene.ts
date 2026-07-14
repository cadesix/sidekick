import * as THREE from "three";

// Time-of-day scene presets. Each is a FULL environment look — sky gradient,
// fog, grass palette, character tint/shade, light rig, exposure — so switching
// day/evening/night changes the whole scene (sky AND ground AND character), and
// every value is editable per-preset from the /sidekick-3d panel.

export type TimeOfDay = "day" | "evening" | "night";

export type ScenePreset = {
	// sky gradient (top → mid → horizon)
	skyTop: string;
	skyMid: string;
	skyHorizon: string;
	fog: string;
	fogNear: number; // distance where fog starts
	fogFar: number; // distance where fog fully saturates
	// ground / grass palette
	grassHill: string;
	grassBase: string;
	grassTip: string;
	rock: string; // foreground rock base color
	// character
	charTint: string; // multiplies the cel body albedo
	shadeColor: string; // cel shadow tint
	// light rig
	keyColor: string;
	keyIntensity: number;
	fillColor: string;
	fillIntensity: number;
	rimColor: string;
	rimIntensity: number;
	hemiSky: string;
	hemiGround: string;
	hemiIntensity: number;
	exposure: number;
};

export const TIMES: TimeOfDay[] = ["day", "evening", "night"];

export const SCENE_DEFAULTS: Record<TimeOfDay, ScenePreset> = {
	day: {
		skyTop: "#3ea1cc",
		skyMid: "#6aa8e0",
		skyHorizon: "#dcecfb",
		fog: "#dcecfb",
		fogNear: 8,
		fogFar: 32.5,
		grassHill: "#c0d265",
		grassBase: "#519d2d",
		grassTip: "#93cf4f",
		rock: "#8b8f96",
		charTint: "#ffffff",
		shadeColor: "#c98f52",
		keyColor: "#fff4dc",
		keyIntensity: 1.5,
		fillColor: "#a9c9ff",
		fillIntensity: 0.5,
		rimColor: "#ffffff",
		rimIntensity: 1,
		hemiSky: "#dcefff",
		hemiGround: "#8a9560",
		hemiIntensity: 0.55,
		exposure: 0.92,
	},
	evening: {
		skyTop: "#40407a",
		skyMid: "#d18a72",
		skyHorizon: "#ffe0a0",
		fog: "#e8a877",
		fogNear: 0,
		fogFar: 76.5,
		grassHill: "#a69c36",
		grassBase: "#6fa13a",
		grassTip: "#b9c25e",
		rock: "#8a7a7e",
		charTint: "#f4bd8c",
		shadeColor: "#a86840",
		keyColor: "#ffb257",
		keyIntensity: 1.3,
		fillColor: "#5b6bc4",
		fillIntensity: 0.5,
		rimColor: "#ffe0a8",
		rimIntensity: 1.7,
		hemiSky: "#ffcf9a",
		hemiGround: "#3a3560",
		hemiIntensity: 0.5,
		exposure: 0.86,
	},
	night: {
		skyTop: "#0c0a29",
		skyMid: "#2c1a47",
		skyHorizon: "#5b407d",
		fog: "#26355c",
		fogNear: 0,
		fogFar: 12,
		grassHill: "#424601",
		grassBase: "#274115",
		grassTip: "#235421",
		rock: "#3a4358",
		charTint: "#7e8ec2",
		shadeColor: "#3a4a70",
		keyColor: "#aebfe6",
		keyIntensity: 0.65,
		fillColor: "#3a4a80",
		fillIntensity: 0.4,
		rimColor: "#cdd8f5",
		rimIntensity: 0.8,
		hemiSky: "#2a3a66",
		hemiGround: "#0f1529",
		hemiIntensity: 0.36,
		exposure: 2,
	},
};

// full-gradient sky texture for a scene preset (top → mid → horizon). Takes just
// the sky-color fields so biome presets (which share them) can reuse it.
export function makeSky(sc: Pick<ScenePreset, "skyTop" | "skyMid" | "skyHorizon">): THREE.CanvasTexture {
	const c = document.createElement("canvas");
	c.width = 4;
	c.height = 512;
	const x = c.getContext("2d")!;
	const g = x.createLinearGradient(0, 0, 0, 512);
	g.addColorStop(0, sc.skyTop);
	g.addColorStop(0.58, sc.skyMid);
	g.addColorStop(1, sc.skyHorizon);
	x.fillStyle = g;
	x.fillRect(0, 0, 4, 512);
	const tex = new THREE.CanvasTexture(c);
	tex.colorSpace = THREE.SRGBColorSpace;
	return tex;
}
