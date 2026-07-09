import * as THREE from "three";
import type { SidekickSettings } from "./sidekick-settings";

// Shared shading system for the 3D Sidekick. Both routes (/sidekick-3d editor,
// /home3 canvas) build their character materials and environment light through
// this module so the character renders identically everywhere.
//
// Three modes:
//  - physical: MeshPhysicalMaterial vinyl (clearcoat/sheen), lit by the env map
//  - toon:     MeshToonMaterial + injected stepped specular, fresnel rim, and
//              warm shadow tint (cel look; hides small shading blemishes)
//  - matcap:   MeshMatcapMaterial — the entire shading model comes from a
//              matcap image. Drop a Cycles-rendered sphere at /public/matcap.png
//              to get the Blender look verbatim; until then a procedural
//              vinyl-ish matcap is generated as a stand-in.

export const FACE_COLOR = "#dd9d43"; // flat yellow sampled from the body albedo

// bump ?v= on every reimport of the GLB so browsers can't serve a stale copy
export const MODEL_URL = "/sidekick-rigged.glb?v=13";

// midday sun direction (end-goal vista): high and to the upper-right-front for
// bright, soft-shadowed light. Drives the scene light rig.
export const SUN_DIR = new THREE.Vector3(2.6, 4.4, 2.2).normalize();

export type TexSet = {
	map: THREE.Texture | null;
	normalMap: THREE.Texture | null;
	vertexColors: boolean;
};

// warm sunset studio: gradient sky + colored light panels, PMREM'd into an
// environment map — this is what gives the vinyl its warm/pink reflections
export function makeEnvScene(): THREE.Scene {
	const env = new THREE.Scene();

	const skyCanvas = document.createElement("canvas");
	skyCanvas.width = 4;
	skyCanvas.height = 256;
	const sctx = skyCanvas.getContext("2d")!;
	const grad = sctx.createLinearGradient(0, 0, 0, 256);
	grad.addColorStop(0, "#ffe6c9");
	grad.addColorStop(0.5, "#f7c6b6");
	grad.addColorStop(1, "#e8b09e");
	sctx.fillStyle = grad;
	sctx.fillRect(0, 0, 4, 256);
	const skyTex = new THREE.CanvasTexture(skyCanvas);
	skyTex.colorSpace = THREE.SRGBColorSpace;
	const sky = new THREE.Mesh(
		new THREE.SphereGeometry(10, 16, 16),
		new THREE.MeshBasicMaterial({ map: skyTex, side: THREE.BackSide }),
	);
	env.add(sky);

	const panel = (color: number, intensity: number, pos: [number, number, number], size: [number, number]) => {
		const p = new THREE.Mesh(
			new THREE.PlaneGeometry(...size),
			new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity) }),
		);
		p.position.set(...pos);
		p.lookAt(0, 0, 0);
		env.add(p);
	};
	panel(0xfff2dc, 3.5, [3, 4, 3], [4, 4]); // warm key
	panel(0xffc9d8, 1.5, [-4, 1, 2], [3, 4]); // pink fill
	panel(0xfff8f0, 2.5, [-1, 3, -4], [5, 2]); // rim
	return env;
}

// ---- physical ----

export function makePhysicalMaterial(s: SidekickSettings, tex: TexSet, colorOverride?: string): THREE.MeshPhysicalMaterial {
	return new THREE.MeshPhysicalMaterial({
		// double-sided: the head shell's open hem shows its inner surface at
		// some angles — single-sided leaves see-through slivers at the neck
		side: THREE.DoubleSide,
		color: new THREE.Color(colorOverride ?? s.tint),
		map: colorOverride ? null : tex.map,
		normalMap: colorOverride ? null : tex.normalMap,
		vertexColors: colorOverride ? false : tex.vertexColors,
		roughness: s.roughness,
		clearcoat: s.clearcoat,
		clearcoatRoughness: s.clearcoatRoughness,
		sheen: s.sheen,
		sheenRoughness: s.sheenRoughness,
		sheenColor: new THREE.Color(s.sheenColor),
		// warm emissive lift in the shadows fakes subsurface scattering
		emissive: new THREE.Color(s.emissiveColor),
		emissiveIntensity: s.emissiveIntensity,
	});
}

// ---- stylized family: toon / ramp / halftone / gooch ----

// quantized band level (0..1) at ramp position x, with soft step transitions
function bandLevel(x: number, n: number, softness: number): number {
	const w = Math.max(0.002, THREE.MathUtils.clamp(softness, 0, 1) * 0.5) / n;
	let steps = 0;
	for (let k = 1; k < n; k++) steps += THREE.MathUtils.smoothstep(x, k / n - w, k / n + w);
	return steps / (n - 1);
}

// grayscale ramp: softness 0 = razor-hard cel steps, 1 = smooth painterly ramp
function makeToonRamp(bands: number, softness: number): THREE.DataTexture {
	const n = Math.max(2, Math.min(5, Math.round(bands)));
	const res = 256;
	const data = new Uint8Array(res * 4);
	for (let p = 0; p < res; p++) {
		const v = Math.round(255 * (0.28 + 0.72 * bandLevel(p / (res - 1), n, softness)));
		data.set([v, v, v, 255], p * 4);
	}
	const tex = new THREE.DataTexture(data, res, 1, THREE.RGBAFormat);
	tex.minFilter = tex.magFilter = THREE.LinearFilter;
	tex.generateMipmaps = false;
	tex.needsUpdate = true;
	return tex;
}

// colored ramp: bands sample a shadow→mid→light color gradient instead of
// gray levels — often the difference between "toon demo" and "art-directed"
function makeColoredRamp(s: SidekickSettings): THREE.DataTexture {
	const n = Math.max(2, Math.min(5, Math.round(s.toonBands)));
	const stops = [new THREE.Color(s.toonShadowColor), new THREE.Color(s.rampMid), new THREE.Color(s.rampLight)];
	const sample = (t: number) =>
		t < 0.5
			? stops[0].clone().lerp(stops[1], t * 2)
			: stops[1].clone().lerp(stops[2], (t - 0.5) * 2);
	const res = 256;
	const data = new Uint8Array(res * 4);
	const rgb = { r: 0, g: 0, b: 0 };
	for (let p = 0; p < res; p++) {
		const c = sample(bandLevel(p / (res - 1), n, s.toonSoftness));
		c.getRGB(rgb);
		data.set([Math.round(rgb.r * 255), Math.round(rgb.g * 255), Math.round(rgb.b * 255), 255], p * 4);
	}
	const tex = new THREE.DataTexture(data, res, 1, THREE.RGBAFormat);
	tex.minFilter = tex.magFilter = THREE.LinearFilter;
	tex.generateMipmaps = false;
	tex.needsUpdate = true;
	return tex;
}

// toonSpecSize 0..1 → smoothstep threshold on the specular lobe (bigger = bigger dot)
const specEdge = (size: number) => 1 - 0.75 * THREE.MathUtils.clamp(size, 0, 1);

type StylizedVariant = "toon" | "ramp" | "halftone" | "gooch";

// per-variant treatment of the shade side; shared preamble computes N/V/ndl,
// the stepped specular `hi`, fresnel `fres`, and `shade` (0 lit → 1 shadow)
const STYLIZED_MID: Record<StylizedVariant, string> = {
	toon: `outgoingLight = mix( outgoingLight, outgoingLight * uShadowTint, shade * uShadowAmt );`,
	ramp: ``, // shadow color lives in the gradientMap itself
	halftone: `
		vec2 hc = mat2( 0.7071, -0.7071, 0.7071, 0.7071 ) * gl_FragCoord.xy;
		float hd = length( fract( hc / uHalftoneScale ) - 0.5 );
		float hr = 0.45 * shade;
		float inDot = 1.0 - smoothstep( hr - 0.06, hr + 0.06, hd );
		outgoingLight = mix( outgoingLight, outgoingLight * uShadowTint * 0.85, inDot * min( 1.0, uShadowAmt * 2.0 ) );`,
	gooch: `outgoingLight = mix( diffuseColor.rgb * uGoochCool, diffuseColor.rgb * uGoochWarm, smoothstep( -0.5, 0.9, ndl ) );`,
};

export function makeStylizedMaterial(
	s: SidekickSettings,
	tex: TexSet,
	variant: StylizedVariant,
	colorOverride?: string,
): THREE.MeshToonMaterial {
	// NOTE: no normalMap on purpose — the baked normal map's micro-detail gets
	// amplified into a faceted patchwork by band quantization; stylized modes
	// shade from the smooth interpolated vertex normals only
	const mat = new THREE.MeshToonMaterial({
		side: THREE.DoubleSide, // see makePhysicalMaterial — open head-shell hem
		color: new THREE.Color(colorOverride ?? s.tint),
		map: colorOverride ? null : tex.map,
		vertexColors: colorOverride ? false : tex.vertexColors,
		gradientMap: variant === "ramp" ? makeColoredRamp(s) : makeToonRamp(s.toonBands, s.toonSoftness),
	});

	const u = {
		uKeyDir: { value: new THREE.Vector3(2, 3, 2).normalize() }, // matches the key light
		uSpecEdge: { value: specEdge(s.toonSpecSize) },
		uSpecStrength: { value: s.toonSpecStrength },
		uRimStrength: { value: s.toonRimStrength },
		uRimColor: { value: new THREE.Color("#fff3e2") },
		uShadowTint: { value: new THREE.Color(s.toonShadowColor) },
		uShadowAmt: { value: s.toonShadowAmt },
		uHalftoneScale: { value: s.halftoneScale },
		uGoochCool: { value: new THREE.Color(s.goochCool) },
		uGoochWarm: { value: new THREE.Color(s.goochWarm) },
	};

	mat.onBeforeCompile = (shader) => {
		Object.assign(shader.uniforms, u);
		shader.fragmentShader =
			`uniform vec3 uKeyDir;
			uniform float uSpecEdge;
			uniform float uSpecStrength;
			uniform float uRimStrength;
			uniform vec3 uRimColor;
			uniform vec3 uShadowTint;
			uniform float uShadowAmt;
			uniform float uHalftoneScale;
			uniform vec3 uGoochCool;
			uniform vec3 uGoochWarm;
			` +
			shader.fragmentShader.replace(
				"#include <opaque_fragment>",
				`{
					vec3 N = normalize( normal );
					vec3 V = normalize( vViewPosition );
					vec3 Nw = inverseTransformDirection( N, viewMatrix );
					vec3 Lv = normalize( ( viewMatrix * vec4( uKeyDir, 0.0 ) ).xyz );
					float ndl = dot( Nw, uKeyDir );
					float spec = pow( max( dot( N, normalize( Lv + V ) ), 0.0 ), 48.0 );
					float hi = smoothstep( uSpecEdge - 0.03, uSpecEdge + 0.03, spec );
					float fres = pow( 1.0 - saturate( dot( N, V ) ), 3.0 );
					float shade = 1.0 - smoothstep( -0.1, 0.45, ndl );
					${STYLIZED_MID[variant]}
					outgoingLight += hi * uSpecStrength * vec3( 1.0 );
					outgoingLight += fres * uRimStrength * uRimColor;
				}
				#include <opaque_fragment>`,
			);
	};
	// distinct injections must not share three's compiled-program cache
	mat.customProgramCacheKey = () => `sidekick-${variant}`;
	return mat;
}

// ---- cel: the clean flat-illustration look ----
// A single soft terminator against a FIXED key direction (not the scene lights),
// so the result is exactly two tones — full albedo in light, albedo × a warm
// multiply tint in shadow — with a pixel-clean, resolution-independent boundary.
// Ignoring the scene's fill/rim/env is the whole trick: multi-light toon shading
// stacks several terminators and colored bounces, which is what makes stock
// cel-shaders look muddy. Pair with the inverted-hull outline for the ink edge.
export function makeCelMaterial(
	s: SidekickSettings,
	tex: TexSet,
	colorOverride?: string,
): THREE.MeshToonMaterial {
	// the cel body + shadow shift with the active time-of-day scene (warmer at
	// evening, cool + dim at night) so the character reads as part of the scene
	const scene = s.scenes[s.timeOfDay];
	const envTint = new THREE.Color(scene.charTint);
	const mat = new THREE.MeshToonMaterial({
		side: THREE.DoubleSide, // open head-shell hem (see makePhysicalMaterial)
		color: new THREE.Color(colorOverride ?? s.tint).multiply(envTint),
		map: colorOverride ? null : tex.map,
		vertexColors: colorOverride ? false : tex.vertexColors,
	});
	const u = {
		uKeyDir: { value: new THREE.Vector3(2, 3, 2).normalize() }, // matches the key light
		uCelSoft: { value: 0.015 + 0.6 * THREE.MathUtils.clamp(s.celSoftness, 0, 1) },
		uCelShadow: { value: new THREE.Color(scene.shadeColor).multiply(envTint) },
		uCelAmt: { value: s.celShadowAmt },
	};
	mat.onBeforeCompile = (shader) => {
		Object.assign(shader.uniforms, u);
		shader.fragmentShader =
			`uniform vec3 uKeyDir;
			uniform float uCelSoft;
			uniform vec3 uCelShadow;
			uniform float uCelAmt;
			` +
			shader.fragmentShader.replace(
				"#include <opaque_fragment>",
				`{
					vec3 Nw = inverseTransformDirection( normalize( normal ), viewMatrix );
					float ndl = dot( Nw, uKeyDir );
					float t = smoothstep( -uCelSoft, uCelSoft, ndl );
					vec3 tint = mix( vec3( 1.0 ), uCelShadow, uCelAmt );
					outgoingLight = diffuseColor.rgb * mix( tint, vec3( 1.0 ), t );
				}
				#include <opaque_fragment>`,
			);
	};
	mat.customProgramCacheKey = () => "sidekick-cel";
	return mat;
}

// ---- sss: physical vinyl + warm translucent edge glow (fake subsurface) ----

export function makeSssMaterial(s: SidekickSettings, tex: TexSet, colorOverride?: string): THREE.MeshPhysicalMaterial {
	const mat = makePhysicalMaterial(s, tex, colorOverride);
	const u = {
		uSssColor: { value: new THREE.Color(s.sssColor) },
		uSssStrength: { value: s.sssStrength },
	};
	mat.onBeforeCompile = (shader) => {
		Object.assign(shader.uniforms, u);
		shader.fragmentShader =
			`uniform vec3 uSssColor;
			uniform float uSssStrength;
			` +
			shader.fragmentShader.replace(
				"#include <opaque_fragment>",
				`{
					float f = pow( 1.0 - saturate( dot( normalize( normal ), normalize( vViewPosition ) ) ), 3.0 );
					outgoingLight += uSssColor * uSssStrength * f;
				}
				#include <opaque_fragment>`,
			);
	};
	mat.customProgramCacheKey = () => "sidekick-sss";
	return mat;
}

// ---- outline: inverted-hull silhouette line, composable with any mode ----

// skinned-mesh friendly: displaces along the (already skinned) normal right
// before projection, so the hull follows animation
export function makeOutlineMaterial(s: SidekickSettings): THREE.MeshLambertMaterial {
	const mat = new THREE.MeshLambertMaterial({
		color: 0x000000, // black diffuse = no light response; emissive is the line color
		emissive: new THREE.Color(s.outlineColor),
		side: THREE.BackSide,
	});
	const u = { uOutlineWidth: { value: s.outlineWidth * 0.2 } }; // raw model is 0.2 units tall
	mat.onBeforeCompile = (shader) => {
		Object.assign(shader.uniforms, u);
		shader.vertexShader =
			"uniform float uOutlineWidth;\n" +
			shader.vertexShader.replace(
				"#include <project_vertex>",
				"transformed += normalize( objectNormal ) * uOutlineWidth;\n#include <project_vertex>",
			);
	};
	mat.customProgramCacheKey = () => "sidekick-outline";
	return mat;
}

// ---- mode dispatch ----

// builds the body+face material pair for the active mode; matcap falls back
// to physical until the matcap texture has loaded. When the face sprite
// sheet is available the face plane samples it (same material family as the
// body, so the face reads as printed on the vinyl); otherwise it gets a
// flat-albedo fill so the head hole is covered.
export function makeCharacterMaterials(
	s: SidekickSettings,
	tex: TexSet,
	matcapTex: THREE.Texture | null,
	faceTex?: THREE.Texture | null,
): { body: THREE.Material; face: THREE.Material } {
	const faceSet: TexSet | null = faceTex
		? { map: faceTex, normalMap: null, vertexColors: false }
		: null;
	// the sheet carries alpha (only the features are opaque) — the head is
	// sealed under the plane, so transparency lets its own shading show
	// through instead of a flat color disc that can't match the albedo
	const withAlpha = (m: THREE.Material): THREE.Material => {
		if (faceSet) {
			m.transparent = true;
			m.alphaTest = 0.02;
		}
		return m;
	};
	switch (s.shading) {
		case "toon":
		case "ramp":
		case "halftone":
		case "gooch":
			return {
				body: makeStylizedMaterial(s, tex, s.shading),
				face: faceSet
					? withAlpha(makeStylizedMaterial(s, faceSet, s.shading))
					: makeStylizedMaterial(s, tex, s.shading, FACE_COLOR),
			};
		case "cel":
			// body drops its baked-shading albedo for a flat brand color (that
			// baked shading is what keeps it from reading clean); the face keeps
			// its sprite map so the features still show
			return {
				body: makeCelMaterial(s, tex, s.celBodyColor),
				face: faceSet ? withAlpha(makeCelMaterial(s, faceSet)) : makeCelMaterial(s, tex, FACE_COLOR),
			};
		case "sss":
			return {
				body: makeSssMaterial(s, tex),
				face: faceSet ? withAlpha(makeSssMaterial(s, faceSet)) : makeSssMaterial(s, tex, FACE_COLOR),
			};
		case "matcap":
			if (matcapTex)
				return {
					body: makeMatcapMaterial(s, tex, matcapTex),
					face: faceSet
						? withAlpha(makeMatcapMaterial(s, faceSet, matcapTex))
						: makeMatcapMaterial(s, tex, matcapTex, FACE_COLOR),
				};
			break;
		default:
			break;
	}
	return {
		body: makePhysicalMaterial(s, tex),
		face: faceSet ? withAlpha(makePhysicalMaterial(s, faceSet)) : makePhysicalMaterial(s, tex, FACE_COLOR),
	};
}

// A cosmetic variant's look: either a flat color OR an albedo map, plus optional
// PBR overrides (satin/neon/metallic). Map wins over color when present.
export type ItemLook = {
	color?: string;
	map?: THREE.Texture | null;
	roughness?: number;
	metalness?: number;
	emissive?: string;
};

// builds a single item material (shirt/hat/…) in the ACTIVE shading mode, so
// cosmetics read in the same family as the body. A textured variant supplies a
// map; a plain one supplies a color. Optional params tweak the surface.
export function makeItemMaterial(
	s: SidekickSettings,
	look: ItemLook,
	matcapTex: THREE.Texture | null,
): THREE.Material {
	// the factories treat colorOverride and map as mutually exclusive (a color
	// nulls the map), so pick one: a mapped variant renders the map at full
	// color (tint white); a plain one renders the solid color with no map.
	const tex: TexSet = { map: look.map ?? null, normalMap: null, vertexColors: false };
	const color = look.map ? undefined : look.color ?? "#ffffff";
	let mat: THREE.Material;
	switch (s.shading) {
		case "toon":
		case "ramp":
		case "halftone":
		case "gooch":
			mat = makeStylizedMaterial(s, tex, s.shading, color);
			break;
		case "cel":
			mat = makeCelMaterial(s, tex, color);
			break;
		case "sss":
			mat = makeSssMaterial(s, tex, color);
			break;
		case "matcap":
			mat = matcapTex
				? makeMatcapMaterial(s, tex, matcapTex, color)
				: makePhysicalMaterial(s, tex, color);
			break;
		default:
			mat = makePhysicalMaterial(s, tex, color);
	}
	// per-variant surface overrides (guarded — matcap has none of these)
	const m = mat as THREE.MeshPhysicalMaterial;
	if (look.roughness !== undefined && "roughness" in m) m.roughness = look.roughness;
	if (look.metalness !== undefined && "metalness" in m) m.metalness = look.metalness;
	if (look.emissive !== undefined && "emissive" in m) m.emissive = new THREE.Color(look.emissive);
	return mat;
}

// ---- matcap ----

// procedural vinyl-ish matcap used until public/matcap.png exists; mostly
// neutral-bright so the albedo map supplies the color
function makeFallbackMatcap(): THREE.Texture {
	const c = document.createElement("canvas");
	c.width = c.height = 256;
	const x = c.getContext("2d")!;
	let g = x.createRadialGradient(100, 92, 10, 128, 128, 130);
	g.addColorStop(0, "#ffffff");
	g.addColorStop(0.4, "#f8f0e6");
	g.addColorStop(0.75, "#d8c4b2");
	g.addColorStop(1, "#a08672");
	x.fillStyle = g;
	x.fillRect(0, 0, 256, 256);
	// hard glossy highlight, upper-left key
	g = x.createRadialGradient(88, 72, 2, 88, 72, 30);
	g.addColorStop(0, "rgba(255,255,255,0.95)");
	g.addColorStop(0.55, "rgba(255,255,255,0.55)");
	g.addColorStop(1, "rgba(255,255,255,0)");
	x.fillStyle = g;
	x.fillRect(0, 0, 256, 256);
	// warm bounce along the lower-right limb
	g = x.createRadialGradient(180, 190, 30, 168, 176, 110);
	g.addColorStop(0, "rgba(255,190,150,0)");
	g.addColorStop(0.75, "rgba(255,180,130,0.2)");
	g.addColorStop(1, "rgba(255,210,170,0.5)");
	x.fillStyle = g;
	x.fillRect(0, 0, 256, 256);
	const t = new THREE.CanvasTexture(c);
	t.colorSpace = THREE.SRGBColorSpace;
	t.userData.fallback = true;
	return t;
}

// tries /matcap.png (drop a Cycles-rendered sphere there), falls back to the
// procedural one; always calls back exactly once
export function loadMatcapTexture(onReady: (t: THREE.Texture) => void): void {
	new THREE.TextureLoader().load(
		"/matcap.png",
		(t) => {
			t.colorSpace = THREE.SRGBColorSpace;
			onReady(t);
		},
		undefined,
		() => onReady(makeFallbackMatcap()),
	);
}

export function makeMatcapMaterial(
	s: SidekickSettings,
	tex: TexSet,
	matcap: THREE.Texture,
	colorOverride?: string,
): THREE.MeshMatcapMaterial {
	const mat = new THREE.MeshMatcapMaterial({
		side: THREE.DoubleSide, // see makePhysicalMaterial — open head-shell hem
		color: new THREE.Color(colorOverride ?? s.tint),
		matcap,
		map: colorOverride ? null : tex.map,
		normalMap: colorOverride ? null : tex.normalMap,
		vertexColors: colorOverride ? false : tex.vertexColors,
	});
	// the procedural stand-in has no additive light baked in like a real
	// Cycles matcap would — lift it so the mode is judgeable meanwhile
	if (matcap.userData.fallback) mat.color.multiplyScalar(1.35);
	return mat;
}
