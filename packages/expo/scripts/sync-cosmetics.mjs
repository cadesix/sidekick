// Sync the canonical cosmetics catalog into the Expo app's bundled assets.
//
// The catalog under packages/web/public/cosmetics/ is the canonical art source
// — the Blender char-pipeline (tools/char-pipeline) writes there. That package
// is otherwise DEPRECATED; this asset home is the main thing keeping it alive
// and is slated to move (see docs/MONOREPO.md), at which point repoint SRC below.
//
// The catalog is authored web-style: a manifest.json fetched at runtime with
// .webp textures + GLBs loaded by URL. Metro can't do either — bundled assets
// must be static require() calls and expo-gl can't decode .webp — so we mirror
// the catalog into packages/expo:
//   • every slot/variant GLB is stripped of embedded images (RN GLTFLoader can't
//     decode them) and written as <name>.stripped.glb, same layout as web
//     (assets/cosmetics/<slotdir>/…),
//   • every variant .webp texture is converted to .png (via macOS `sips`),
//   • shop-render product art (.png) and the lootbox prop GLB are copied over,
//   • cosmetics-manifest.ts (require()-based manifest) and shop-renders.ts
//     (renderKey → require map) are codegen'd from what was actually copied,
//   • the pure catalog data (slot ids + variant ids/names, no asset refs) is
//     codegen'd into @sidekick/core (src/catalog-variants.ts) — the checked-in
//     canonical catalog the server and the app both build shop products from.
//
// Re-run any time the canonical catalog changes:  node scripts/sync-cosmetics.mjs
//
// Requires: @gltf-transform/{core,functions} (hoisted in the monorepo root) and
// macOS `sips` for webp→png.

import { NodeIO } from '@gltf-transform/core';
import { prune } from '@gltf-transform/functions';
import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const EXPO = join(__dirname, '..'); // packages/expo
const WEB_PUBLIC = join(EXPO, '..', 'web', 'public'); // packages/web/public
const COS_SRC = join(WEB_PUBLIC, 'cosmetics');
const COS_DST = join(EXPO, 'assets', 'cosmetics');
const SRC_DIR = join(EXPO, 'src', 'three');

const io = new NodeIO();

// --- helpers ---------------------------------------------------------------

const ensureDir = (d) => mkdirSync(d, { recursive: true });

// Strip embedded textures/images from a GLB so RN's GLTFLoader.parse() never has
// to decode a PNG/JPEG (no DOM Image in Hermes). Geometry/skeleton/UVs kept.
async function stripGlb(inPath, outPath) {
  const doc = await io.read(inPath);
  const root = doc.getRoot();
  for (const mat of root.listMaterials()) {
    mat.setBaseColorTexture(null);
    mat.setNormalTexture(null);
    mat.setEmissiveTexture(null);
    mat.setOcclusionTexture(null);
    mat.setMetallicRoughnessTexture(null);
    mat.setBaseColorFactor([1, 1, 1, 1]);
  }
  for (const tex of root.listTextures()) tex.dispose();
  await doc.transform(prune({ keepAttributes: true, keepIndices: true }));
  await io.write(outPath, doc);
}

// webp → png via macOS sips (built-in, no extra deps).
function webpToPng(inPath, outPath) {
  execFileSync('sips', ['-s', 'format', 'png', inPath, '--out', outPath], {
    stdio: ['ignore', 'ignore', 'pipe'],
  });
}

// "/cosmetics/shirt/hoodie-v1.glb" → { dir: "shirt", name: "hoodie-v1" }
function slotDirAndName(publicPath) {
  const parts = publicPath.replace(/^\//, '').split('/'); // [cosmetics, shirt, hoodie-v1.glb]
  return { dir: parts[1], file: parts[parts.length - 1], name: basename(parts[parts.length - 1], '.glb') };
}

const missing = [];
let glbCount = 0;
let texCount = 0;

// --- 1. GLBs + textures, driven by the web manifest ------------------------

const manifest = JSON.parse(readFileSync(join(COS_SRC, 'manifest.json'), 'utf8'));

// Emitted manifest entries, in the web manifest's own key order.
const entries = [];

for (const [id, def] of Object.entries(manifest)) {
  const { dir, name } = slotDirAndName(def.model);
  ensureDir(join(COS_DST, dir));

  // model ref for codegen. The phone reuses the already-bundled mascot phone GLB
  // (byte-identical to public/cosmetics/phone/base-v1.glb) so we don't touch it.
  let modelRef;
  if (id === 'phone') {
    modelRef = '../../assets/models/phone.stripped.glb';
  } else {
    const inGlb = join(COS_SRC, dir, `${name}.glb`);
    const outGlb = join(COS_DST, dir, `${name}.stripped.glb`);
    if (!existsSync(inGlb)) {
      missing.push(`GLB ${id}: ${inGlb}`);
      continue;
    }
    await stripGlb(inGlb, outGlb);
    glbCount++;
    modelRef = `../../assets/cosmetics/${dir}/${name}.stripped.glb`;
  }

  const variants = [];
  for (const v of def.variants) {
    const out = { id: v.id, name: v.name };
    if (v.tex) {
      const { dir: tdir, file: tfile } = slotDirAndName(v.tex);
      const texName = basename(tfile, '.webp');
      const inTex = join(COS_SRC, tdir, `${texName}.webp`);
      const outTex = join(COS_DST, tdir, `${texName}.png`);
      if (!existsSync(inTex)) {
        missing.push(`TEX ${id}/${v.id}: ${inTex}`);
      } else {
        webpToPng(inTex, outTex);
        texCount++;
        out.texRef = `../../assets/cosmetics/${tdir}/${texName}.png`;
      }
    }
    if (v.color) out.color = v.color;
    if (v.roughness !== undefined) out.roughness = v.roughness;
    if (v.metalness !== undefined) out.metalness = v.metalness;
    if (v.emissive) out.emissive = v.emissive;
    variants.push(out);
  }

  entries.push({
    id,
    modelRef,
    attach: def.attach,
    scale: def.scale,
    offset: def.offset,
    rotate: def.rotate,
    variants,
  });
}

// --- 2. shop-renders (product art PNGs) ------------------------------------

const RENDER_SRC = join(WEB_PUBLIC, 'shop-renders');
const RENDER_DST = join(EXPO, 'assets', 'shop-renders');
ensureDir(RENDER_DST);
const renderKeys = [];
for (const f of readdirSync(RENDER_SRC)) {
  if (!f.endsWith('.png')) continue;
  copyFileSync(join(RENDER_SRC, f), join(RENDER_DST, f));
  renderKeys.push(basename(f, '.png'));
}
renderKeys.sort();

// --- 3. lootbox prop -------------------------------------------------------

const PROPS_DST = join(EXPO, 'assets', 'props');
ensureDir(PROPS_DST);
const lootSrc = join(WEB_PUBLIC, 'props', 'lootbox-v1.glb');
if (existsSync(lootSrc)) {
  copyFileSync(lootSrc, join(PROPS_DST, 'lootbox-v1.glb'));
} else {
  missing.push(`PROP lootbox: ${lootSrc}`);
}

// --- 4. codegen cosmetics-manifest.ts --------------------------------------

const fmtVariant = (v) => {
  const bits = [`id: '${v.id}'`, `name: ${JSON.stringify(v.name)}`];
  if (v.texRef) bits.push(`tex: require('${v.texRef}')`);
  if (v.color) bits.push(`color: '${v.color}'`);
  if (v.roughness !== undefined) bits.push(`roughness: ${v.roughness}`);
  if (v.metalness !== undefined) bits.push(`metalness: ${v.metalness}`);
  if (v.emissive) bits.push(`emissive: '${v.emissive}'`);
  return `      { ${bits.join(', ')} },`;
};

const fmtEntry = (e) => {
  const lines = [`  ${e.id}: {`];
  lines.push(`    model: require('${e.modelRef}'),`);
  lines.push(`    attach: '${e.attach}',`);
  if (e.scale !== undefined) lines.push(`    scale: ${e.scale},`);
  if (e.offset) lines.push(`    offset: [${e.offset.join(', ')}],`);
  if (e.rotate) lines.push(`    rotate: [${e.rotate.join(', ')}],`);
  lines.push('    variants: [');
  for (const v of e.variants) lines.push(fmtVariant(v));
  lines.push('    ],');
  lines.push('  },');
  return lines.join('\n');
};

const manifestTs = `// GENERATED by scripts/sync-cosmetics.mjs — do not edit by hand.
//
// Metro requires bundled assets to be static require() calls, so the catalog
// ships as this module rather than a fetched JSON file. Structure mirrors the
// canonical packages/web/public/cosmetics/manifest.json — model/tex are Metro
// module refs instead of URL strings, and variant textures are PNG (converted
// from the canonical .webp; expo-gl can't decode .webp). The phone slot reuses
// the already-bundled stripped mascot phone GLB.

export type Variant = {
  id: string;
  name: string;
  tex?: number; // require() module ref of the albedo PNG
  color?: string;
  roughness?: number;
  metalness?: number;
  emissive?: string;
};
export type SlotDef = {
  model: number; // require() module ref of the (stripped) slot GLB
  attach: string; // "skinned" | "bone:<BoneName>"
  defaultColor?: string;
  scale?: number; // rigid-attach only: multiply the authored local scale
  offset?: [number, number, number]; // rigid-attach only: nudge in bone-local space
  rotate?: [number, number, number]; // rigid-attach only: euler degrees, bone-local, pivots on the bone origin
  variants: Variant[];
};
export type Manifest = Record<string, SlotDef>;

export const MANIFEST: Manifest = {
${entries.map(fmtEntry).join('\n')}
};
`;
writeFileSync(join(SRC_DIR, 'cosmetics-manifest.ts'), manifestTs);

// --- 5. codegen shop-renders.ts --------------------------------------------

const renderLines = renderKeys
  .map((k) => `  '${k}': require('../../assets/shop-renders/${k}.png'),`)
  .join('\n');
const rendersTs = `// GENERATED by scripts/sync-cosmetics.mjs — do not edit by hand.
//
// Metro needs static require() calls, so shop-render product art (copied from
// packages/web/public/shop-renders) is exposed as a renderKey → module-ref map.
// A render key is the PNG basename, e.g. 'boots-brown' or 'boots-ce069a8'
// (variant id or a color-hash suffix, matching the web filenames).

export const SHOP_RENDERS: Record<string, number> = {
${renderLines}
};

// Resolve a render key to its bundled module ref (undefined if absent).
export function shopRender(key: string): number | undefined {
  return SHOP_RENDERS[key];
}
`;
writeFileSync(join(SRC_DIR, 'shop-renders.ts'), rendersTs);

// --- 6. codegen @sidekick/core catalog-variants.ts --------------------------

const CORE_SRC = join(EXPO, '..', 'shared', 'core', 'src');
const catalogEntries = entries
  .filter((e) => e.id !== 'phone') // the phone is a prop, not a cosmetic
  .sort((a, b) => a.id.localeCompare(b.id));

const fmtCatalogSlot = (e) => {
  const lines = [`  ${e.id}: [`];
  for (const v of e.variants) lines.push(`    { id: '${v.id}', name: ${JSON.stringify(v.name)} },`);
  lines.push('  ],');
  return lines.join('\n');
};

const catalogTs = `// GENERATED by packages/expo/scripts/sync-cosmetics.mjs — do not edit by hand,
// but DO keep it checked in: this is the canonical cosmetics catalog data that
// the server and the app both build the shop product list from. Slot ids plus
// variant ids/display names only — no texture refs or asset paths (those live
// in each app's own manifest). Derived from the canonical
// packages/web/public/cosmetics/manifest.json; re-run the sync script whenever
// the art catalog changes. Variant order is load-bearing (prices step by index).

export type CatalogSlotId =
${catalogEntries.map((e) => `  | '${e.id}'`).join('\n')};

export type CatalogVariant = { id: string; name: string };

export const CATALOG_VARIANTS: Record<CatalogSlotId, readonly CatalogVariant[]> = {
${catalogEntries.map(fmtCatalogSlot).join('\n')}
};
`;
writeFileSync(join(CORE_SRC, 'catalog-variants.ts'), catalogTs);

// --- summary ---------------------------------------------------------------

console.log(`Cosmetics sync complete:`);
console.log(`  GLBs stripped:      ${glbCount} (+ phone reused)`);
console.log(`  textures webp→png:  ${texCount}`);
console.log(`  shop-renders copied: ${renderKeys.length}`);
console.log(`  manifest entries:    ${entries.length}`);
console.log(`  core catalog slots:  ${catalogEntries.length}`);
if (missing.length) {
  console.log(`  MISSING (skipped):`);
  for (const m of missing) console.log(`    - ${m}`);
} else {
  console.log(`  missing assets:      none`);
}
