// Build the night sky's constellation of the sidekick, as 3D star data.
//
//   node scripts/build-star-face.mjs [--preview]
//
// Everything here is precomputed and committed as JSON: the app just loads
// points and draws them. That's deliberate — this needs triangle rasterisation,
// contour tracing and ray casting, none of which we want on the phone at launch,
// and expo-gl can't read pixels back anyway. Re-run it if the model or the face
// sheet changes (same deal as scripts/strip-glb.mjs).
//
// It is a drawn constellation sitting inside a cloud. The silhouette and the
// eyes/mouth are exact traced contours, joined by faint lines — that's what
// makes it legible as the sidekick rather than a smudge. Volume dust over the
// whole head, front and back, keeps it from reading as a flat decal.
//
// (A density-only pass — stars crowded near the contour, no lines — went too
// far: without the lines the eye stops closing the shape and it turns to soup.)
//
// The pipeline:
//   1. carve the head off the body by skin weight (>=50% bound to the Head bone)
//   2. rasterise the head's triangles head-on and CONTOUR TRACE the result, so
//      the silhouette keeps its concavities — the notch where each ear meets the
//      dome. (Walking rays out from the centre, as this used to, can only ever
//      produce a convex blob: no ear notches, no jaw.)
//   3. trace the eyes/mouth out of the face sheet the same way
//   4. walk those contours at even arc length and drop each point onto the
//      head's real surface, so the face wraps the dome in 3D
//   5. scatter dust over the whole surface for volume: front and back
//
// Axes: the character faces +X (avatar.ts frames its head shot "dead-on from
// +X"), so constellation space is a remap of model space:
//     right = -z_model,  up = +y_model,  toward-viewer = +x_model
// Output is centred on the head and normalised to 1 unit across; the renderer
// scales it to STAR_HEAD_SIZE.

import { Buffer } from 'node:buffer';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { NodeIO } from '@gltf-transform/core';
import sharp from 'sharp';

const HERE = dirname(fileURLToPath(import.meta.url));
const GLB = join(HERE, '../assets/models/sidekick-rigged.stripped.glb');
const SHEET = join(HERE, '../assets/textures/face-sheet-v6.png');
const OUT_JSON = join(HERE, '../src/three/star-face.json');
const OUT_PREVIEW = join(HERE, '../src/three/star-face.preview.png');

const HEAD_BONE = 'Head';
const GRID = 4; // face.ts: the sheet is 4x4
const CELL = { col: 0, row: 0 }; // 'neutral' — the resting smile
const ALPHA_MIN = 128;
const MIN_BLOB = 400;
const RASTER = 512; // silhouette mask resolution

// stars on each traced contour — the drawn part
const SIL_POINTS = 64;
const EYE_POINTS = 14;
const MOUTH_POINTS = 26;
const FACE_LIFT = 0.012; // push face stars just off the surface so they read
// the cloud the constellation hangs in. Heavy enough to read as volume, sparse
// enough that it never competes with the contours for the eye.
const DUST = 440;

// brightness weights — contours carry the read, dust is atmosphere
const W_LINE = 1.0;
const W_DUST = 0.4;

// ---------------------------------------------------------------- mesh loading
const doc = await new NodeIO().read(GLB);
const root = doc.getRoot();
const headIdx = root.listSkins()[0].listJoints().findIndex((j) => j.getName() === HEAD_BONE);
if (headIdx < 0) throw new Error(`no ${HEAD_BONE} joint`);

let bodyPrim = null;
let facePrim = null;
for (const mesh of root.listMeshes()) {
  for (const prim of mesh.listPrimitives()) {
    if (prim.getMaterial()?.getName() === 'FaceSprite') facePrim = prim;
    else if (!bodyPrim || prim.getAttribute('POSITION').getCount() > bodyPrim.getAttribute('POSITION').getCount()) bodyPrim = prim;
  }
}
if (!bodyPrim) throw new Error('no body primitive');

const pos = bodyPrim.getAttribute('POSITION');
const jo = bodyPrim.getAttribute('JOINTS_0');
const we = bodyPrim.getAttribute('WEIGHTS_0');
const idx = bodyPrim.getIndices();

const toCon = (p) => [-p[2], p[1], p[0]]; // model space -> constellation space

const tmp = [0, 0, 0];
const j4 = [0, 0, 0, 0];
const w4 = [0, 0, 0, 0];

const isHead = new Uint8Array(pos.getCount());
for (let i = 0; i < pos.getCount(); i++) {
  jo.getElement(i, j4);
  we.getElement(i, w4);
  let hw = 0;
  for (let k = 0; k < 4; k++) if (j4[k] === headIdx) hw += w4[k];
  isHead[i] = hw >= 0.5 ? 1 : 0;
}

const V = [];
for (let i = 0; i < pos.getCount(); i++) {
  pos.getElement(i, tmp);
  V.push(toCon(tmp));
}

const tris = [];
for (let t = 0; t < idx.getCount(); t += 3) {
  const a = idx.getScalar(t);
  const b = idx.getScalar(t + 1);
  const c = idx.getScalar(t + 2);
  if (isHead[a] && isHead[b] && isHead[c]) tris.push([a, b, c]);
}
if (!tris.length) throw new Error('no head triangles');

let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
for (let i = 0; i < V.length; i++) {
  if (!isHead[i]) continue;
  const [x, y, z] = V[i];
  if (x < x0) x0 = x;
  if (x > x1) x1 = x;
  if (y < y0) y0 = y;
  if (y > y1) y1 = y;
  if (z < z0) z0 = z;
  if (z > z1) z1 = z;
}
const cx = (x0 + x1) / 2;
const cy = (y0 + y1) / 2;
const cz = (z0 + z1) / 2; // centre depth too, or it spins about its own nose
const maxDim = Math.max(x1 - x0, y1 - y0);
const norm = ([x, y, z]) => [(x - cx) / maxDim, (y - cy) / maxDim, (z - cz) / maxDim];

// ------------------------------------------------------------------ utilities
// deterministic low-discrepancy sequence — no Math.random in scene data, so the
// sky looks identical every run (same rule the rest of the renderer follows)
function halton(i, b) {
  let f = 1;
  let r = 0;
  let n = i;
  while (n > 0) {
    f /= b;
    r += f * (n % b);
    n = Math.floor(n / b);
  }
  return r;
}
function traceContour(m, w, h) {
  let sx = -1, sy = -1;
  for (let y = 0; y < h && sy < 0; y++) {
    for (let x = 0; x < w; x++) {
      if (m[y * w + x]) { sx = x; sy = y; break; }
    }
  }
  if (sy < 0) return [];
  const dirs = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
  const at = (x, y) => (x >= 0 && y >= 0 && x < w && y < h ? m[y * w + x] : 0);
  const out = [[sx, sy]];
  let cur = [sx, sy];
  let back = 4;
  for (let guard = 0; guard < w * h * 4; guard++) {
    let found = false;
    for (let k = 1; k <= 8; k++) {
      const d = (back + k) % 8;
      const nx = cur[0] + dirs[d][0];
      const ny = cur[1] + dirs[d][1];
      if (!at(nx, ny)) continue;
      back = (d + 5) % 8;
      cur = [nx, ny];
      found = true;
      break;
    }
    if (!found) break;
    if (cur[0] === sx && cur[1] === sy) break;
    out.push(cur);
  }
  return out;
}

// even spacing along the path by arc length, not index, so long straight runs
// don't hog stars and tight curves don't get starved. Also returns the local
// tangent, which is what the jitter is thrown perpendicular to.
function walk(path, n) {
  if (path.length < 2) return [];
  const closed = [...path, path[0]];
  const cum = [0];
  for (let i = 1; i < closed.length; i++) {
    cum.push(cum[i - 1] + Math.hypot(closed[i][0] - closed[i - 1][0], closed[i][1] - closed[i - 1][1]));
  }
  const total = cum[cum.length - 1];
  const out = [];
  for (let i = 0; i < n; i++) {
    const target = (i / n) * total;
    let k = 1;
    while (k < cum.length - 1 && cum[k] < target) k++;
    const t = (target - cum[k - 1]) / (cum[k] - cum[k - 1] || 1);
    const p = [
      closed[k - 1][0] + (closed[k][0] - closed[k - 1][0]) * t,
      closed[k - 1][1] + (closed[k][1] - closed[k - 1][1]) * t,
    ];
    const tx = closed[k][0] - closed[k - 1][0];
    const ty = closed[k][1] - closed[k - 1][1];
    const len = Math.hypot(tx, ty) || 1;
    out.push({ p, perp: [-ty / len, tx / len] });
  }
  return out;
}

// ------------------------------------------------------- silhouette by contour
const PAD = 8;
const sxOf = (x) => ((x - x0) / (x1 - x0)) * (RASTER - 2 * PAD) + PAD;
const syOf = (y) => (1 - (y - y0) / (y1 - y0)) * (RASTER - 2 * PAD) + PAD;
const unSx = (px) => ((px - PAD) / (RASTER - 2 * PAD)) * (x1 - x0) + x0;
const unSy = (py) => (1 - (py - PAD) / (RASTER - 2 * PAD)) * (y1 - y0) + y0;
const mask = new Uint8Array(RASTER * RASTER);

for (const [ia, ib, ic] of tris) {
  const ax = sxOf(V[ia][0]), ay = syOf(V[ia][1]);
  const bx = sxOf(V[ib][0]), by = syOf(V[ib][1]);
  const cx2 = sxOf(V[ic][0]), cy2 = syOf(V[ic][1]);
  const minX = Math.max(0, Math.floor(Math.min(ax, bx, cx2)));
  const maxX = Math.min(RASTER - 1, Math.ceil(Math.max(ax, bx, cx2)));
  const minY = Math.max(0, Math.floor(Math.min(ay, by, cy2)));
  const maxY = Math.min(RASTER - 1, Math.ceil(Math.max(ay, by, cy2)));
  const den = (by - cy2) * (ax - cx2) + (cx2 - bx) * (ay - cy2);
  if (Math.abs(den) < 1e-12) continue;
  for (let py = minY; py <= maxY; py++) {
    for (let px = minX; px <= maxX; px++) {
      const l1 = ((by - cy2) * (px + 0.5 - cx2) + (cx2 - bx) * (py + 0.5 - cy2)) / den;
      const l2 = ((cy2 - ay) * (px + 0.5 - cx2) + (ax - cx2) * (py + 0.5 - cy2)) / den;
      const l3 = 1 - l1 - l2;
      if (l1 >= -0.002 && l2 >= -0.002 && l3 >= -0.002) mask[py * RASTER + px] = 1;
    }
  }
}

// ------------------------------------------- depth: drop a 2D point on the head
// The ray runs along the projection axis, so an intersection is just a
// point-in-projected-triangle test with the depth read off by barycentrics.
function surfaceZ(x, y, frontmost = true) {
  let best = null;
  for (const [ia, ib, ic] of tris) {
    const [ax, ay, az] = V[ia];
    const [bx, by, bz] = V[ib];
    const [cx2, cy2, cz2] = V[ic];
    const den = (by - cy2) * (ax - cx2) + (cx2 - bx) * (ay - cy2);
    if (Math.abs(den) < 1e-12) continue;
    const l1 = ((by - cy2) * (x - cx2) + (cx2 - bx) * (y - cy2)) / den;
    const l2 = ((cy2 - ay) * (x - cx2) + (ax - cx2) * (y - cy2)) / den;
    const l3 = 1 - l1 - l2;
    if (l1 < 0 || l2 < 0 || l3 < 0) continue;
    const z = l1 * az + l2 * bz + l3 * cz2;
    if (best === null || (frontmost ? z > best : z < best)) best = z;
  }
  return best;
}

// Walk a traced contour at even arc length and drop each point onto the head.
//
// A sample is lost when its ray misses every triangle. A few is normal (the
// contour rides the outermost pixel), but silence here is dangerous: a model or
// face-sheet change could gut a feature and still write a plausible-looking
// star-face.json, with the renderer happily closing a malformed loop. So the
// loss is always reported, and a big one fails the build instead of shipping.
const MISS_TOLERANCE = 0.1;

function traceLoop(name, pathPx, count, toXY, zAt) {
  const out = [];
  let missed = 0;
  for (const { p } of walk(pathPx, count)) {
    const [x, y] = toXY(p[0], p[1]);
    const z = zAt(x, y);
    if (z === null) {
      missed++;
      continue;
    }
    out.push(norm([x, y, z]));
  }
  if (missed) {
    const detail = `${name}: ${missed}/${count} samples missed the head surface`;
    if (missed / count > MISS_TOLERANCE) {
      throw new Error(
        `[star-face] ${detail} — over ${MISS_TOLERANCE * 100}%, so the traced feature is unreliable. ` +
          `Check the GLB/face sheet before regenerating.`,
      );
    }
    console.warn(`[star-face] ${detail} (within tolerance)`);
  }
  return out;
}

const rimZ = (x, y) => {
  // The rim is where the front and back surfaces meet, so their midpoint is its
  // depth. The contour rides the outermost pixel, which can land a hair outside
  // every triangle — so creep toward the centre until the ray lands rather than
  // dropping the star and thinning the outline.
  for (let step = 0; step <= 6; step++) {
    const t = step * 0.004;
    const px = x + (cx - x) * t;
    const py = y + (cy - y) * t;
    const zf = surfaceZ(px, py, true);
    const zb = surfaceZ(px, py, false);
    if (zf !== null && zb !== null) return (zf + zb) / 2;
    if (zf !== null) return zf;
  }
  return null;
};
const silhouette = traceLoop('head', traceContour(mask, RASTER, RASTER), SIL_POINTS, (px, py) => [unSx(px), unSy(py)], rimZ);

// ------------------------------------------------------------ face from sheet
const img = sharp(SHEET);
const meta = await img.metadata();
const cellSize = Math.floor(meta.width / GRID);
const { data, info } = await img
  .extract({ left: CELL.col * cellSize, top: CELL.row * cellSize, width: cellSize, height: cellSize })
  .ensureAlpha()
  .raw()
  .toBuffer({ resolveWithObject: true });
const FW = info.width;
const FH = info.height;
const alphaAt = (x, y) => data[(y * FW + x) * info.channels + 3];

const label = new Int32Array(FW * FH).fill(-1);
const blobs = [];
for (let y = 0; y < FH; y++) {
  for (let x = 0; x < FW; x++) {
    const at0 = y * FW + x;
    if (label[at0] !== -1 || alphaAt(x, y) < ALPHA_MIN) continue;
    const id = blobs.length;
    const px = [];
    const stack = [at0];
    label[at0] = id;
    while (stack.length) {
      const p = stack.pop();
      const py = (p / FW) | 0;
      const pxx = p % FW;
      px.push([pxx, py]);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = pxx + dx;
        const ny = py + dy;
        if (nx < 0 || ny < 0 || nx >= FW || ny >= FH) continue;
        const np = ny * FW + nx;
        if (label[np] !== -1 || alphaAt(nx, ny) < ALPHA_MIN) continue;
        label[np] = id;
        stack.push(np);
      }
    }
    blobs.push(px);
  }
}
const kept = blobs.filter((b) => b.length >= MIN_BLOB).sort((a, b) => b.length - a.length);
if (kept.length < 3) throw new Error(`expected >=3 face shapes, found ${kept.length}`);
const [mouthPx, ...restPx] = kept;
const eyePx = restPx.slice(0, 2).sort((a, b) => {
  const ax = a.reduce((s, p) => s + p[0], 0) / a.length;
  const bx = b.reduce((s, p) => s + p[0], 0) / b.length;
  return ax - bx;
});
const blobPath = (px) => {
  const m = new Uint8Array(FW * FH);
  for (const [x, y] of px) m[y * FW + x] = 1;
  return traceContour(m, FW, FH);
};

// the face quad's rect, head-on — where the sheet's art actually sits
const fp = facePrim.getAttribute('POSITION');
let fx0 = Infinity, fx1 = -Infinity, fy0 = Infinity, fy1 = -Infinity;
for (let i = 0; i < fp.getCount(); i++) {
  fp.getElement(i, tmp);
  const [x, y] = toCon(tmp);
  if (x < fx0) fx0 = x;
  if (x > fx1) fx1 = x;
  if (y < fy0) fy0 = y;
  if (y > fy1) fy1 = y;
}
const fwid = fx1 - fx0;
const fhei = fy1 - fy0;
const faceXY = (ix, iy) => [fx0 + (ix / FW) * fwid, fy1 - (iy / FH) * fhei];
const faceZ = (x, y) => {
  const z = surfaceZ(x, y, true);
  return z === null ? null : z + FACE_LIFT; // sit just proud of the dome
};

const loops = [
  { name: 'head', points: silhouette },
  { name: 'eyeL', points: traceLoop('eyeL', blobPath(eyePx[0]), EYE_POINTS, faceXY, faceZ) },
  { name: 'eyeR', points: traceLoop('eyeR', blobPath(eyePx[1]), EYE_POINTS, faceXY, faceZ) },
  { name: 'mouth', points: traceLoop('mouth', blobPath(mouthPx), MOUTH_POINTS, faceXY, faceZ) },
];

// ------------------------------------------------------------------- the dust
let area = 0;
const triAreas = tris.map(([ia, ib, ic]) => {
  const a = V[ia], b = V[ib], c = V[ic];
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
  const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  const s = 0.5 * Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
  area += s;
  return s;
});
const dust = [];
let acc = 0;
let want = 0;
for (let t = 0; t < tris.length; t++) {
  acc += triAreas[t];
  while (want < DUST && acc / area > (want + 0.5) / DUST) {
    const [ia, ib, ic] = tris[t];
    let u = halton(want + 1, 2);
    let v = halton(want + 1, 3);
    if (u + v > 1) { u = 1 - u; v = 1 - v; }
    const w = 1 - u - v;
    const p = [0, 1, 2].map((k) => V[ia][k] * w + V[ib][k] * u + V[ic][k] * v);
    dust.push(norm(p));
    want++;
  }
}

const round = (a, d = 4) => a.map((c) => +c.toFixed(d));
writeFileSync(
  OUT_JSON,
  JSON.stringify(
    {
      _generated: 'scripts/build-star-face.mjs — do not edit by hand',
      loops: loops.map((l) => ({ name: l.name, points: l.points.map((p) => round(p)) })),
      dust: { positions: dust.map((p) => round(p)) },
    },
    null,
    0,
  ) + '\n',
);
console.log(
  `[star-face] loops ${loops.map((l) => `${l.name}:${l.points.length}`).join(' ')} · dust ${dust.length} → ${OUT_JSON}`,
);

// ------------------------------------------------------------------- preview
if (process.argv.includes('--preview')) {
  const S = 760;
  // two panels: even, and mid-shine, to show the travelling shine's range
  const panels = [0, 1].map((vi) => {
    const at = ([x, y, z]) => [S / 2 + x * S * 0.78 + vi * S, S / 2 - y * S * 0.78, z];
    const shine = (x, y) => (vi === 0 ? 1 : 0.55 + 0.45 * Math.sin(x * 4.2 + y * 2.1));
    const dusty = dust
      .map((p) => {
        const [px, py, pz] = at(p);
        const near = Math.min(1, Math.max(0, pz / 0.7 + 0.5));
        const o = W_DUST * (0.25 + 0.75 * near) * shine(p[0], p[1]);
        return `<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="${(0.7 + 1.2 * near).toFixed(2)}" fill="#cfc6ff" opacity="${Math.min(1, o).toFixed(2)}"/>`;
      })
      .join('');
    const drawn = loops
      .map((l) => {
        const pts = l.points.map(at);
        const poly = pts.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
        const dots = pts
          .map((p, i) => {
            const near = Math.min(1, Math.max(0, p[2] / 0.7 + 0.5));
            const o = W_LINE * (0.35 + 0.65 * near) * shine(l.points[i][0], l.points[i][1]);
            return `<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="${(1.1 + 1.3 * near).toFixed(2)}" fill="#f0ecff" opacity="${Math.min(1, o).toFixed(2)}"/>`;
          })
          .join('');
        // faint: the lines should suggest the join, not draw the character
        return `<polygon points="${poly}" fill="none" stroke="#8f83e8" stroke-width="0.8" opacity="0.22"/>${dots}`;
      })
      .join('');
    return dusty + drawn;
  });
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${S * 2}" height="${S}"><rect width="${S * 2}" height="${S}" fill="#070315"/>${panels.join('')}</svg>`;
  await sharp(Buffer.from(svg)).png().toFile(OUT_PREVIEW);
  console.log(`[star-face] preview (even | mid-shine) → ${OUT_PREVIEW}`);
}
