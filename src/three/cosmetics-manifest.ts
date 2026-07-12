// The web app fetches /cosmetics/manifest.json at runtime; Metro requires
// bundled assets to be static require() calls, so the manifest ships as this
// module instead. Structure mirrors public/cosmetics/manifest.json exactly —
// model/tex are Metro module refs instead of URL strings. Variant textures are
// PNG (converted from the web's .webp by scripts/… asset copy; expo-gl decodes
// them natively). The phone slot reuses the already-bundled stripped phone GLB
// (byte-identical to public/cosmetics/phone/base-v1.glb).

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
  variants: Variant[];
};
export type Manifest = Record<string, SlotDef>;

export const MANIFEST: Manifest = {
  shirt: {
    model: require('../../assets/cosmetics/shirt/base-v1.stripped.glb'),
    attach: 'skinned',
    variants: [
      { id: 'sky', name: 'Sky Blue', tex: require('../../assets/cosmetics/shirt/sky.png') },
      { id: 'coral', name: 'Coral', tex: require('../../assets/cosmetics/shirt/coral.png'), roughness: 0.55 },
      { id: 'dots', name: 'Polka', tex: require('../../assets/cosmetics/shirt/dots.png') },
    ],
  },
  pants: {
    model: require('../../assets/cosmetics/pants/base-v1.stripped.glb'),
    attach: 'skinned',
    variants: [
      { id: 'denim', name: 'Denim', tex: require('../../assets/cosmetics/pants/denim.png') },
      { id: 'khaki', name: 'Khaki', tex: require('../../assets/cosmetics/pants/khaki.png'), roughness: 0.85 },
    ],
  },
  hat: {
    model: require('../../assets/cosmetics/hat/base-v1.stripped.glb'),
    attach: 'bone:Head',
    scale: 0.76,
    offset: [0, 0.028, 0],
    variants: [
      { id: 'khaki', name: 'Khaki', tex: require('../../assets/cosmetics/hat/khaki.png') },
      { id: 'forest', name: 'Forest', tex: require('../../assets/cosmetics/hat/forest.png') },
      { id: 'berry', name: 'Berry', tex: require('../../assets/cosmetics/hat/berry.png') },
    ],
  },
  shoes: {
    model: require('../../assets/cosmetics/shoes/base-v1.stripped.glb'),
    attach: 'bone:Calf',
    variants: [
      { id: 'red', name: 'Red', tex: require('../../assets/cosmetics/shoes/red.png') },
      { id: 'white', name: 'White', tex: require('../../assets/cosmetics/shoes/white.png'), roughness: 0.5 },
    ],
  },
  phone: {
    model: require('../../assets/models/phone.stripped.glb'),
    attach: 'bone:R_Hand',
    scale: 1.7,
    offset: [0, 0, 0],
    variants: [{ id: 'default', name: 'Phone' }],
  },
};
