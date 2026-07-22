// Sync the work-in-progress face cels into the expo assets so /dev/face-sheet can
// show them. For each of the 9 planned expressions it picks, in order:
//   1. ~/Desktop/sidekick-cels/<name>.png   (freshly generated)
//   2. ~/Desktop/sidekick-face-cells-used/<old>.png  (current shipped cell)
//   3. a "not generated" placeholder
// Writes packages/expo/assets/textures/cels-wip/<name>.png (512²). Re-run after
// each new generation. Run from repo root.

import sharp from "sharp";
import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const HOME = homedir();
const NEW = join(HOME, "Desktop/sidekick-cels");
const USED = join(HOME, "Desktop/sidekick-face-cells-used");
const WIP = "packages/expo/assets/textures/cels-wip";
mkdirSync(WIP, { recursive: true });

const NAMES = ["neutral", "blink", "excited", "surprised", "talkOpen", "talkClosed", "angry", "annoyed", "sad"];
const OLD = {
  neutral: "neutral_0-0.png",
  blink: "blink-happy_2-0.png",
  excited: "excited_3-0.png",
  surprised: "surprised_0-2.png",
  talkOpen: "talkOpen_2-2.png",
  talkClosed: "talkClosed_3-2.png",
};

async function placeholder(name, out) {
  const svg = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><text x="256" y="260" font-family="monospace" font-size="26" fill="#00000055" text-anchor="middle">${name}</text><text x="256" y="292" font-family="monospace" font-size="18" fill="#00000033" text-anchor="middle">not generated</text></svg>`,
  );
  await sharp({ create: { width: 512, height: 512, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: svg }])
    .png()
    .toFile(out);
}

for (const name of NAMES) {
  const out = join(WIP, `${name}.png`);
  const fresh = join(NEW, `${name}.png`);
  const old = OLD[name] ? join(USED, OLD[name]) : null;
  let src = null, tag = "placeholder";
  if (existsSync(fresh)) { src = fresh; tag = "new"; }
  else if (old && existsSync(old)) { src = old; tag = "old"; }
  if (src) await sharp(src).resize(512, 512).png().toFile(out);
  else await placeholder(name, out);
  console.log(`  ${name.padEnd(11)} ${tag}`);
}
console.log(`\nsynced 9 -> ${WIP}/`);
