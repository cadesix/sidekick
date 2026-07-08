/**
 * The cosmetic catalog (04). Like the goal catalog, this ships as data in
 * `@sidekick/shared` — ownership rows reference a stable `key`, not a DB id. The
 * mask-region compositing pipeline (04 asset pipeline) will populate `assetUrl`
 * with generated transparent PNGs behind an env-gated seam; until then items
 * render from their `glyph` placeholder. Slots: head/face/outfit/accessory, plus
 * `environment` (home backdrop) reserved for a later drop.
 */

export const COSMETIC_SLOTS = ["head", "face", "outfit", "accessory", "environment"] as const;
export type CosmeticSlot = (typeof COSMETIC_SLOTS)[number];

/** Wearable slots the mascot composites (environment is a backdrop, handled apart). */
export const WEARABLE_SLOTS: CosmeticSlot[] = ["head", "face", "outfit", "accessory"];

export const RARITIES = ["common", "rare", "epic", "legendary"] as const;
export type Rarity = (typeof RARITIES)[number];

/** How an item enters the world. `starter` items are owned by everyone from day one. */
export const COSMETIC_SOURCES = ["starter", "streak", "spinner", "event"] as const;
export type CosmeticSource = (typeof COSMETIC_SOURCES)[number];

export type CosmeticDefinition = {
  key: string;
  slot: CosmeticSlot;
  name: string;
  rarity: Rarity;
  source: CosmeticSource;
  /** Emoji placeholder shown until the asset pipeline bakes a real transparent PNG. */
  glyph: string;
  /** CDN url of the generated item art; null until the pipeline runs (04). */
  assetUrl: string | null;
  seasonTag: string | null;
};

const item = (
  key: string,
  slot: CosmeticSlot,
  name: string,
  rarity: Rarity,
  source: CosmeticSource,
  glyph: string,
): CosmeticDefinition => ({ key, slot, name, rarity, source, glyph, assetUrl: null, seasonTag: null });

export const COSMETIC_CATALOG: CosmeticDefinition[] = [
  item("cap", "head", "Ball Cap", "common", "starter", "🧢"),
  item("party-hat", "head", "Party Hat", "common", "spinner", "🎉"),
  item("sun-hat", "head", "Sun Hat", "common", "spinner", "👒"),
  item("bow", "head", "Little Bow", "common", "spinner", "🎀"),
  item("beanie", "head", "Cozy Beanie", "rare", "streak", "🧶"),
  item("top-hat", "head", "Top Hat", "rare", "spinner", "🎩"),
  item("grad-cap", "head", "Grad Cap", "rare", "streak", "🎓"),
  item("flower-crown", "head", "Flower Crown", "rare", "spinner", "🌸"),
  item("halo", "head", "Halo", "epic", "streak", "😇"),
  item("wizard-hat", "head", "Wizard Hat", "epic", "spinner", "🧙"),
  item("crown", "head", "Golden Crown", "legendary", "streak", "👑"),

  item("glasses", "face", "Reading Glasses", "common", "starter", "👓"),
  item("blush", "face", "Blush", "common", "spinner", "☺️"),
  item("sunglasses", "face", "Sunglasses", "rare", "spinner", "🕶️"),
  item("cool-shades", "face", "Cool Shades", "rare", "streak", "😎"),
  item("disguise", "face", "Silly Disguise", "epic", "spinner", "🥸"),
  item("theater-mask", "face", "Theater Mask", "epic", "event", "🎭"),
  item("star-eyes", "face", "Star Eyes", "legendary", "streak", "🤩"),

  item("tee", "outfit", "Plain Tee", "common", "starter", "👕"),
  item("hi-vis", "outfit", "Hi-Vis Vest", "common", "spinner", "🦺"),
  item("jersey", "outfit", "Sports Jersey", "common", "spinner", "🎽"),
  item("scarf", "outfit", "Knit Scarf", "common", "streak", "🧣"),
  item("raincoat", "outfit", "Raincoat", "rare", "spinner", "🧥"),
  item("necktie", "outfit", "Necktie", "rare", "spinner", "👔"),
  item("lab-coat", "outfit", "Lab Coat", "rare", "streak", "🥼"),
  item("tux", "outfit", "Tuxedo", "epic", "streak", "🤵"),
  item("kimono", "outfit", "Kimono", "epic", "spinner", "🥻"),
  item("superhero", "outfit", "Hero Cape", "legendary", "streak", "🦸"),

  item("backpack", "accessory", "Backpack", "common", "starter", "🎒"),
  item("balloon", "accessory", "Balloon", "common", "spinner", "🎈"),
  item("books", "accessory", "Stack of Books", "common", "spinner", "📚"),
  item("umbrella", "accessory", "Umbrella", "rare", "spinner", "☂️"),
  item("headphones", "accessory", "Headphones", "rare", "streak", "🎧"),
  item("boba", "accessory", "Boba Tea", "rare", "spinner", "🧋"),
  item("camera", "accessory", "Camera", "rare", "spinner", "📷"),
  item("skateboard", "accessory", "Skateboard", "epic", "spinner", "🛹"),
  item("guitar", "accessory", "Guitar", "epic", "streak", "🎸"),
  item("trophy", "accessory", "Golden Trophy", "legendary", "event", "🏆"),
  item("sparkles", "accessory", "Sparkle Aura", "legendary", "streak", "✨"),

  item("friendship-pin", "accessory", "Friendship Pin", "rare", "event", "📌"),
  item("locket", "accessory", "Heart Locket", "epic", "event", "💟"),
  item("besties-charm", "accessory", "Besties Charm", "epic", "event", "🧿"),
  item("soulmate-ring", "accessory", "Soulmate Ring", "legendary", "event", "💍"),
];

const CATALOG_BY_KEY = new Map(COSMETIC_CATALOG.map((c) => [c.key, c]));

export function getCosmetic(key: string): CosmeticDefinition | undefined {
  return CATALOG_BY_KEY.get(key);
}

/** Every item a user owns from the start — the free default wardrobe. */
export function starterCosmetics(): CosmeticDefinition[] {
  return COSMETIC_CATALOG.filter((c) => c.source === "starter");
}

/** Items obtainable through the reward roll (streak/spinner pools). */
export function grantableCosmetics(): CosmeticDefinition[] {
  return COSMETIC_CATALOG.filter((c) => c.source === "streak" || c.source === "spinner");
}
