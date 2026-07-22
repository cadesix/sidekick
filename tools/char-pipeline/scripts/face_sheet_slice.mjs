// Slice the face sheet into 16 individual 512×512 cell PNGs, so each expression
// can be edited / copied on its own. Output keeps full transparency (the cells
// composite onto the yellow head in-app).
//
//   node tools/char-pipeline/scripts/face_sheet_slice.mjs [sheet.png]
//
// Writes tools/char-pipeline/face-cells/face-cell-{col}-{row}.png (col,row 0..3),
// matching the [col,row] labels in /dev/face-sheet. Re-slice after editing the
// sheet; to go the other way (cells → sheet) just lay them back on the grid.
// Run from the repo root (resolves sharp from the root node_modules).

import sharp from "sharp";
import { mkdirSync } from "node:fs";

const SHEET = process.argv[2] ?? "packages/expo/assets/textures/face-sheet-v6.png";
const OUT = "tools/char-pipeline/face-cells";
const GRID = 4;
const CELL = 512; // 2048 / 4

// coord → expression (mirrors FACE_CELLS); "" = art present but unmapped/empty
const LABELS = {
  "0,0": "neutral", "1,0": "", "2,0": "blink/happy", "3,0": "excited",
  "0,1": "cheer", "1,1": "sad", "2,1": "sleepy", "3,1": "thinking",
  "0,2": "surprised", "1,2": "wink", "2,2": "talkOpen", "3,2": "talkClosed",
  "0,3": "", "1,3": "", "2,3": "", "3,3": "",
};

mkdirSync(OUT, { recursive: true });

for (let r = 0; r < GRID; r++)
  for (let c = 0; c < GRID; c++) {
    const file = `${OUT}/face-cell-${c}-${r}.png`;
    await sharp(SHEET)
      .extract({ left: c * CELL, top: r * CELL, width: CELL, height: CELL })
      .png()
      .toFile(file);
    const name = LABELS[`${c},${r}`];
    console.log(`  [${c},${r}] ${name || "(unmapped)"} -> ${file}`);
  }

console.log(`\n16 cells written to ${OUT}/ (each ${CELL}×${CELL}, transparent).`);
