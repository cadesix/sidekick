import { useState } from "react";
import { Image, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import Animated, { FadeIn } from "react-native-reanimated";
import { iconForSlug, labelForSlug } from "~/lib/goals";
import { OptionCard } from "~/components/OptionCard";
import { PrimaryButton } from "~/components/PrimaryButton";
import { pastelFor } from "~/lib/tokens";
import { FACES, SCENES } from "../assets";
import type { ChoiceOption, GoalsConfig, InterestsConfig, PersonalityItem } from "../types";

export function NameStep({
  title,
  placeholder,
  initial,
  onSubmit,
}: {
  title: string;
  placeholder?: string;
  initial?: string;
  onSubmit: (value: string) => void;
}) {
  const [value, setValue] = useState(initial ?? "");
  const canContinue = value.trim().length > 0;
  return (
    <View className="flex-1 px-6 pt-2 pb-2">
      <View className="flex-1">
        <Text className="text-[27px] font-extrabold leading-tight tracking-[-0.02em] text-ink">{title}</Text>
        <TextInput
          value={value}
          onChangeText={setValue}
          onSubmitEditing={() => canContinue && onSubmit(value.trim())}
          placeholder={placeholder ?? "Type here"}
          placeholderTextColor="rgba(17,17,17,0.35)"
          autoFocus
          returnKeyType="done"
          className="mt-6 w-full px-5 py-4 rounded-2xl bg-field text-[17px] font-medium text-ink"
        />
      </View>
      <PrimaryButton label="Continue" onPress={() => onSubmit(value.trim())} disabled={!canContinue} />
    </View>
  );
}

export function ChoiceStep({
  title,
  options,
  selected,
  onSelect,
}: {
  title: string;
  options: ChoiceOption[];
  selected?: string;
  onSelect: (value: string) => void;
}) {
  return (
    <View className="flex-1 px-6 pt-2">
      <Text className="text-[27px] font-extrabold leading-tight tracking-[-0.02em] text-ink">{title}</Text>
      <View className="mt-6 gap-2.5">
        {options.map((opt) => {
          const on = selected === opt.value;
          return (
            <Pressable
              key={opt.value}
              onPress={() => onSelect(opt.value)}
              className={`w-full px-5 py-4 rounded-2xl active:scale-[0.99] ${on ? "bg-ink" : "bg-field"}`}
            >
              <Text className={`text-[17px] font-bold ${on ? "text-white" : "text-ink"}`}>{opt.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export function GoalsStep({
  config,
  initial,
  onSubmit,
}: {
  config: GoalsConfig;
  initial?: string[];
  onSubmit: (values: string[]) => void;
}) {
  const [selected, setSelected] = useState<string[]>(initial ?? []);
  const toggle = (value: string) =>
    setSelected((prev) => (prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]));
  const canContinue = selected.length >= config.minSelections;
  return (
    <View className="flex-1 px-6 pt-1 pb-2">
      <Text className="text-[27px] font-extrabold leading-tight tracking-[-0.02em] text-ink">{config.title}</Text>
      {config.subtitle ? (
        <Text className="mt-1.5 mb-4 text-[15px] leading-[1.6] text-ink/55">{config.subtitle}</Text>
      ) : (
        <View className="mb-4" />
      )}
      <ScrollView className="flex-1" showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 10, paddingBottom: 8 }}>
        {config.options.map((slug, index) => (
          <OptionCard
            key={slug}
            label={labelForSlug(slug, slug)}
            icon={iconForSlug(slug)}
            index={index}
            selected={selected.includes(slug)}
            onPress={() => toggle(slug)}
          />
        ))}
      </ScrollView>
      <View className="pt-3">
        <PrimaryButton label="Continue" onPress={() => onSubmit(selected)} disabled={!canContinue} />
      </View>
    </View>
  );
}

export function InterestsStep({
  config,
  initial,
  onSubmit,
}: {
  config: InterestsConfig;
  initial?: string[];
  onSubmit: (values: string[]) => void;
}) {
  const [selected, setSelected] = useState<string[]>(initial ?? []);
  const toggle = (value: string) =>
    setSelected((prev) => (prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]));
  const canContinue = selected.length >= config.minSelections;
  return (
    <View className="flex-1 px-6 pt-1 pb-2">
      <Text className="text-[27px] font-extrabold leading-tight tracking-[-0.02em] text-ink">{config.title}</Text>
      {config.subtitle ? (
        <Text className="mt-1.5 mb-4 text-[15px] leading-[1.6] text-ink/55">{config.subtitle}</Text>
      ) : (
        <View className="mb-4" />
      )}
      <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
        <View className="flex-row flex-wrap gap-2.5">
          {config.options.map((opt, index) => {
            const on = selected.includes(opt.value);
            return (
              <Pressable
                key={opt.value}
                onPress={() => toggle(opt.value)}
                style={{ backgroundColor: on ? undefined : pastelFor(index) }}
                className={`rounded-full px-4 py-2.5 active:scale-[0.97] ${on ? "bg-ink" : ""}`}
              >
                <Text className={`text-[15px] font-bold ${on ? "text-white" : "text-ink"}`}>
                  {opt.emoji} {opt.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </ScrollView>
      <View className="pt-3">
        <PrimaryButton label="Continue" onPress={() => onSubmit(selected)} disabled={!canContinue} />
      </View>
    </View>
  );
}

const SCALE: { value: string; label: string; bg: string; bgOn: string }[] = [
  { value: "1", label: "Strongly Disagree", bg: "#F8E7E6", bgOn: "#F2A8A6" },
  { value: "2", label: "Disagree", bg: "#F9EBE1", bgOn: "#F2AB7E" },
  { value: "3", label: "Neutral", bg: "#FAF3DA", bgOn: "#EBD280" },
  { value: "4", label: "Agree", bg: "#EFF5DB", bgOn: "#C1CD91" },
  { value: "5", label: "Strongly Agree", bg: "#E4F2DB", bgOn: "#B1D995" },
];

export function PersonalityStep({
  item,
  selected,
  onAnswer,
}: {
  item: PersonalityItem;
  selected?: string;
  onAnswer: (value: string) => void;
}) {
  const scene = SCENES[item.id];
  return (
    <Animated.View entering={FadeIn.duration(250)} className="flex-1 px-6 pt-1 pb-4">
      {scene ? (
        <View className="flex-1 items-center justify-center">
          <Image source={scene} className="h-full w-full" resizeMode="contain" />
        </View>
      ) : (
        <View className="flex-1" />
      )}
      <Text className="text-center text-[22px] font-extrabold leading-tight tracking-[-0.01em] text-ink mt-1">
        {item.text}
      </Text>
      <View className="mt-4 gap-2.5">
        {SCALE.map((opt) => {
          const on = selected === opt.value;
          return (
            <Pressable
              key={opt.value}
              onPress={() => onAnswer(opt.value)}
              style={{ backgroundColor: on ? opt.bgOn : opt.bg }}
              className="w-full flex-row items-center gap-3.5 rounded-2xl pl-3.5 pr-6 py-2.5 active:scale-[0.99]"
            >
              <Image source={FACES[opt.value]} className="w-10 h-10" resizeMode="contain" />
              <Text className="text-[17px] font-bold text-ink">{opt.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </Animated.View>
  );
}
