import * as THREE from "three";
import type { SidekickSettings } from "./sidekick-settings";

// Skin "material lab" for the Asset Manager. ONE shader — the cel two-tone + rim
// core (identical to makeCelMaterial) plus a stack of optional, uniform-driven
// surface effects. Every distinct "material" is just a set of MaterialParams;
// there is a single GLSL program for all of them.
//
// PORTABILITY: this is deliberately the same recipe expo already ships — a
// MeshToonMaterial with an onBeforeCompile fragment injection, standard GLSL
// only (no float RTs / derivatives / extensions). Porting to expo's shading.ts
// is a copy; the looks are all data (MaterialParams). Verify on a real iOS
// device before shipping (expo-gl quirks).

// A material = a preset of these. All default to 0 / neutral, i.e. plain cel.
export type MaterialParams = {
	irid?: number; // iridescent thin-film sheen 0..1
	iridScale?: number; // hue frequency (default 3)
	spec?: number; // specular hotspot strength 0..1
	specPower?: number; // hotspot tightness (default 40; higher = tighter)
	specColor?: string; // hotspot color (default white)
	velvet?: number; // fabric look: tint the facing area 0..1
	velvetColor?: string; // velvet core tint (default near-black)
	emissive?: number; // self-glow in the base color 0..1
	rimBoost?: number; // extra rim on top of the settings rim
};

const c3 = (hex: string | undefined, fallback: string) => new THREE.Color(hex ?? fallback);

export function makeSkinMaterial(
	s: SidekickSettings,
	opts: { params: MaterialParams; color?: string; map?: THREE.Texture | null },
): THREE.MeshToonMaterial {
	const scene = s.scenes[s.timeOfDay];
	const envTint = new THREE.Color(scene.charTint);
	const p = opts.params;
	const useMap = !!opts.map;
	const mat = new THREE.MeshToonMaterial({
		side: THREE.DoubleSide,
		color: new THREE.Color(useMap ? "#ffffff" : (opts.color ?? s.tint)).multiply(envTint),
		map: opts.map ?? null,
	});
	const u = {
		// --- cel core (verbatim from makeCelMaterial) ---
		uKeyDir: { value: new THREE.Vector3(2, 3, 2).normalize() },
		uCelSoft: { value: 0.015 + 0.6 * THREE.MathUtils.clamp(s.celSoftness, 0, 1) },
		uCelShadow: { value: new THREE.Color(scene.shadeColor).multiply(envTint) },
		uCelAmt: { value: s.celShadowAmt },
		uRimColor: { value: new THREE.Color(s.celRimColor).multiply(envTint) },
		uRimStrength: { value: s.celRimStrength },
		uRimWidth: { value: s.celRimWidth },
		// --- effect stack ---
		uIrid: { value: p.irid ?? 0 },
		uIridScale: { value: p.iridScale ?? 3 },
		uSpec: { value: p.spec ?? 0 },
		uSpecPower: { value: p.specPower ?? 40 },
		uSpecColor: { value: c3(p.specColor, "#ffffff") },
		uVelvet: { value: p.velvet ?? 0 },
		uVelvetColor: { value: c3(p.velvetColor, "#050a14") },
		uEmissive: { value: p.emissive ?? 0 },
		uRimBoost: { value: p.rimBoost ?? 0 },
	};
	mat.onBeforeCompile = (shader) => {
		Object.assign(shader.uniforms, u);
		shader.fragmentShader =
			`uniform vec3 uKeyDir;
			uniform float uCelSoft;
			uniform vec3 uCelShadow;
			uniform float uCelAmt;
			uniform vec3 uRimColor;
			uniform float uRimStrength;
			uniform float uRimWidth;
			uniform float uIrid;
			uniform float uIridScale;
			uniform float uSpec;
			uniform float uSpecPower;
			uniform vec3 uSpecColor;
			uniform float uVelvet;
			uniform vec3 uVelvetColor;
			uniform float uEmissive;
			uniform float uRimBoost;
			` +
			shader.fragmentShader.replace(
				"#include <opaque_fragment>",
				`{
					// --- cel core (identical to makeCelMaterial) ---
					vec3 Nw = inverseTransformDirection( normalize( normal ), viewMatrix );
					float ndl = dot( Nw, uKeyDir );
					float t = smoothstep( -uCelSoft, uCelSoft, ndl );
					vec3 tint = mix( vec3( 1.0 ), uCelShadow, uCelAmt );
					outgoingLight = diffuseColor.rgb * mix( tint, vec3( 1.0 ), t );
					float rimF = 1.0 - saturate( dot( normalize( vViewPosition ), normalize( normal ) ) );
					float rimBand = smoothstep( 1.0 - uRimWidth, min( 1.0, 1.0 - uRimWidth + 0.14 ), rimF );
					outgoingLight += uRimColor * ( uRimStrength * rimBand * ( 0.35 + 0.65 * t ) );
					// --- velvet: tint the facing area (edges stay bright) ---
					if ( uVelvet > 0.0 ) {
						outgoingLight = mix( outgoingLight, uVelvetColor, uVelvet * ( 1.0 - rimF ) );
					}
					// --- iridescent thin-film: hue cycles with view angle, strongest at grazing ---
					if ( uIrid > 0.0 ) {
						vec3 irid = 0.5 + 0.5 * cos( 6.28318 * ( uIridScale * rimF + vec3( 0.0, 0.33, 0.67 ) ) );
						outgoingLight = mix( outgoingLight, outgoingLight * 0.55 + irid * 0.9, uIrid * rimF );
					}
					// --- specular hotspot from a fixed view-space light ---
					if ( uSpec > 0.0 ) {
						float sp = pow( saturate( dot( normalize( normal ), normalize( vec3( 0.4, 0.7, 0.6 ) ) ) ), uSpecPower );
						outgoingLight += uSpecColor * ( sp * uSpec * t );
					}
					// --- extra rim boost ---
					outgoingLight += uRimColor * ( uRimBoost * rimBand );
					// --- emissive self-glow in the base color ---
					if ( uEmissive > 0.0 ) {
						outgoingLight += diffuseColor.rgb * uEmissive;
					}
				}
				#include <opaque_fragment>`,
			);
	};
	// one program for every material (effects branch on uniforms)
	mat.customProgramCacheKey = () => "sidekick-skin-lab";
	return mat;
}
