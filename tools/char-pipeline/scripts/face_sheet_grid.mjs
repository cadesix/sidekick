// Face-sheet grid guides for hand-authoring expressions.
//
// Emits two 2048×2048 PNGs (the app samples a 4×4 grid of 512px cells):
//   - face-sheet-grid-template.png : TRANSPARENT + gridlines/labels. Build your
//       16 expressions on this, one per cell, on transparency. Export the flat
//       RGBA sheet (hide the guide layer) → that IS the v6 format; no convert
//       step needed, so it can't eat teeth.
//   - face-sheet-grid-overlay.png  : the CURRENT sheet under the same grid, as a
//       size/placement reference for matching the existing look.
//
// Cell labels mirror FACE_CELLS in packages/expo/src/three/face.ts — keep in sync
// if that table changes (the /dev/face-sheet screen shows the live mapping).
//
// Usage: node tools/char-pipeline/scripts/face_sheet_grid.mjs
// Run from the repo root (resolves sharp from the root node_modules).

import sharp from "sharp";

const SIZE = 2048;
const GRID = 4;
const CELL = SIZE / GRID; // 512
const V6 = "packages/expo/assets/textures/face-sheet-v6.png";

// [col][row] → expression name(s); "" = empty cell. Mirrors FACE_CELLS.
const LABELS = {
  "0,0": "neutral", "1,0": "", "2,0": "blink/happy", "3,0": "excited",
  "0,1": "cheer", "1,1": "sad", "2,1": "sleepy", "3,1": "thinking",
  "0,2": "surprised", "1,2": "wink", "2,2": "talkOpen", "3,2": "talkClosed",
  "0,3": "", "1,3": "", "2,3": "", "3,3": "",
};

const PINK = "#ff2d95";
const parts = [`<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}">`];

// per-cell centre crosshair (faint, dashed) — for centring a face in its cell
for (let c = 0; c < GRID; c++)
  for (let r = 0; r < GRID; r++) {
    const cx = c * CELL + CELL / 2;
    const cy = r * CELL + CELL / 2;
    parts.push(
      `<line x1="${cx}" y1="${r * CELL}" x2="${cx}" y2="${(r + 1) * CELL}" stroke="${PINK}" stroke-width="1.5" stroke-dasharray="10 12" opacity="0.35"/>`,
      `<line x1="${c * CELL}" y1="${cy}" x2="${(c + 1) * CELL}" y2="${cy}" stroke="${PINK}" stroke-width="1.5" stroke-dasharray="10 12" opacity="0.35"/>`,
    );
  }

// solid cell boundaries (the lines to align to)
for (let i = 0; i <= GRID; i++) {
  const p = i * CELL;
  const w = i === 0 || i === GRID ? 4 : 2.5;
  parts.push(
    `<line x1="${p}" y1="0" x2="${p}" y2="${SIZE}" stroke="${PINK}" stroke-width="${w}" opacity="0.9"/>`,
    `<line x1="0" y1="${p}" x2="${SIZE}" y2="${p}" stroke="${PINK}" stroke-width="${w}" opacity="0.9"/>`,
  );
}

// cell labels (coord + expression) top-left of each cell
for (let c = 0; c < GRID; c++)
  for (let r = 0; r < GRID; r++) {
    const name = LABELS[`${c},${r}`];
    const x = c * CELL + 12;
    const y = r * CELL + 30;
    parts.push(
      `<text x="${x}" y="${y}" font-family="monospace" font-size="22" font-weight="700" fill="${PINK}">${c},${r}</text>`,
    );
    if (name)
      parts.push(
        `<text x="${x}" y="${y + 26}" font-family="monospace" font-size="19" fill="${PINK}" opacity="0.8">${name}</text>`,
      );
  }
parts.push(`</svg>`);
const svg = Buffer.from(parts.join(""));

// 1) transparent template
await sharp({ create: { width: SIZE, height: SIZE, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
  .composite([{ input: svg }])
  .png()
  .toFile("tools/char-pipeline/face-sheet-grid-template.png");

// 2) current sheet + same grid (reference)
await sharp(V6).resize(SIZE, SIZE).composite([{ input: svg }]).png().toFile("tools/char-pipeline/face-sheet-grid-overlay.png");

console.log("wrote tools/char-pipeline/face-sheet-grid-template.png (transparent, build on this)");
console.log("wrote tools/char-pipeline/face-sheet-grid-overlay.png (current sheet, reference)");
