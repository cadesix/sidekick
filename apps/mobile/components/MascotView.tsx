import { Image, Text, View } from "react-native";
import { colorById } from "~/features/onboarding/sidekick-colors";

/** One equipped cosmetic, reduced to what the mascot needs to render it. */
export type EquippedGlyph = { slot: string; glyph: string };

/** Where each slot's glyph sits over the mascot, as fractions of the render box. */
const SLOT_PLACEMENT: Record<string, { top: number; left?: number; scale: number }> = {
  head: { top: 0.04, scale: 0.24 },
  face: { top: 0.24, scale: 0.15 },
  outfit: { top: 0.46, scale: 0.18 },
  accessory: { top: 0.42, left: 0.66, scale: 0.18 },
};

/**
 * The sidekick wearing its equipped cosmetics (04 / 07 §10 locker preview). The
 * mask-region composite pipeline (04) will replace these glyph placeholders with
 * generated transparent PNGs; until then the emoji stand in over the color hero.
 */
export function MascotView({
  colorId,
  equipped,
  size,
}: {
  colorId: string | null;
  equipped: EquippedGlyph[];
  size: number;
}) {
  const color = colorById(colorId ?? "yellow");
  return (
    <View style={{ width: size, height: size }}>
      <Image source={color.asset} resizeMode="contain" style={{ width: size, height: size }} />
      {equipped.map((item) => {
        const place = SLOT_PLACEMENT[item.slot];
        if (!place) {
          return null;
        }
        const glyphSize = place.scale * size;
        const centered = place.left === undefined;
        return (
          <View
            key={item.slot}
            pointerEvents="none"
            style={{
              position: "absolute",
              top: place.top * size,
              left: centered ? 0 : place.left! * size,
              right: centered ? 0 : undefined,
              alignItems: "center",
            }}
          >
            <Text style={{ fontSize: glyphSize, lineHeight: glyphSize * 1.1 }}>{item.glyph}</Text>
          </View>
        );
      })}
    </View>
  );
}
