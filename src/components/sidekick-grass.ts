import * as THREE from "three";

// Real 3D grass environment shared by /sidekick-3d and /home3: a domed lawn
// hill, a sky-gradient background, and a field of instanced grass blades that
// sway in the wind and bend away from the character's feet. Replaces the old
// backdrop-clean.png image background.

export const SKY_TOP = "#b8dcf2";
export const SKY_HORIZON = "#eef7ee";

// gently domed lawn: crest at the origin where the character stands
const GROUND_CURVE = 0.012;
export const groundY = (x: number, z: number) => -GROUND_CURVE * (x * x + z * z);

export function makeSkyTexture(top = SKY_TOP, horizon = SKY_HORIZON): THREE.CanvasTexture {
	const c = document.createElement("canvas");
	c.width = 2;
	c.height = 256;
	const x = c.getContext("2d")!;
	const g = x.createLinearGradient(0, 0, 0, 256);
	g.addColorStop(0, top);
	g.addColorStop(0.75, new THREE.Color(top).lerp(new THREE.Color(horizon), 0.7).getStyle());
	g.addColorStop(1, horizon);
	x.fillStyle = g;
	x.fillRect(0, 0, 2, 256);
	const tex = new THREE.CanvasTexture(c);
	tex.colorSpace = THREE.SRGBColorSpace;
	return tex;
}

const BLADE_HEIGHT = 0.09;

function makeBladeGeometry(): THREE.BufferGeometry {
	const geo = new THREE.PlaneGeometry(0.016, BLADE_HEIGHT, 1, 3);
	geo.translate(0, BLADE_HEIGHT / 2, 0);
	const pos = geo.attributes.position;
	for (let i = 0; i < pos.count; i++) {
		const h = pos.getY(i) / BLADE_HEIGHT;
		pos.setX(i, pos.getX(i) * (1 - 0.85 * h * h)); // taper to a soft point
		pos.setZ(i, h * h * 0.02); // slight natural curl
	}
	geo.computeVertexNormals();
	return geo;
}

export const GRASS_HILL = "#4d9634";
export const GRASS_BASE = "#3f8a2c";
export const GRASS_TIP = "#a5d75e";

export type GrassEnv = {
	group: THREE.Group;
	// call per frame: t in seconds, charPos = character root world position
	// (y > 0 while jumping releases the trampled ring so it springs back)
	update: (t: number, charPos: THREE.Vector3) => void;
	// live recolor (GUI-driven)
	setColors: (hill: string, base: string, tip: string) => void;
	// live re-layout: height = blade height multiplier; clumping 0..1 =
	// evenly spread ↔ gathered into pockets of clusters
	relayout: (height: number, clumping: number) => void;
};

export function makeGrassEnvironment(blades = 26000, radius = 11): GrassEnv {
	const group = new THREE.Group();

	// lawn dome
	const hillGeo = new THREE.PlaneGeometry(80, 80, 96, 96).rotateX(-Math.PI / 2);
	const hp = hillGeo.attributes.position;
	for (let i = 0; i < hp.count; i++) hp.setY(i, groundY(hp.getX(i), hp.getZ(i)));
	hillGeo.computeVertexNormals();
	const hillMat = new THREE.MeshLambertMaterial({ color: GRASS_HILL });
	const hill = new THREE.Mesh(hillGeo, hillMat);
	hill.receiveShadow = true;
	group.add(hill);

	// grass blades
	const uniforms = {
		uTime: { value: 0 },
		uPush: { value: new THREE.Vector3(0, 0, 0) },
		uBaseColor: { value: new THREE.Color(GRASS_BASE) },
		uTipColor: { value: new THREE.Color(GRASS_TIP) },
	};
	const mat = new THREE.MeshLambertMaterial({ side: THREE.DoubleSide });
	mat.onBeforeCompile = (shader) => {
		Object.assign(shader.uniforms, uniforms);
		shader.vertexShader =
			`uniform float uTime;
			uniform vec3 uPush;
			varying float vHFrac;
			varying float vTint;
			` +
			shader.vertexShader.replace(
				"#include <project_vertex>",
				`vHFrac = clamp( transformed.y / ${BLADE_HEIGHT.toFixed(3)}, 0.0, 1.0 );
				vec4 wpos = instanceMatrix * vec4( transformed, 1.0 );
				float ph = wpos.x * 13.7 + wpos.z * 9.3;
				vTint = 0.8 + 0.4 * fract( sin( ph ) * 43758.5453 );
				float bend = vHFrac * vHFrac;
				// two-octave wind sway
				wpos.x += ( sin( uTime * 1.6 + ph ) * 0.7 + sin( uTime * 2.8 + ph * 1.31 ) * 0.3 ) * 0.02 * bend;
				wpos.z += cos( uTime * 1.3 + ph * 0.7 ) * 0.012 * bend;
				// trample: blades near the character bend away from his feet,
				// springing back while he's airborne
				vec2 away = wpos.xz - uPush.xz;
				float push = ( 1.0 - smoothstep( 0.06, 0.42, length( away ) ) )
					* ( 1.0 - smoothstep( 0.02, 0.18, uPush.y ) );
				wpos.xz += normalize( away + vec2( 1e-5 ) ) * push * 0.1 * vHFrac;
				wpos.y -= push * 0.035 * vHFrac;
				vec4 mvPosition = viewMatrix * wpos;
				gl_Position = projectionMatrix * mvPosition;`,
			);
		shader.fragmentShader =
			`uniform vec3 uBaseColor;
			uniform vec3 uTipColor;
			varying float vHFrac;
			varying float vTint;
			` +
			shader.fragmentShader.replace(
				"#include <color_fragment>",
				`#include <color_fragment>
				diffuseColor.rgb = mix( uBaseColor, uTipColor, vHFrac ) * vTint;`,
			);
	};
	mat.customProgramCacheKey = () => "sidekick-grass";

	const field = new THREE.InstancedMesh(makeBladeGeometry(), mat, blades);
	const m = new THREE.Matrix4();
	const q = new THREE.Quaternion();
	const p = new THREE.Vector3();
	const s = new THREE.Vector3();
	const up = new THREE.Vector3(0, 1, 0);
	const relayout = (height: number, clumping: number) => {
		// deterministic layout (LCG, no Math.random — same params → same lawn)
		let seed = 1337;
		const rand = () => {
			seed = (seed * 16807) % 2147483647;
			return seed / 2147483647;
		};
		// pockets the blades gather into as clumping rises: many small tufts
		// scattered across the lawn
		const centers: { x: number; z: number; r: number }[] = [];
		for (let i = 0; i < 520; i++) {
			const cr = radius * Math.sqrt(rand());
			const ca = rand() * Math.PI * 2;
			centers.push({ x: Math.cos(ca) * cr, z: Math.sin(ca) * cr, r: 0.06 + rand() * 0.16 });
		}
		for (let i = 0; i < blades; i++) {
			let x: number;
			let z: number;
			if (rand() < clumping) {
				const c = centers[Math.floor(rand() * centers.length)];
				const cr = c.r * Math.sqrt(rand());
				const ca = rand() * Math.PI * 2;
				x = c.x + Math.cos(ca) * cr;
				z = c.z + Math.sin(ca) * cr;
			} else {
				const r = radius * Math.sqrt(rand());
				const a = rand() * Math.PI * 2;
				x = Math.cos(a) * r;
				z = Math.sin(a) * r;
			}
			p.set(x, groundY(x, z) - 0.004, z);
			q.setFromAxisAngle(up, rand() * Math.PI * 2);
			// far blades grow larger so constant density still reads as a dense
			// lawn all the way to the horizon
			const far = 1 + (Math.hypot(x, z) / radius) * 1.4;
			s.set(far, (0.65 + rand() * 0.85) * far * height, far);
			field.setMatrixAt(i, m.compose(p, q, s));
		}
		field.instanceMatrix.needsUpdate = true;
	};
	relayout(1, 0);
	field.frustumCulled = false;
	group.add(field);

	return {
		group,
		update: (t, charPos) => {
			uniforms.uTime.value = t;
			uniforms.uPush.value.copy(charPos);
		},
		setColors: (hill, base, tip) => {
			hillMat.color.set(hill);
			uniforms.uBaseColor.value.set(base);
			uniforms.uTipColor.value.set(tip);
		},
		relayout,
	};
}
