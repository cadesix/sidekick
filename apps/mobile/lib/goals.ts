import type { ImageSourcePropType } from "react-native";

/**
 * The goal catalog (labels + pre-baked transparent icons). Slugs match the
 * onboarding goals step (03 / funnel manifest). Icons are the mac-OS-9 style set
 * shipped in `assets/goal-icons`. A slug not in the catalog (e.g. `custom`)
 * renders with no icon.
 */
type CatalogEntry = { label: string; icon: ImageSourcePropType };

export const GOAL_CATALOG: Record<string, CatalogEntry> = {
  "get-fit": { label: "Get Fit", icon: require("../assets/goal-icons/get-fit.webp") },
  "sleep-better": { label: "Sleep Better", icon: require("../assets/goal-icons/sleep-better.webp") },
  "stop-procrastinating": {
    label: "Stop Procrastinating",
    icon: require("../assets/goal-icons/stop-procrastinating.webp"),
  },
  "stop-doomscrolling": {
    label: "Stop Doomscrolling",
    icon: require("../assets/goal-icons/stop-doomscrolling.webp"),
  },
  "social-skills": {
    label: "Improve Social Skills",
    icon: require("../assets/goal-icons/social-skills.webp"),
  },
  "manage-stress": { label: "Manage Stress", icon: require("../assets/goal-icons/manage-stress.webp") },
  "read-more": { label: "Read More", icon: require("../assets/goal-icons/read-more.webp") },
  "be-productive": {
    label: "Be More Productive",
    icon: require("../assets/goal-icons/be-productive.webp"),
  },
};

export function iconForSlug(slug: string): ImageSourcePropType | null {
  return GOAL_CATALOG[slug]?.icon ?? null;
}

export function labelForSlug(slug: string, fallback: string | null): string {
  return GOAL_CATALOG[slug]?.label ?? fallback ?? slug;
}
