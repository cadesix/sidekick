// Trim the light tan/cream lip-rim that gpt leaves around isolated mouths.
// Flood-fills inward from the transparent border, eating connected light warm
// pixels (the rim) and stopping at saturated red lips, dark interior, or teeth
// enclosed behind them. Writes cleaned copies to <dir>/clean/<name>.png.
//
//   node tools/char-pipeline/scripts/face_defringe.mjs
//
// Run from repo root (resolves sharp from root node_modules).

import sharp from "sharp";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const DIR = join(homedir(), "Desktop/sidekick-faces-v2");
const CLEAN = join(DIR, "clean");
mkdirSync(CLEAN, { recursive: true });
const NAMES = ["neutral", "blink", "happy", "excited", "surprised", "talkOpen", "talkClosed", "angry", "annoyed"];

// A pixel the flood may pass through / remove: already transparent, OR an opaque
// LIGHT WARM pixel (tan/cream/peach rim). Must be WARM (r noticeably > b) so we
// eat the tan lip surround but NOT the neutral-white teeth, which are light too
// and connect to the exterior through an open mouth (the old teeth-eating bug).
function eatable(data, i) {
  const a = data[i * 4 + 3];
  if (a < 30) return true; // transparent — passable
  const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
  const mn = Math.min(r, g, b);
  if (mn <= 120) return false; // dark (eyes) or a saturated channel (red lips/tongue)
  if (r - b <= 25) return false; // neutral white (teeth) — NOT warm, keep it
  if (r - Math.max(g, b) > 55) return false; // saturated red/orange
  return true; // light WARM tan/peach rim
}

for (const name of NAMES) {
  const { data, info } = await sharp(join(DIR, `${name}.png`))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const W = info.width, H = info.height;
  const gone = new Uint8Array(W * H);
  const stack = [];
  const push = (x, y) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const i = y * W + x;
    if (gone[i] || !eatable(data, i)) return;
    gone[i] = 1;
    stack.push(i);
  };
  for (let x = 0; x < W; x++) { push(x, 0); push(x, H - 1); }
  for (let y = 0; y < H; y++) { push(0, y); push(W - 1, y); }
  while (stack.length) {
    const i = stack.pop();
    const x = i % W, y = (i / W) | 0;
    push(x + 1, y); push(x - 1, y); push(x, y + 1); push(x, y - 1);
  }
  let trimmed = 0;
  for (let i = 0; i < W * H; i++) {
    if (gone[i] && data[i * 4 + 3] !== 0) { data[i * 4 + 3] = 0; trimmed++; }
  }
  await sharp(data, { raw: { width: W, height: H, channels: 4 } }).png().toFile(join(CLEAN, `${name}.png`));
  console.log(`  ${name}: trimmed ${trimmed} rim px`);
}
console.log(`\ncleaned 9 -> ${CLEAN}/`);
