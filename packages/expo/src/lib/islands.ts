import { AREA_BIOME, type EnvironmentId } from '../three/biomes';

// Island identity — the name/emoji/blurb an island is KNOWN by. The world map's
// markers and the post-session unlock modal both name islands, so that naming
// lives here rather than inside either screen. Map positions stay in WorldMap:
// they're a property of the map art, not of the island.

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

export const islandFor = (id: string): Island | undefined => ISLANDS[id];
