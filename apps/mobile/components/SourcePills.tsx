import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import Svg, { Circle, Ellipse, Line } from "react-native-svg";
import { openBrowserAsync } from "expo-web-browser";
import { type SearchSource, groupSourcePills } from "~/features/chat/tool-chrome";

const INK_40 = "rgba(17,17,17,0.4)";

/** The 12px globe that leads the first pill only (11 §citations UI). */
function Globe() {
  return (
    <Svg width={12} height={12} viewBox="0 0 12 12">
      <Circle cx={6} cy={6} r={5} stroke={INK_40} strokeWidth={1} fill="none" />
      <Ellipse cx={6} cy={6} rx={2.3} ry={5} stroke={INK_40} strokeWidth={1} fill="none" />
      <Line x1={1} y1={6} x2={11} y2={6} stroke={INK_40} strokeWidth={1} />
    </Svg>
  );
}

function Pill({
  source,
  leading,
  onPress,
}: {
  source: SearchSource;
  leading: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      className="flex-row items-center gap-1 border border-ink/15 bg-field rounded-full px-2.5 py-1 active:opacity-60"
    >
      {leading ? <Globe /> : null}
      <Text
        numberOfLines={1}
        ellipsizeMode="middle"
        className="text-[12px] font-medium text-ink/60"
        style={{ maxWidth: 140 }}
      >
        {source.domain}
      </Text>
    </Pressable>
  );
}

/**
 * The source row under a search-using bubble (11 §citations UI): up to 4 domain
 * pills, wrap-enabled with 6px gaps, a globe on the first, middle-truncated to
 * 140. Past 4 the last slot is a `+N more` chip that expands the row in place.
 * Tapping a pill opens the in-app browser (SFSafariViewController on iOS).
 */
export function SourcePills({ sources }: { sources: SearchSource[] }) {
  const [expanded, setExpanded] = useState(false);
  if (sources.length === 0) {
    return null;
  }
  const { pills, moreCount } = groupSourcePills(sources, expanded);
  return (
    <View className="flex-row flex-wrap gap-1.5 self-start max-w-[85%] pl-10">
      {pills.map((source, index) => (
        <Pill
          key={source.url}
          source={source}
          leading={index === 0}
          onPress={() => void openBrowserAsync(source.url)}
        />
      ))}
      {moreCount > 0 ? (
        <Pressable
          onPress={() => setExpanded(true)}
          className="border border-ink/15 bg-field rounded-full px-2.5 py-1 active:opacity-60"
        >
          <Text className="text-[12px] font-medium text-ink/60">+{moreCount} more</Text>
        </Pressable>
      ) : null}
    </View>
  );
}
