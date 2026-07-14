// Face-sheet transparent conversion: white-background sprite sheet (gpt-image
// output) → RGBA sheet for the FaceSprite plane (public/face-sheet-vN.png).
//
// The naive approach — keying alpha off whiteness globally — deletes the white
// teeth and eye glints. Instead, background is identified by FLOOD FILL from
// the image border, so whites enclosed by artwork stay opaque:
//   - reachable near-white px (the background)          → alpha 0
//   - art px within EDGE_PAD of the background          → alpha from white-matte
//     unpremultiply (soft feathered edge, no white halo)
//   - everything else (teeth, glints, mouth interiors)  → opaque, RGB untouched
//
// Usage: node tools/char-pipeline/scripts/face_sheet_convert.mjs \
//          tools/char-pipeline/face-sheet-source.png \
//          packages/web/public/face-sheet-v5.png
// Run from the repo root (resolves sharp from the root node_modules).

import sharp from "sharp";

const [src = "tools/char-pipeline/face-sheet-source.png", out = "packages/web/public/face-sheet-v5.png"] =
	process.argv.slice(2);

const OUT_SIZE = 2048; // 4×4 grid of 512px cells (facesprite-contract.md)
const BG_MIN = 235; // px with min(r,g,b) >= this can be background
const EDGE_PAD = 2; // art px this close to background get feathered alpha

const { data, info } = await sharp(src).removeAlpha().raw().toBuffer({ resolveWithObject: true });
const W = info.width, H = info.height;
const minC = (i) => Math.min(data[i * 3], data[i * 3 + 1], data[i * 3 + 2]);

// flood fill from every border pixel across near-white background
const reachable = new Uint8Array(W * H);
const queue = [];
for (let x = 0; x < W; x++) queue.push(x, (H - 1) * W + x);
for (let y = 0; y < H; y++) queue.push(y * W, y * W + W - 1);
for (const i of queue) if (minC(i) >= BG_MIN) reachable[i] = 1; else queue; // seed only bg px
let head = 0;
const stack = queue.filter((i) => reachable[i]);
while (head < stack.length) {
	const i = stack[head++];
	const x = i % W, y = (i / W) | 0;
	for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
		const nx = x + dx, ny = y + dy;
		if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
		const n = ny * W + nx;
		if (!reachable[n] && minC(n) >= BG_MIN) {
			reachable[n] = 1;
			stack.push(n);
		}
	}
}

// edge zone: art pixels within EDGE_PAD of background (chebyshev distance)
const nearBg = new Uint8Array(W * H);
for (let y = 0; y < H; y++)
	for (let x = 0; x < W; x++) {
		const i = y * W + x;
		if (!reachable[i]) continue;
		for (let dy = -EDGE_PAD; dy <= EDGE_PAD; dy++)
			for (let dx = -EDGE_PAD; dx <= EDGE_PAD; dx++) {
				const nx = x + dx, ny = y + dy;
				if (nx >= 0 && ny >= 0 && nx < W && ny < H) nearBg[ny * W + nx] = 1;
			}
	}

const rgba = Buffer.alloc(W * H * 4);
let teethSaved = 0;
for (let i = 0; i < W * H; i++) {
	const r = data[i * 3], g = data[i * 3 + 1], b = data[i * 3 + 2];
	let a, or = r, og = g, ob = b;
	if (reachable[i]) {
		a = 0;
	} else if (nearBg[i]) {
		// white-matte unpremultiply: recover the stroke color under the AA blend
		a = 255 - minC(i);
		if (a > 0) {
			const k = 255 / a;
			or = Math.min(255, Math.max(0, Math.round((r - (255 - a)) * k)));
			og = Math.min(255, Math.max(0, Math.round((g - (255 - a)) * k)));
			ob = Math.min(255, Math.max(0, Math.round((b - (255 - a)) * k)));
		}
	} else {
		a = 255; // interior: teeth, glints, mouth fills — keep as drawn
		if (minC(i) >= 200) teethSaved++;
	}
	rgba[i * 4] = or;
	rgba[i * 4 + 1] = og;
	rgba[i * 4 + 2] = ob;
	rgba[i * 4 + 3] = a;
}

await sharp(rgba, { raw: { width: W, height: H, channels: 4 } })
	.resize(OUT_SIZE, OUT_SIZE, { kernel: "lanczos3" })
	.png()
	.toFile(out);

console.log(`${src} (${W}x${H}) -> ${out} (${OUT_SIZE}x${OUT_SIZE})`);
console.log(`interior near-white pixels kept opaque (teeth/glints): ${teethSaved}`);
