import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

// Painterly storybook lawn shared by /sidekick-3d and /home3/4: a domed hill,
// sky-gradient background, and ART-DIRECTED instanced grass — dense tufts near
// the character, thinning to almost nothing in the distance (NOT an even carpet)
// — plus scattered foreground daisies, buttercups, and rocks. Cel-flat greens in
// a few tones, no gloss.

export const SKY_TOP = "#7ec8f0";
export const SKY_HORIZON = "#dff0ff";

// gently domed lawn: crest at the origin where the character stands
const GROUND_CURVE = 0.012;
export const groundY = (x: number, z: number) => -GROUND_CURVE * (x * x + z * z);

// bright midday sky (end-goal vista): saturated blue overhead → softer blue →
// pale near the horizon. `top`/`horizon` tune the endpoints.
export function makeSkyTexture(top = SKY_TOP, horizon = SKY_HORIZON): THREE.CanvasTexture {
	const c = document.createElement("canvas");
	c.width = 4;
	c.height = 512;
	const x = c.getContext("2d")!;
	const g = x.createLinearGradient(0, 0, 0, 512);
	g.addColorStop(0, top);
	g.addColorStop(0.45, "#6aa8e0");
	g.addColorStop(0.78, "#a7cfee");
	g.addColorStop(1, horizon);
	x.fillStyle = g;
	x.fillRect(0, 0, 4, 512);
	const tex = new THREE.CanvasTexture(c);
	tex.colorSpace = THREE.SRGBColorSpace;
	return tex;
}

// Time-of-day scene presets live in ./sidekick-scene (ScenePreset, SCENE_DEFAULTS,
// makeSky) so settings can import them without a cycle.

// a tapered, slightly-curled blade card. Height/curve vary per variant so the
// field reads as a handful of distinct silhouettes rather than one clone.
function makeBlade(height: number, width: number, curve: number): THREE.BufferGeometry {
	const geo = new THREE.PlaneGeometry(width, height, 1, 3);
	geo.translate(0, height / 2, 0);
	const pos = geo.attributes.position;
	for (let i = 0; i < pos.count; i++) {
		const h = pos.getY(i) / height;
		pos.setX(i, pos.getX(i) * (1 - 0.9 * h * h)); // taper to a soft point
		pos.setZ(i, h * h * curve); // natural forward curl
	}
	geo.computeVertexNormals();
	geo.userData.height = height;
	return geo;
}

export const GRASS_HILL = "#57a336";
export const GRASS_BASE = "#4f9a2c";
export const GRASS_TIP = "#93cf4f";
const GRASS_SHADOW = "#2c6b1c";
const TALLEST = 0.15; // used to normalize height frac in the shader

export type GrassEnv = {
	group: THREE.Group;
	// call per frame: t in seconds, charPos = character root world position
	// (y > 0 while jumping releases the trampled ring so it springs back)
	update: (t: number, charPos: THREE.Vector3) => void;
	// live recolor (GUI-driven)
	setColors: (hill: string, base: string, tip: string, rock?: string) => void;
	// live re-layout: height = blade height multiplier; clumping 0..1 =
	// evenly spread ↔ gathered into pockets of clusters
	relayout: (height: number, clumping: number) => void;
	// the cumulus subtree — callers that fade the meadow need to treat these
	// separately (overlapping lobes compound per-material opacity)
	clouds: THREE.Group;
	// retint the cel clouds for the active scene: lit tone follows the key
	// light, shade + distance haze follow the fog color
	setClouds: (keyColor: string, fogColor: string) => void;
};

export function makeGrassEnvironment(blades = 20000, radius = 11): GrassEnv {
	const group = new THREE.Group();

	// ---- lawn dome, with broad low-frequency color bands painted in vertex color
	const hillGeo = new THREE.PlaneGeometry(80, 80, 96, 96).rotateX(-Math.PI / 2);
	const hp = hillGeo.attributes.position;
	const hillCol = new Float32Array(hp.count * 3);
	const cHill = new THREE.Color(GRASS_HILL);
	const cShad = new THREE.Color(GRASS_SHADOW);
	const cTmp = new THREE.Color();
	for (let i = 0; i < hp.count; i++) {
		const gx = hp.getX(i);
		const gz = hp.getZ(i);
		hp.setY(i, groundY(gx, gz));
		// two low-freq waves → soft broad bands of slightly darker/lighter green
		const band = 0.5 + 0.5 * Math.sin(gx * 0.22 + Math.cos(gz * 0.17) * 1.6);
		cTmp.copy(cHill).lerp(cShad, band * 0.28);
		cTmp.toArray(hillCol, i * 3);
	}
	hillGeo.setAttribute("color", new THREE.BufferAttribute(hillCol, 3));
	hillGeo.computeVertexNormals();
	const hillMat = new THREE.MeshLambertMaterial({ vertexColors: true });
	const hill = new THREE.Mesh(hillGeo, hillMat);
	hill.receiveShadow = true;
	group.add(hill);

	// ---- shared cel-flat blade material ---------------------------------------
	const uniforms = {
		uTime: { value: 0 },
		uPush: { value: new THREE.Vector3(0, 0, 0) },
		uShadow: { value: new THREE.Color(GRASS_SHADOW) },
		uBase: { value: new THREE.Color(GRASS_BASE) },
		uTip: { value: new THREE.Color(GRASS_TIP) },
	};
	const mat = new THREE.MeshLambertMaterial({ side: THREE.DoubleSide });
	mat.onBeforeCompile = (shader) => {
		Object.assign(shader.uniforms, uniforms);
		shader.vertexShader =
			`uniform float uTime;
			uniform vec3 uPush;
			varying float vHFrac;
			varying float vTint;
			varying float vTone;
			float hash( vec2 p ){ return fract( sin( dot( p, vec2( 12.9898, 78.233 ) ) ) * 43758.5453 ); }
			` +
			shader.vertexShader.replace(
				"#include <project_vertex>",
				`vHFrac = clamp( transformed.y / ${TALLEST.toFixed(3)}, 0.0, 1.0 );
				vec4 wpos = instanceMatrix * vec4( transformed, 1.0 );
				float ph = wpos.x * 13.7 + wpos.z * 9.3;
				// patchy tone: cells of ~1.6 units share a green → broad color patches
				vTone = hash( floor( wpos.xz / 1.6 ) );
				vTint = 0.9 + 0.2 * fract( sin( ph ) * 43758.5453 );
				float bend = vHFrac * vHFrac;
				wpos.x += ( sin( uTime * 1.6 + ph ) * 0.7 + sin( uTime * 2.8 + ph * 1.31 ) * 0.3 ) * 0.02 * bend;
				wpos.z += cos( uTime * 1.3 + ph * 0.7 ) * 0.012 * bend;
				// trample: blades near the character bend away from his feet
				vec2 away = wpos.xz - uPush.xz;
				float push = ( 1.0 - smoothstep( 0.06, 0.42, length( away ) ) )
					* ( 1.0 - smoothstep( 0.02, 0.18, uPush.y ) );
				wpos.xz += normalize( away + vec2( 1e-5 ) ) * push * 0.1 * vHFrac;
				wpos.y -= push * 0.035 * vHFrac;
				vec4 mvPosition = viewMatrix * wpos;
				gl_Position = projectionMatrix * mvPosition;`,
			);
		shader.fragmentShader =
			`uniform vec3 uShadow;
			uniform vec3 uBase;
			uniform vec3 uTip;
			varying float vHFrac;
			varying float vTint;
			varying float vTone;
			` +
			shader.fragmentShader.replace(
				"#include <color_fragment>",
				`#include <color_fragment>
				// dark base band (fake AO/shadow) → base green → bright tip
				vec3 g = mix( uShadow, uBase, smoothstep( 0.0, 0.38, vHFrac ) );
				g = mix( g, uTip, smoothstep( 0.45, 1.0, vHFrac ) );
				// patchy tone shift toward warm-lime or cool-olive per patch
				g = mix( g * vec3( 0.86, 0.94, 0.72 ), g * vec3( 1.08, 1.04, 0.86 ), vTone );
				diffuseColor.rgb = g * vTint;`,
			);
	};
	mat.customProgramCacheKey = () => "sidekick-grass";

	// ---- blade variants + instanced fields ------------------------------------
	// a handful of silhouettes: short/tall, straight/curved
	const geos = [
		makeBlade(0.075, 0.017, 0.015),
		makeBlade(0.1, 0.018, 0.03),
		makeBlade(0.125, 0.016, 0.05),
		makeBlade(0.15, 0.02, 0.02),
	];
	const per = Math.floor(blades / geos.length);
	const fields = geos.map((g) => new THREE.InstancedMesh(g, mat, per));

	const m = new THREE.Matrix4();
	const q = new THREE.Quaternion();
	const p = new THREE.Vector3();
	const s = new THREE.Vector3();
	const up = new THREE.Vector3(0, 1, 0);

	const relayout = (height: number, clumping: number) => {
		let seed = 1337;
		const rand = () => {
			seed = (seed * 16807) % 2147483647;
			return seed / 2147483647;
		};
		// clump pockets, biased toward the centre so foreground reads as tufts
		const centers: { x: number; z: number; r: number }[] = [];
		for (let i = 0; i < 620; i++) {
			const cr = radius * Math.pow(rand(), 1.7); // centre-weighted
			const ca = rand() * Math.PI * 2;
			centers.push({ x: Math.cos(ca) * cr, z: Math.sin(ca) * cr, r: 0.05 + rand() * 0.14 });
		}
		for (const field of fields) {
			for (let i = 0; i < field.count; i++) {
				let x: number;
				let z: number;
				if (rand() < clumping) {
					const c = centers[Math.floor(rand() * centers.length)];
					const cr = c.r * Math.sqrt(rand());
					const ca = rand() * Math.PI * 2;
					x = c.x + Math.cos(ca) * cr;
					z = c.z + Math.sin(ca) * cr;
				} else {
					// ART-DIRECTED DENSITY: pow(rand, 2) packs blades near the centre
					// (foreground) and lets them thin out toward the horizon
					const r = radius * Math.pow(rand(), 2.0);
					const a = rand() * Math.PI * 2;
					x = Math.cos(a) * r;
					z = Math.sin(a) * r;
				}
				const dist = Math.hypot(x, z) / radius;
				p.set(x, groundY(x, z) - 0.004, z);
				q.setFromAxisAngle(up, rand() * Math.PI * 2);
				// taller near the camera, a touch shorter far away (no far up-scaling)
				const hmul = (0.7 + rand() * 0.7) * (1.15 - 0.45 * dist) * height;
				s.set(1, Math.max(0.25, hmul), 1);
				field.setMatrixAt(i, m.compose(p, q, s));
			}
			field.instanceMatrix.needsUpdate = true;
			field.frustumCulled = false;
		}
	};
	relayout(1, 0.55);
	for (const f of fields) group.add(f);

	// ---- foreground flowers (daisies + buttercups) ----------------------------
	const flowerTex = makeFlowerTexture();
	const flowerMat = new THREE.MeshBasicMaterial({
		map: flowerTex,
		transparent: true,
		alphaTest: 0.5,
		side: THREE.DoubleSide,
		toneMapped: true,
	});
	const petal = new THREE.PlaneGeometry(0.09, 0.09);
	petal.translate(0, 0.045, 0);
	const petalX = petal.clone().rotateY(Math.PI / 2);
	const flowerGeo = mergeGeos([petal, petalX]); // a crossed card, visible from angles
	const flowers = new THREE.InstancedMesh(flowerGeo, flowerMat, 90);
	{
		let seed = 91;
		const rand = () => ((seed = (seed * 16807) % 2147483647), seed / 2147483647);
		const col = new THREE.Color();
		for (let i = 0; i < flowers.count; i++) {
			const r = radius * 0.42 * Math.pow(rand(), 1.5); // near field only
			const a = rand() * Math.PI * 2;
			const x = Math.cos(a) * r;
			const z = Math.sin(a) * r;
			p.set(x, groundY(x, z) + 0.02, z);
			q.setFromAxisAngle(up, rand() * Math.PI * 2);
			s.setScalar(0.7 + rand() * 0.7);
			flowers.setMatrixAt(i, m.compose(p, q, s));
			// mostly white daisies, some yellow buttercups
			flowers.setColorAt(i, rand() < 0.35 ? col.set("#ffd23c") : col.set("#ffffff"));
		}
		flowers.instanceMatrix.needsUpdate = true;
		if (flowers.instanceColor) flowers.instanceColor.needsUpdate = true;
		flowers.frustumCulled = false;
		group.add(flowers);
	}

	// ---- foreground rocks ------------------------------------------------------
	const rockGeo = new THREE.IcosahedronGeometry(0.12, 0);
	rockGeo.scale(1, 0.62, 1);
	rockGeo.computeVertexNormals();
	const rockMat = new THREE.MeshLambertMaterial({ color: "#8b8f96", flatShading: true });
	const rocks = new THREE.InstancedMesh(rockGeo, rockMat, 7);
	{
		let seed = 71;
		const rand = () => ((seed = (seed * 16807) % 2147483647), seed / 2147483647);
		for (let i = 0; i < rocks.count; i++) {
			const r = 1.5 + rand() * (radius * 0.4);
			const a = rand() * Math.PI * 2;
			const x = Math.cos(a) * r;
			const z = Math.sin(a) * r;
			p.set(x, groundY(x, z) + 0.02, z);
			q.setFromEuler(new THREE.Euler(rand() * 0.6, rand() * Math.PI * 2, rand() * 0.6));
			s.setScalar(0.6 + rand() * 1.4);
			rocks.setMatrixAt(i, m.compose(p, q, s));
		}
		rocks.instanceMatrix.needsUpdate = true;
		rocks.castShadow = true;
		group.add(rocks);
	}

	// ---- drifting cumulus clouds ----------------------------------------------
	const cloudEnv = makeClouds();
	group.add(cloudEnv.group);

	return {
		group,
		update: (t, charPos) => {
			uniforms.uTime.value = t;
			uniforms.uPush.value.copy(charPos);
			cloudEnv.drift(t);
		},
		setColors: (hill, base, tip, rock) => {
			hillMat.color.set(hill);
			uniforms.uBase.value.set(base);
			uniforms.uTip.value.set(tip);
			uniforms.uShadow.value.copy(uniforms.uBase.value).multiplyScalar(0.55);
			if (rock) rockMat.color.set(rock);
		},
		relayout,
		clouds: cloudEnv.group,
		setClouds: cloudEnv.setLook,
	};
}

// Comet-shaped low-poly clouds: each is a cluster of squashed spheres following
// a dense HEAD → drifting SHOULDER → tapering TAIL, with a nearly FLAT underside
// (the stylized/cinematic read). Warm-white cream lit by the low sun; the cool
// hemisphere ground light shades the flat undersides beige. No outline. A scale
// hierarchy (huge foreground → medium horizon → tiny distant) + mirrored copies
// gives each cloud direction so they never read as centered blobs.
// head (tall/dense) → shoulder → tail (small/flat); y is a topline lift, the
// flat bottom comes from centering each puff at ~its own half-height.
// A fluffy cumulus: rounded dome of overlapping lobes (tallest in the middle),
// a wide flat base, and a short directional lean — compact, not a thin streak.
const CLOUD_RECIPE: { x: number; y: number; s: [number, number, number] }[] = [
	// wide flat base lobes (flat underside)
	{ x: -0.6, y: 0.12, s: [2.5, 0.85, 1.35] },
	{ x: 0.7, y: 0.12, s: [2.4, 0.82, 1.3] },
	{ x: 1.9, y: 0.15, s: [1.8, 0.72, 1.15] },
	// puffy dome — tallest in the middle
	{ x: -1.2, y: 0.35, s: [1.6, 0.95, 1.2] },
	{ x: -0.3, y: 0.6, s: [1.9, 1.25, 1.35] },
	{ x: 0.6, y: 0.72, s: [2.1, 1.4, 1.4] },
	{ x: 1.5, y: 0.58, s: [1.9, 1.2, 1.3] },
	{ x: 2.4, y: 0.36, s: [1.5, 0.9, 1.15] },
	// short shoulder + a couple of trailing puffs (gentle lean, not a long tail)
	{ x: 3.2, y: 0.22, s: [1.15, 0.68, 0.95] },
	{ x: 3.9, y: 0.12, s: [0.8, 0.5, 0.75] },
	{ x: -2.1, y: 0.15, s: [1.0, 0.58, 0.85] },
];

function makeClouds(): {
	group: THREE.Group;
	drift: (t: number) => void;
	setLook: (keyColor: string, fogColor: string) => void;
} {
	const group = new THREE.Group();
	const geo = new THREE.SphereGeometry(1, 12, 8);
	// Stylized cel clouds: unlit, two hand-picked tones split by one soft
	// terminator, then hazed toward the fog color with distance. Colors derive
	// from the active scene (key light + fog) via setLook, so evening clouds go
	// peach and night clouds go steel-blue with no extra preset plumbing.
	const uniforms = {
		uLit: { value: new THREE.Color("#fff8ea") },
		uShade: { value: new THREE.Color("#c3cde4") },
		uHaze: { value: new THREE.Color("#dcecfb") },
	};
	const mat = new THREE.MeshBasicMaterial({ fog: false });
	mat.onBeforeCompile = (shader) => {
		Object.assign(shader.uniforms, uniforms);
		shader.vertexShader =
			`attribute float aHaze;
			varying vec3 vCloudN;
			varying float vHaze;
			` +
			shader.vertexShader.replace(
				"#include <begin_vertex>",
				`#include <begin_vertex>
				vCloudN = normal; // cloud meshes never rotate, object dir == world dir
				vHaze = aHaze;`,
			);
		shader.fragmentShader =
			`uniform vec3 uLit;
			uniform vec3 uShade;
			uniform vec3 uHaze;
			varying vec3 vCloudN;
			varying float vHaze;
			` +
			shader.fragmentShader.replace(
				"#include <color_fragment>",
				`#include <color_fragment>
				float dNL = dot( normalize( vCloudN ), normalize( vec3( 0.45, 0.75, 0.4 ) ) );
				vec3 cel = mix( uShade, uLit, smoothstep( -0.06, 0.22, dNL ) );
				diffuseColor.rgb = mix( cel, uHaze, vHaze );`,
			);
	};
	mat.customProgramCacheKey = () => "sidekick-clouds";
	const setLook = (keyColor: string, fogColor: string) => {
		// lit tone leans toward the key light; the shadow tone is the fog color
		// pulled cool+dark so the underside band stays visible against the sky
		uniforms.uLit.value.set("#ffffff").lerp(new THREE.Color(keyColor), 0.4);
		uniforms.uShade.value.set(fogColor).lerp(new THREE.Color("#6b79a8"), 0.3);
		uniforms.uHaze.value.set(fogColor);
	};
	const rand = (n: number) => {
		const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
		return s - Math.floor(s);
	};
	// One merged geometry per cloud (not a pile of sphere meshes): intersecting
	// lobes used to shade with hard creases at every overlap, which is most of
	// why they read as "3D render". Normals are re-aimed away from a low
	// center-line under the cloud (blended 70/30 over the lobe's own), so the
	// whole mass shades as one soft dome; anything dipping below y=0 is clamped
	// flat and given a straight-down normal → razor-flat base in the shade tone.
	const comet = (dir: number, seed: number): THREE.BufferGeometry => {
		const parts: THREE.BufferGeometry[] = [];
		for (let k = 0; k < CLOUD_RECIPE.length; k++) {
			const pf = CLOUD_RECIPE[k];
			const [sx0, sy, sz] = pf.s;
			const sx = sx0 * (0.9 + rand(seed + k) * 0.2);
			const px = (pf.x - 2.3) * dir;
			// flat underside: centre each puff near its own half-height so bottoms
			// align ~y=0; the recipe y adds the rising head → descending tail topline
			const py = sy * 0.85 + pf.y * 0.35;
			const pz = (rand(seed + k * 2) - 0.5) * 0.5;
			const g = geo.clone();
			const pos = g.attributes.position as THREE.BufferAttribute;
			const nor = g.attributes.normal as THREE.BufferAttribute;
			for (let i = 0; i < pos.count; i++) {
				const ux = pos.getX(i), uy = pos.getY(i), uz = pos.getZ(i);
				const x = ux * sx + px;
				let y = uy * sy + py;
				const z = uz * sz + pz;
				if (y <= 0) {
					y = 0;
					nor.setXYZ(i, 0, -1, 0);
				} else {
					// lobe normal under non-uniform scale (inverse-transpose)…
					const n = new THREE.Vector3(ux / sx, uy / sy, uz / sz).normalize();
					// …blended toward the envelope dir from the low center-line
					const e = new THREE.Vector3(x * 0.45, y + 0.9, z * 0.6).normalize();
					n.lerp(e, 0.7).normalize();
					nor.setXYZ(i, n.x, n.y, n.z);
				}
				pos.setXYZ(i, x, y, z);
			}
			parts.push(g);
		}
		return mergeGeometries(parts);
	};
	// NUMEROUS background clouds across three depth tiers: a few big near clouds,
	// more medium ones, and many small puffs banding along the horizon (like the
	// end-goal vista). Placed procedurally + deterministically, some mirrored.
	const drifters: { g: THREE.Object3D; baseX: number; speed: number; wrap: number }[] = [];
	let idx = 0;
	const place = (
		n: number,
		scMin: number,
		scMax: number,
		yMin: number,
		yMax: number,
		zMin: number,
		zMax: number,
		xRange: number,
	) => {
		for (let i = 0; i < n; i++) {
			const dir = rand(idx * 3 + 2) < 0.5 ? 1 : -1;
			const sc = scMin + rand(idx * 5 + 1) * (scMax - scMin);
			const x = (rand(idx * 7 + 3) - 0.5) * xRange;
			const y = yMin + rand(idx * 9 + 5) * (yMax - yMin);
			const z = zMin + rand(idx * 11 + 7) * (zMax - zMin);
			const cg = comet(dir, idx * 13 + 1);
			// atmospheric perspective: farther tiers melt toward the fog color
			// (same trick as the hills/mountains); baked per-cloud since drift
			// only moves clouds along x
			const haze = THREE.MathUtils.clamp((-z - 24) / 85, 0, 1) * 0.85;
			cg.setAttribute("aHaze", new THREE.BufferAttribute(new Float32Array(cg.attributes.position.count).fill(haze), 1));
			const c = new THREE.Mesh(cg, mat);
			c.position.set(x, y, z);
			c.scale.setScalar(sc);
			group.add(c);
			drifters.push({ g: c, baseX: x, speed: 0.04 + rand(idx * 2 + 9) * 0.08, wrap: xRange });
			idx++;
		}
	};
	place(4, 2.4, 3.2, 11, 16, -22, -40, 90); // huge near clouds
	place(9, 1.3, 2.1, 8, 13, -30, -55, 120); // medium mid-sky clouds
	place(15, 0.55, 1.1, 4, 9, -46, -84, 150); // small puffs banding the horizon
	const drift = (t: number) => {
		for (const d of drifters) {
			const span = d.wrap + 20;
			d.g.position.x = ((((d.baseX + t * d.speed + span / 2) % span) + span) % span) - span / 2;
		}
	};
	return { group, drift, setLook };
}

// small procedural daisy: white petals around a yellow center, transparent bg
function makeFlowerTexture(): THREE.CanvasTexture {
	const c = document.createElement("canvas");
	c.width = c.height = 128;
	const x = c.getContext("2d")!;
	x.clearRect(0, 0, 128, 128);
	x.translate(64, 64);
	x.fillStyle = "#ffffff";
	for (let i = 0; i < 6; i++) {
		x.save();
		x.rotate((i / 6) * Math.PI * 2);
		x.beginPath();
		x.ellipse(0, -34, 13, 26, 0, 0, Math.PI * 2);
		x.fill();
		x.restore();
	}
	x.fillStyle = "#f7c331";
	x.beginPath();
	x.arc(0, 0, 18, 0, Math.PI * 2);
	x.fill();
	const tex = new THREE.CanvasTexture(c);
	tex.colorSpace = THREE.SRGBColorSpace;
	return tex;
}

// merge a couple of simple geometries (no BufferGeometryUtils dependency)
function mergeGeos(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
	const out = new THREE.BufferGeometry();
	const posArrays: number[] = [];
	const uvArrays: number[] = [];
	const indexArrays: number[] = [];
	let vertOffset = 0;
	for (const g of list) {
		const pos = g.attributes.position as THREE.BufferAttribute;
		const uv = g.attributes.uv as THREE.BufferAttribute;
		for (let i = 0; i < pos.count; i++) {
			posArrays.push(pos.getX(i), pos.getY(i), pos.getZ(i));
			uvArrays.push(uv.getX(i), uv.getY(i));
		}
		const idx = g.index!;
		for (let i = 0; i < idx.count; i++) indexArrays.push(idx.getX(i) + vertOffset);
		vertOffset += pos.count;
	}
	out.setAttribute("position", new THREE.Float32BufferAttribute(posArrays, 3));
	out.setAttribute("uv", new THREE.Float32BufferAttribute(uvArrays, 2));
	out.setIndex(indexArrays);
	out.computeVertexNormals();
	return out;
}
