import * as THREE from 'three';

// WORLD-ANCHORED FOG. Stock THREE.Fog measures depth from the CAMERA, so the
// whole meadow hazes up whenever the camera pulls back (chat/shop/map
// framings) — the atmosphere follows the lens instead of the world. This
// patches three's shared fog chunks so fog is a property of the PLACE:
//
//   factor = smoothstep(fogNear, fogFar, length(worldPos.xz))   // radial haze
//            × clamp(1 − worldPos.y / 6, 0, 1)                   // pools low
//
// fogNear/fogFar keep their slider semantics but are now WORLD RADII from the
// scene origin (where the character stands), and the height term thins the
// haze with altitude like ground mist. Camera moves no longer change the look.
//
// Every material — built-ins (hill, rocks) AND our custom cel/outline/blade
// ShaderMaterials — #include these same chunks, so one patch covers the whole
// scene. Materials with fog:false (clouds, studio, sky) are untouched.
// MUST run before the first material compiles; renderer.ts calls it at
// context creation (idempotent).

let patched = false;

export function patchWorldFog(): void {
  if (patched) return;
  patched = true;

  THREE.ShaderChunk.fog_pars_vertex = /* glsl */ `
#ifdef USE_FOG
	varying vec3 vFogWorldPos;
#endif
`;

  // `transformed` is post-skinning here in every vertex shader (built-in or
  // ours); instanced meshes (grass blades) need instanceMatrix folded in.
  THREE.ShaderChunk.fog_vertex = /* glsl */ `
#ifdef USE_FOG
	#ifdef USE_INSTANCING
		vFogWorldPos = ( modelMatrix * instanceMatrix * vec4( transformed, 1.0 ) ).xyz;
	#else
		vFogWorldPos = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;
	#endif
#endif
`;

  THREE.ShaderChunk.fog_pars_fragment = /* glsl */ `
#ifdef USE_FOG
	uniform vec3 fogColor;
	varying vec3 vFogWorldPos;
	#ifdef FOG_EXP2
		uniform float fogDensity;
	#else
		uniform float fogNear;
		uniform float fogFar;
	#endif
#endif
`;

  THREE.ShaderChunk.fog_fragment = /* glsl */ `
#ifdef USE_FOG
	float skFogDist = length( vFogWorldPos.xz );
	#ifdef FOG_EXP2
		float fogFactor = 1.0 - exp( - fogDensity * fogDensity * skFogDist * skFogDist );
	#else
		float fogFactor = smoothstep( fogNear, fogFar, skFogDist );
	#endif
	// ground-mist height falloff: full haze at the lawn, thinning to none ~6u up
	fogFactor *= clamp( 1.0 - vFogWorldPos.y / 6.0, 0.0, 1.0 );
	gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );
#endif
`;
}
