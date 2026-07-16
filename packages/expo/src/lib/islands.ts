import { AREA_BIOME, type EnvironmentId } from '../three/biomes';

// Island identity — the name/emoji/blurb an island is KNOWN by, separated from
// where the map art happens to put it. WorldMap composes the two
// (`{...ISLANDS.frostpeak, left, top}`), so positions stay with the map and
// identity stays here, ready for the next surface that needs to name an island.

export type Island = {
  id: string;
  name: string;
  emoji: string;
  color: string; // marker badge background
  blurb: string;
  biome: EnvironmentId; // the 3D world this island travels to
};

export const ISLANDS: Record<string, Island> = {
  frostpeak: { id: 'frostpeak', name: 'Frostpeak', emoji: '❄️', color: '#cfe6ff', blurb: 'Snow-capped summit', biome: AREA_BIOME.frostpeak },
  pinewood: { id: 'pinewood', name: 'Pinewood', emoji: '🌲', color: '#8fd18f', blurb: 'Evergreen forest', biome: AREA_BIOME.pinewood },
  blossom: { id: 'blossom', name: 'Blossom Vale', emoji: '🌸', color: '#ffc1dd', blurb: 'Cherry-blossom groves', biome: AREA_BIOME.blossom },
  dunes: { id: 'dunes', name: 'Sandy Dunes', emoji: '🏜️', color: '#f2c98a', blurb: 'Golden desert canyon', biome: AREA_BIOME.dunes },
  palmcove: { id: 'palmcove', name: 'Palm Cove', emoji: '🌴', color: '#7fd6b0', blurb: 'Tropical palm shore', biome: AREA_BIOME.palmcove },
  ember: { id: 'ember', name: 'Mount Ember', emoji: '🌋', color: '#ff8a5b', blurb: 'Smouldering volcano', biome: AREA_BIOME.ember },
};
