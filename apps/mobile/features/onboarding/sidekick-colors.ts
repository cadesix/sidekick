import type { ImageSourcePropType } from "react-native";
import { COLOR_HEROES } from "./assets";

/** The sidekick's selectable colors (ported from the web funnel). */
export type SidekickColor = { id: string; label: string; hex: string; asset: ImageSourcePropType };

export const SIDEKICK_COLORS: SidekickColor[] = [
  { id: "yellow", label: "Amber", hex: "#E8A33D", asset: COLOR_HEROES.yellow },
  { id: "red", label: "Red", hex: "#DE3A32", asset: COLOR_HEROES.red },
  { id: "pink", label: "Pink", hex: "#EFB2BE", asset: COLOR_HEROES.pink },
  { id: "purple", label: "Purple", hex: "#D2A8E0", asset: COLOR_HEROES.purple },
  { id: "lightblue", label: "Blue", hex: "#7DB2E2", asset: COLOR_HEROES.lightblue },
  { id: "green", label: "Green", hex: "#89BB5A", asset: COLOR_HEROES.green },
  { id: "white", label: "White", hex: "#F2F2F2", asset: COLOR_HEROES.white },
];

export function colorById(id: string): SidekickColor {
  return SIDEKICK_COLORS.find((c) => c.id === id) ?? SIDEKICK_COLORS[0];
}
