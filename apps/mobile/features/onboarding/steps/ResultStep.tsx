import { Image, ScrollView, Text, View } from "react-native";
import { PrimaryButton } from "~/components/PrimaryButton";
import { ARCHETYPES, CHEER } from "../assets";
import { archetypeSlug, computePersonality, type Personality } from "../personality";

/**
 * Reveals the computed archetype (result-step port). `onContinue` receives the
 * full personality so the funnel can persist it and later seed the profile.
 */
export function ResultStep({
  answers,
  onContinue,
}: {
  answers?: Record<string, string>;
  onContinue: (personality: Personality) => void;
}) {
  const p = computePersonality(answers);
  const image = ARCHETYPES[archetypeSlug(p.name)] ?? CHEER;
  const bars = [
    { label: "Curiosity", pct: p.percents.O },
    { label: "Drive", pct: p.percents.C },
    { label: "Energy", pct: p.percents.E },
    { label: "Warmth", pct: p.percents.A },
    { label: "Calm", pct: 100 - p.percents.N },
  ];
  const paragraphs = p.blurb.split(/(?<=[.!?])\s+/).filter(Boolean);

  return (
    <View className="flex-1 pb-2">
      <ScrollView className="flex-1 px-7 pt-1" showsVerticalScrollIndicator={false}>
        <View className="items-center">
          <Image source={image} className="w-44 h-44" resizeMode="contain" />
        </View>
        <Text className="text-[13px] font-extrabold uppercase tracking-[0.12em] text-[#3B62E5]">You are</Text>
        <Text className="mt-1 text-[40px] font-extrabold italic leading-[0.95] tracking-[-0.02em] text-ink">
          {p.name}
        </Text>
        <Text className="mt-2 text-[19px] font-bold text-[#3B62E5]">{p.tagline}</Text>
        <View className="mt-5 gap-3">
          {paragraphs.map((para, i) => (
            <Text key={i} className="text-[17px] font-bold leading-snug text-ink">
              {para}
            </Text>
          ))}
        </View>
        <View className="mt-6 rounded-3xl bg-[#F4FBFF] px-5 py-5 gap-3.5">
          {bars.map((b) => (
            <View key={b.label} className="flex-row items-center gap-4">
              <Text className="w-[72px] text-[15px] font-bold text-ink">{b.label}</Text>
              <View className="flex-1 h-2.5 rounded-full bg-[#EAECEF] overflow-hidden">
                <View className="h-full rounded-full bg-[#3B62E5]" style={{ width: `${b.pct}%` }} />
              </View>
              <Text className="w-11 text-right text-[15px] font-bold text-ink">{b.pct}%</Text>
            </View>
          ))}
        </View>
      </ScrollView>
      <View className="px-6 pt-3">
        <PrimaryButton label="Continue" onPress={() => onContinue(p)} />
      </View>
    </View>
  );
}
