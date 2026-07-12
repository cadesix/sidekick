// Strip embedded textures/images from the mascot + phone GLBs.
//
// three's GLTFLoader.parse() can't decode a GLB's embedded PNG/JPEG images in
// React Native (no DOM Image / createImageBitmap). In the shipped "cel" look the
// body renders as a flat color (celBodyColor) and the face uses a SEPARATE
// bundled sheet, so the mascot's baked albedo is never sampled — we drop it here
// so the GLB parses with zero image decoding. Geometry, skeleton, skinning and
// UVs are preserved untouched.
//
// Run: node scripts/strip-glb.mjs

import { NodeIO } from '@gltf-transform/core';
import { prune } from '@gltf-transform/functions';
import { readFileSync } from 'node:fs';

const io = new NodeIO();

async function strip(inPath, outPath) {
  const doc = await io.read(inPath);
  const root = doc.getRoot();

  // Null out every material texture slot, then dispose the texture resources.
  for (const mat of root.listMaterials()) {
    mat.setBaseColorTexture(null);
    mat.setNormalTexture(null);
    mat.setEmissiveTexture(null);
    mat.setOcclusionTexture(null);
    mat.setMetallicRoughnessTexture(null);
    // Give it a neutral base so the (replaced-at-runtime) material still valid.
    mat.setBaseColorFactor([1, 1, 1, 1]);
  }
  for (const tex of root.listTextures()) tex.dispose();

  // prune the now-orphaned samplers/images, but KEEP vertex attributes — the
  // FaceSprite plane still needs its UVs to sample the runtime face sheet.
  await doc.transform(prune({ keepAttributes: true, keepIndices: true }));

  await io.write(outPath, doc);
  const before = readFileSync(inPath).length;
  const after = readFileSync(outPath).length;
  console.log(
    `${inPath} -> ${outPath}: ${(before / 1024).toFixed(0)}KB -> ${(after / 1024).toFixed(0)}KB`,
  );
}

const base = 'assets/models';
await strip(`${base}/sidekick-rigged.glb`, `${base}/sidekick-rigged.stripped.glb`);
await strip(`${base}/phone.glb`, `${base}/phone.stripped.glb`);
// cosmetics slot GLBs (variant textures are separate bundled PNGs; the phone
// slot reuses assets/models/phone.stripped.glb — same file)
for (const slot of ['shirt', 'pants', 'hat', 'shoes']) {
  await strip(`assets/cosmetics/${slot}/base-v1.glb`, `assets/cosmetics/${slot}/base-v1.stripped.glb`);
}
console.log('done');
