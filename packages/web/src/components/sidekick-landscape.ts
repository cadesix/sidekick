import * as THREE from "three";

// Low-poly landscape vista for the 9:16 hero composition: a big foreground CLIFF
// on the left, the ground dropping away to a winding RIVER/SEA in the valley,
// distant rolling HILLS, hazy blue MOUNTAINS on the horizon, and scattered
// low-poly TREES. Everything is deterministic (no Math.random) so renders are
// stable. Add this group to the scene alongside the grass lawn.

// deterministic hash → [0,1)
function rand(n: number): number {
	const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
	return s - Math.floor(s);
}

// a chunky low-poly rock: a subdivided box pushed around by hash noise, faceted
function makeRock(w: number, h: number, d: number, color: string, seed: number): THREE.Mesh {
	const geo = new THREE.BoxGeometry(w, h, d, 3, 4, 3);
	const pos = geo.attributes.position;
	const v = new THREE.Vector3();
	for (let i = 0; i < pos.count; i++) {
		v.fromBufferAttribute(pos, i);
		const n = (rand(seed + i * 1.7) - 0.5) * 0.9;
		const ny = (rand(seed + i * 2.3) - 0.5) * 0.9;
		v.x += n * w * 0.14;
		v.y += ny * h * 0.1;
		v.z += (rand(seed + i * 3.1) - 0.5) * d * 0.14;
		pos.setXYZ(i, v.x, v.y, v.z);
	}
	geo.computeVertexNormals();
	const mesh = new THREE.Mesh(
		geo,
		new THREE.MeshLambertMaterial({ color, flatShading: true }),
	);
	return mesh;
}

// a low-poly tree: a short trunk + 1–3 faceted foliage blobs
function makeTree(scale: number, seed: number): THREE.Group {
	const g = new THREE.Group();
	const trunk = new THREE.Mesh(
		new THREE.CylinderGeometry(0.12, 0.18, 1.0, 5),
		new THREE.MeshLambertMaterial({ color: "#6b4a2f", flatShading: true }),
	);
	trunk.position.y = 0.5;
	g.add(trunk);
	const leafMat = new THREE.MeshLambertMaterial({ color: "#3f8f39", flatShading: true });
	const blobs = 2 + Math.floor(rand(seed) * 2);
	for (let i = 0; i < blobs; i++) {
		const r = 0.55 + rand(seed + i) * 0.4;
		const blob = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 0), leafMat);
		blob.position.set(
			(rand(seed + i * 2) - 0.5) * 0.6,
			1.1 + i * 0.5 + rand(seed + i * 3) * 0.2,
			(rand(seed + i * 4) - 0.5) * 0.6,
		);
		blob.scale.y = 0.9;
		g.add(blob);
	}
	g.scale.setScalar(scale);
	return g;
}

export function makeLandscape(): THREE.Group {
	const group = new THREE.Group();

	// ---- river / sea in the valley -------------------------------------------
	// a broad water plane well below the hill; the drop-off reveals it in the mid
	// distance. Slightly glossy so the sky reflects into it.
	const water = new THREE.Mesh(
		new THREE.PlaneGeometry(320, 320).rotateX(-Math.PI / 2),
		new THREE.MeshStandardMaterial({
			color: "#5aa6dd",
			roughness: 0.3,
			metalness: 0.1,
			emissive: "#3f7fb8",
			emissiveIntensity: 0.25,
			fog: false, // keep the water crisp blue instead of hazing to grey
		}),
	);
	water.position.set(-6, -2.8, -58);
	group.add(water);

	// ---- distant rolling hills (green, receding) -----------------------------
	// squashed domes ringing the valley; far ones lean bluer for aerial haze
	const nearHill = new THREE.Color("#63a23c");
	const hazeBlue = new THREE.Color("#9fbcd6");
	const cTmp = new THREE.Color();
	const hills: [number, number, number, number][] = [
		// [x, z, radius, squashScaleY]
		[-30, -34, 15, 0.34],
		[24, -40, 20, 0.3],
		[-8, -52, 24, 0.26],
		[40, -30, 14, 0.32],
		[-40, -60, 26, 0.24],
		[12, -66, 30, 0.22],
		[-22, -74, 28, 0.2],
	];
	for (let i = 0; i < hills.length; i++) {
		const [x, z, r, sq] = hills[i];
		const haze = THREE.MathUtils.clamp((-z - 30) / 55, 0, 0.85);
		cTmp.copy(nearHill).lerp(hazeBlue, haze);
		const h = new THREE.Mesh(
			new THREE.SphereGeometry(r, 24, 16),
			new THREE.MeshLambertMaterial({ color: cTmp.getHex() }),
		);
		h.position.set(x, -r * sq - 6.5, z);
		h.scale.y = sq;
		group.add(h);
	}

	// ---- hazy blue mountains on the horizon ----------------------------------
	// far, low, wide silhouettes hazing into the sky — atmospheric perspective
	const mtnBlue = new THREE.Color("#7d97ba");
	const mtns: [number, number, number, number][] = [
		// [x, z, radius, height]
		[-34, -135, 22, 15],
		[10, -150, 28, 21],
		[48, -142, 20, 13],
		[-58, -148, 24, 14],
		[74, -158, 26, 17],
		[-8, -172, 32, 23],
		[34, -178, 24, 14],
	];
	for (let i = 0; i < mtns.length; i++) {
		const [x, z, r, h] = mtns[i];
		const haze = THREE.MathUtils.clamp((-z - 120) / 60, 0.35, 0.9);
		cTmp.copy(mtnBlue).lerp(hazeBlue, haze);
		const m = new THREE.Mesh(
			new THREE.ConeGeometry(r, h, 6, 1),
			new THREE.MeshLambertMaterial({ color: cTmp.getHex(), flatShading: true }),
		);
		m.position.set(x, -6.5 + h / 2 - r * 0.15, z);
		// subtle snowy cap
		const snow = new THREE.Mesh(
			new THREE.ConeGeometry(r * 0.34, h * 0.22, 6, 1),
			new THREE.MeshLambertMaterial({ color: cTmp.clone().lerp(new THREE.Color("#f2f6fc"), 0.7).getHex(), flatShading: true }),
		);
		snow.position.y = h * 0.38;
		m.add(snow);
		group.add(m);
	}

	// ---- foreground cliff (left) ---------------------------------------------
	// a big faceted rock mass rising from the lower-left foreground, with a grassy
	// cap and a couple of trees crowning it — the anchor of the composition
	const cliff = makeRock(5.5, 14, 5.5, "#8a8f96", 11);
	cliff.position.set(-3.9, 0.0, 0.6);
	cliff.rotation.y = 0.4;
	group.add(cliff);
	// a lower rock shelf in front of it for depth
	const shelf = makeRock(4, 8, 3.5, "#7f858c", 47);
	shelf.position.set(-3.0, -2.6, 2.6);
	group.add(shelf);
	// grassy cap on the cliff top
	const cap = new THREE.Mesh(
		new THREE.SphereGeometry(3.2, 20, 12),
		new THREE.MeshLambertMaterial({ color: "#5aa838" }),
	);
	cap.position.set(-3.9, 6.6, 0.6);
	cap.scale.set(1, 0.32, 1);
	group.add(cap);
	// trees crowning the cliff
	const t1 = makeTree(1.2, 3);
	t1.position.set(-4.7, 6.8, -0.1);
	group.add(t1);
	const t2 = makeTree(0.95, 8);
	t2.position.set(-3.2, 6.7, 1.4);
	group.add(t2);

	// ---- a few scattered midground trees on the near slope -------------------
	const treeSpots: [number, number, number][] = [
		[6.5, -0.4, -3],
		[9, -1.2, -6],
		[-9, -2.5, -8],
		[4, -2.0, -10],
	];
	for (let i = 0; i < treeSpots.length; i++) {
		const [x, y, z] = treeSpots[i];
		const t = makeTree(0.85 + rand(i * 5) * 0.5, i * 7 + 2);
		t.position.set(x, y, z);
		group.add(t);
	}

	return group;
}
