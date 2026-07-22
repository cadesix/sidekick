import * as THREE from 'three';
import type { SidekickSettings } from './settings';

// Ported from sidekick/src/components/sidekick-shading.ts, trimmed to what the
// /home4 cel look needs on mobile:
//   - cel     : the shipped look — ONE soft terminator against a fixed key
//               direction, full albedo in light / albedo × warm multiply tint
//               in shadow (exact same math as the web's MeshToonMaterial +
//               onBeforeCompile injection)
//   - outline : inverted-hull silhouette line
//   - physical: fallback only
//
// expo-gl can't run the web's material path: per-fragment-lit built-ins
// (Toon/Phong/Standard) render INVISIBLE when skinned, and onBeforeCompile
// injections on a skinned built-in also break rendering. But plain skinned
// MeshBasicMaterial works — i.e. the skinning chunks themselves are fine, it's
// the built-in lighting pipeline that's broken. So cel + outline are built as
// self-contained ShaderMaterials that include the skinning chunks directly:
// no lights, no injection, just the two-tone terminator — which is exactly
// what the web cel shader computes anyway (it overrides outgoingLight and
// ignores the scene lights by design).

export const FACE_COLOR = '#dd9d43';

// midday sun direction — drives the scene light rig
export const SUN_DIR = new THREE.Vector3(2.6, 4.4, 2.2).normalize();

export type TexSet = {
  map: THREE.Texture | null;
  normalMap: THREE.Texture | null;
  vertexColors: boolean;
};

// ---- physical (fallback) ----

export function makePhysicalMaterial(
  s: SidekickSettings,
  tex: TexSet,
  colorOverride?: string,
): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
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
    emissive: new THREE.Color(s.emissiveColor),
    emissiveIntensity: s.emissiveIntensity,
  });
}

// ---- cel: the flat-illustration look ----
// Same two-tone shading as the web's makeCelMaterial injection: the skinned
// world-space normal against uKeyDir, one smoothstep terminator, shadow side
// multiplied by mix(1, shadeColor × charTint, celShadowAmt). Tone mapping,
// output color space and fog go through the same chunks as the built-ins so
// the final pixel matches the web renderer (ACESFilmic × scene exposure).

const CEL_VERT = /* glsl */ `
#include <common>
#include <skinning_pars_vertex>
#include <fog_pars_vertex>
varying vec3 vWorldNormal;
varying vec3 vWorldPos;
#ifdef SK_USE_MAP
uniform mat3 uMapTransform;
varying vec2 vSkUv;
#endif
void main() {
	#include <beginnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	vWorldNormal = normalize( mat3( modelMatrix ) * objectNormal );
	#include <begin_vertex>
	#include <skinning_vertex>
	vWorldPos = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;
	#include <project_vertex>
	#include <fog_vertex>
	#ifdef SK_USE_MAP
	vSkUv = ( uMapTransform * vec3( uv, 1.0 ) ).xy;
	#endif
}
`;

const CEL_FRAG = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
uniform vec3 uColor;
uniform vec3 uKeyDir;
uniform float uCelSoft;
uniform vec3 uCelShadow;
uniform float uCelAmt;
uniform vec3 uRimColor;
uniform float uRimStrength;
uniform float uRimWidth;
varying vec3 vWorldNormal;
varying vec3 vWorldPos;
#ifdef SK_USE_MAP
uniform sampler2D uMap;
varying vec2 vSkUv;
#endif
void main() {
	vec4 diffuseColor = vec4( uColor, 1.0 );
	#ifdef SK_USE_MAP
	diffuseColor *= texture2D( uMap, vSkUv );
	#endif
	#ifdef SK_ALPHA_CUTOUT
	if ( diffuseColor.a < 0.02 ) discard;
	#endif
	// double-sided: flip the normal on back faces like the built-ins do
	vec3 N = normalize( vWorldNormal );
	if ( ! gl_FrontFacing ) N = -N;
	float ndl = dot( N, uKeyDir );
	float t = smoothstep( -uCelSoft, uCelSoft, ndl );
	vec3 celTint = mix( vec3( 1.0 ), uCelShadow, uCelAmt );
	vec3 rgb = diffuseColor.rgb * mix( celTint, vec3( 1.0 ), t );
	// cel rim: a crisp fresnel edge band, brighter on the lit side so it reads
	// as backlight rather than a uniform glow (verbatim from web makeCelMaterial)
	vec3 V = normalize( cameraPosition - vWorldPos );
	float rimF = 1.0 - clamp( dot( V, N ), 0.0, 1.0 );
	float rimBand = smoothstep( 1.0 - uRimWidth, min( 1.0, 1.0 - uRimWidth + 0.14 ), rimF );
	rgb += uRimColor * ( uRimStrength * rimBand * ( 0.35 + 0.65 * t ) );
	gl_FragColor = vec4( rgb, diffuseColor.a );
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
}
`;

export function makeCelMaterial(
  s: SidekickSettings,
  tex: TexSet,
  colorOverride?: string,
  opts?: { alphaCutout?: boolean },
): THREE.ShaderMaterial {
  // the cel body + shadow shift with the active time-of-day scene (warmer at
  // evening, cool + dim at night) so the character reads as part of the scene
  const scene = s.scenes[s.timeOfDay];
  const envTint = new THREE.Color(scene.charTint);
  const map = colorOverride ? null : tex.map;

  const defines: Record<string, string> = {};
  if (map) defines.SK_USE_MAP = '';
  if (map && opts?.alphaCutout) defines.SK_ALPHA_CUTOUT = '';

  // NOTE: merge() deep-clones values (it would clone a Texture), so the map
  // and its transform are attached after the merge
  const uniforms = THREE.UniformsUtils.merge([
    THREE.UniformsLib.fog,
    {
      uColor: { value: new THREE.Color(colorOverride ?? s.tint).multiply(envTint) },
      uKeyDir: { value: new THREE.Vector3(2, 3, 2).normalize() }, // matches the key light
      uCelSoft: { value: 0.015 + 0.6 * THREE.MathUtils.clamp(s.celSoftness, 0, 1) },
      uCelShadow: { value: new THREE.Color(scene.shadeColor).multiply(envTint) },
      uCelAmt: { value: s.celShadowAmt },
      // rim = the character's OWN warm backlight (a dedicated red-leaning light),
      // not the scene rim. Shown ONLY at evening — a warm dusk glow; day + night
      // get none. strength is its opacity; width stays a shape knob
      uRimColor: { value: new THREE.Color(s.celRimColor) },
      uRimStrength: { value: s.timeOfDay === 'evening' ? s.celRimStrength : 0 },
      uRimWidth: { value: s.celRimWidth },
    },
  ]) as Record<string, THREE.IUniform>;
  if (map) {
    map.updateMatrix();
    uniforms.uMap = { value: map };
    uniforms.uMapTransform = { value: new THREE.Matrix3().copy(map.matrix) };
  }

  return new THREE.ShaderMaterial({
    vertexShader: CEL_VERT,
    fragmentShader: CEL_FRAG,
    defines,
    uniforms,
    side: THREE.DoubleSide, // open head-shell hem (see makePhysicalMaterial)
    fog: true,
    transparent: !!(map && opts?.alphaCutout),
  });
}

// ---- cosmetics item materials ----
// Web's makeItemMaterial resolved per-mode; on mobile only cel ships. A textured
// item keeps its albedo (uColor stays white so the map reads true); a solid-color
// item is just the cel material with that color. Rigid items (hat/shoes/phone)
// reuse the same shader — its skinning chunks compile to no-ops on a plain Mesh.
export type ItemLook = {
  color: string;
  map: THREE.Texture | null;
};

export function makeItemMaterial(s: SidekickSettings, look: ItemLook): THREE.ShaderMaterial {
  return look.map
    ? makeCelMaterial(s, { map: look.map, normalMap: null, vertexColors: false })
    : makeCelMaterial(s, { map: null, normalMap: null, vertexColors: false }, look.color);
}

// Live look-dev: update an existing cel material's uniforms in place (same
// formulas as makeCelMaterial) — rebuilding materials per slider tick swaps
// GL programs mid-frame and reads as flashing.
export function retintCelMaterial(
  mat: THREE.Material,
  s: SidekickSettings,
  colorOverride?: string,
): void {
  const u = (mat as THREE.ShaderMaterial).uniforms;
  if (!u?.uColor) return;
  const scene = s.scenes[s.timeOfDay];
  const envTint = new THREE.Color(scene.charTint);
  (u.uColor.value as THREE.Color).set(colorOverride ?? s.tint).multiply(envTint);
  u.uCelSoft.value = 0.015 + 0.6 * THREE.MathUtils.clamp(s.celSoftness, 0, 1);
  (u.uCelShadow.value as THREE.Color).set(scene.shadeColor).multiply(envTint);
  u.uCelAmt.value = s.celShadowAmt;
  if (u.uRimColor) {
    (u.uRimColor.value as THREE.Color).set(s.celRimColor);
    u.uRimStrength.value = s.timeOfDay === 'evening' ? s.celRimStrength : 0;
    u.uRimWidth.value = s.celRimWidth;
  }
}

export function retintOutlineMaterial(mat: THREE.Material, s: SidekickSettings): void {
  const u = (mat as THREE.ShaderMaterial).uniforms;
  if (!u?.uColor) return;
  (u.uColor.value as THREE.Color).set(s.outlineColor);
  u.uOutlineWidth.value = s.outlineWidth * 0.2;
}

// The face controller animates the sheet's offset/repeat every frame (blink /
// talk cells); a ShaderMaterial doesn't get three's automatic mapTransform
// refresh, so the render loop calls this once per frame.
export function syncCelMapTransform(mat: THREE.Material, tex: THREE.Texture): void {
  const u = (mat as THREE.ShaderMaterial).uniforms;
  if (!u?.uMapTransform) return;
  tex.updateMatrix();
  (u.uMapTransform.value as THREE.Matrix3).copy(tex.matrix);
}

// ---- outline: inverted-hull silhouette line ----
// Web version: MeshLambertMaterial with black diffuse + emissive line color →
// the lit term is zero and the output is just the tone-mapped emissive. Same
// flat color here, minus the broken-on-expo-gl lighting pipeline. Displaces
// along the already-skinned normal right before projection, so the hull
// follows animation.

const OUTLINE_VERT = /* glsl */ `
#include <common>
#include <skinning_pars_vertex>
#include <fog_pars_vertex>
uniform float uOutlineWidth;
void main() {
	#include <beginnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <begin_vertex>
	#include <skinning_vertex>
	transformed += normalize( objectNormal ) * uOutlineWidth;
	#include <project_vertex>
	#include <fog_vertex>
}
`;

const OUTLINE_FRAG = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
uniform vec3 uColor;
void main() {
	gl_FragColor = vec4( uColor, 1.0 );
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
}
`;

export function makeOutlineMaterial(s: SidekickSettings): THREE.ShaderMaterial {
  const uniforms = THREE.UniformsUtils.merge([
    THREE.UniformsLib.fog,
    {
      uColor: { value: new THREE.Color(s.outlineColor) },
      uOutlineWidth: { value: s.outlineWidth * 0.2 }, // raw model is 0.2 units tall
    },
  ]) as Record<string, THREE.IUniform>;
  return new THREE.ShaderMaterial({
    vertexShader: OUTLINE_VERT,
    fragmentShader: OUTLINE_FRAG,
    uniforms,
    side: THREE.BackSide,
    fog: true,
  });
}

// ---- mode dispatch (cel + physical only in v1) ----
export function makeCharacterMaterials(
  s: SidekickSettings,
  tex: TexSet,
  faceTex?: THREE.Texture | null,
): { body: THREE.Material; face: THREE.Material } {
  const faceSet: TexSet | null = faceTex
    ? { map: faceTex, normalMap: null, vertexColors: false }
    : null;
  if (s.shading === 'cel') {
    // body drops its baked-shading albedo for a flat brand color; the face
    // keeps its sprite map (alpha cutout — only the features are opaque, so
    // the head's own cel shading shows through around them)
    return {
      body: makeCelMaterial(s, tex, s.celBodyColor),
      face: faceSet
        ? makeCelMaterial(s, faceSet, undefined, { alphaCutout: true })
        : makeCelMaterial(s, tex, FACE_COLOR),
    };
  }
  const withAlpha = (m: THREE.Material): THREE.Material => {
    if (faceSet) {
      m.transparent = true;
      m.alphaTest = 0.02;
    }
    return m;
  };
  return {
    body: makePhysicalMaterial(s, tex),
    face: faceSet ? withAlpha(makePhysicalMaterial(s, faceSet)) : makePhysicalMaterial(s, tex, FACE_COLOR),
  };
}
