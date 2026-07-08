import type { MultiSelectOption } from "./types";

/**
 * Declared interests (02 §4) — the cheapest high-CPM lever and day-1
 * personalization seed. Broad taxonomy, ~10 seconds of user effort. `label` is
 * the plain word (used to seed an `interest` memory); `emoji` is display only.
 */
export const INTEREST_OPTIONS: MultiSelectOption[] = [
  { value: "music", label: "Music", emoji: "🎧" },
  { value: "gaming", label: "Gaming", emoji: "🎮" },
  { value: "fitness", label: "Fitness", emoji: "💪" },
  { value: "fashion-beauty", label: "Fashion & beauty", emoji: "💄" },
  { value: "tech", label: "Tech", emoji: "💻" },
  { value: "sports", label: "Sports", emoji: "⚽" },
  { value: "food", label: "Food", emoji: "🍜" },
  { value: "travel", label: "Travel", emoji: "✈️" },
  { value: "books", label: "Books", emoji: "📚" },
  { value: "anime", label: "Anime", emoji: "🌸" },
  { value: "movies-tv", label: "Movies & TV", emoji: "🎬" },
  { value: "art", label: "Art", emoji: "🎨" },
];

const LABELS = new Map(INTEREST_OPTIONS.map((o) => [o.value, o.label]));

/** Plain lowercase interest words for the memory seed, in the user's pick order. */
export function interestWords(values: string[]): string[] {
  return values.map((v) => (LABELS.get(v) ?? v).toLowerCase());
}
