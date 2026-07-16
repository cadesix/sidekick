import { buildProducts } from '@sidekick/core';
import type { Product } from '@sidekick/core';

import { MANIFEST } from '../three/cosmetics-manifest';

// The full purchasable catalog. Core owns the products (slots, variants,
// prices, renderKeys — the server builds the identical list); the app only
// decorates them with its bundled Metro texture refs for the tinted fallback
// art. Both inputs are static, so build once at module scope.

const textures: Record<string, number> = {};
for (const [slot, def] of Object.entries(MANIFEST)) {
  for (const v of def.variants) {
    if (v.tex != null) textures[`${slot}-${v.id}`] = v.tex;
  }
}

export const PRODUCTS: readonly Product[] = buildProducts(textures);
