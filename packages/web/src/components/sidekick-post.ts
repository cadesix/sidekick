import * as THREE from "three";

// Screen-space tilt-shift: a horizontal band stays sharp; everything above/below
// blurs, with the blur ramping by distance from the band. This is the stylized
// "miniature diorama" look (a gradient blur), independent of scene depth — pair
// it with, or use instead of, the depth-based BokehPass. Cheap 9-tap.
export const TiltShiftShader = {
	uniforms: {
		tDiffuse: { value: null as THREE.Texture | null },
		uFocusY: { value: 0.42 },
		uBand: { value: 0.16 },
		uBlur: { value: 3.0 },
		uResolution: { value: new THREE.Vector2(1, 1) },
	},
	vertexShader: /* glsl */ `
		varying vec2 vUv;
		void main() {
			vUv = uv;
			gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
		}`,
	fragmentShader: /* glsl */ `
		uniform sampler2D tDiffuse;
		uniform float uFocusY;
		uniform float uBand;
		uniform float uBlur;
		uniform vec2 uResolution;
		varying vec2 vUv;
		void main() {
			// 0 inside the sharp band, ramping to 1 away from it
			float d = max( 0.0, abs( vUv.y - uFocusY ) - uBand );
			float amt = smoothstep( 0.0, 0.35, d );
			vec2 px = ( amt * uBlur ) / uResolution;
			vec4 c = texture2D( tDiffuse, vUv ) * 0.2;
			c += texture2D( tDiffuse, vUv + vec2(  px.x, 0.0 ) ) * 0.15;
			c += texture2D( tDiffuse, vUv + vec2( -px.x, 0.0 ) ) * 0.15;
			c += texture2D( tDiffuse, vUv + vec2( 0.0,  px.y ) ) * 0.15;
			c += texture2D( tDiffuse, vUv + vec2( 0.0, -px.y ) ) * 0.15;
			c += texture2D( tDiffuse, vUv + px * 0.7 ) * 0.05;
			c += texture2D( tDiffuse, vUv - px * 0.7 ) * 0.05;
			c += texture2D( tDiffuse, vUv + vec2( px.x, -px.y ) * 0.7 ) * 0.05;
			c += texture2D( tDiffuse, vUv + vec2( -px.x, px.y ) * 0.7 ) * 0.05;
			gl_FragColor = c;
		}`,
};

// Vertical field-of-view (deg) for a given photographic focal length on a
// full-frame (36×24mm) sensor — lets the GUI speak in millimetres.
export function fovFromFocalLength(mm: number): number {
	return THREE.MathUtils.radToDeg(2 * Math.atan(24 / (2 * mm)));
}
export function focalLengthFromFov(fovDeg: number): number {
	return 24 / (2 * Math.tan(THREE.MathUtils.degToRad(fovDeg) / 2));
}
