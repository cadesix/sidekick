import { View } from "react-native";

/**
 * A static waveform (09 §voice): fixed-width ink bars whose heights come from
 * `bars` (0..1). Bars before `playedCount` render solid ink, the rest at 25%.
 * Used by both the voice bubble and the live recording bar.
 */
export function Waveform({
  bars,
  playedCount,
  height = 28,
}: {
  bars: number[];
  playedCount?: number;
  height?: number;
}) {
  const played = playedCount ?? bars.length;
  return (
    <View className="flex-row items-center" style={{ gap: 2 }}>
      {bars.map((amplitude, index) => (
        <View
          key={index}
          style={{
            width: 3,
            height: Math.max(3, amplitude * height),
            borderRadius: 2,
            backgroundColor: index < played ? "#111111" : "rgba(17,17,17,0.25)",
          }}
        />
      ))}
    </View>
  );
}
