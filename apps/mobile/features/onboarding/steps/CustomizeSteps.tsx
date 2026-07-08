import { useState } from "react";
import { Image, Pressable, Text, TextInput, View } from "react-native";
import Animated, { FadeIn } from "react-native-reanimated";
import { PrimaryButton } from "~/components/PrimaryButton";
import { SIDEKICK_COLORS, colorById } from "../sidekick-colors";

export function ColorStep({
  initial,
  onContinue,
}: {
  initial?: string;
  onContinue: (colorId: string) => void;
}) {
  const [colorId, setColorId] = useState(initial ?? "yellow");
  const color = colorById(colorId);
  return (
    <View className="flex-1 px-6 pt-2 pb-2">
      <View className="flex-1 items-center">
        <Text className="text-[27px] font-extrabold leading-tight tracking-[-0.02em] text-ink text-center">
          Choose your Sidekick's color
        </Text>
        <View className="mt-4 h-56 items-center justify-center">
          <Animated.Image
            key={colorId}
            entering={FadeIn.duration(250)}
            source={color.asset}
            className="h-full w-56"
            resizeMode="contain"
          />
        </View>
        <View className="mt-6 flex-row flex-wrap justify-center gap-3.5 max-w-[300px]">
          {SIDEKICK_COLORS.map((c) => {
            const on = c.id === colorId;
            return (
              <Pressable
                key={c.id}
                onPress={() => setColorId(c.id)}
                accessibilityLabel={c.label}
                style={{ backgroundColor: c.hex, borderColor: on ? "#111" : "rgba(17,17,17,0.15)", borderWidth: on ? 3 : 1 }}
                className="w-12 h-12 rounded-full"
              />
            );
          })}
        </View>
      </View>
      <PrimaryButton label="Continue" onPress={() => onContinue(colorId)} />
    </View>
  );
}

export function NameSidekickStep({
  colorId,
  initial,
  onContinue,
}: {
  colorId?: string;
  initial?: string;
  onContinue: (name: string) => void;
}) {
  const [name, setName] = useState(initial ?? "");
  const color = colorById(colorId ?? "yellow");
  const canContinue = name.trim().length > 0;
  return (
    <View className="flex-1 px-6 pt-2 pb-2">
      <View className="flex-1 items-center">
        <Text className="text-[27px] font-extrabold leading-tight tracking-[-0.02em] text-ink text-center">
          Name your Sidekick
        </Text>
        <View className="mt-4 h-52 items-center justify-center">
          <Image source={color.asset} className="h-full w-52" resizeMode="contain" />
        </View>
        <TextInput
          value={name}
          onChangeText={setName}
          onSubmitEditing={() => canContinue && onContinue(name.trim())}
          placeholder="Name your Sidekick"
          placeholderTextColor="rgba(17,17,17,0.35)"
          maxLength={20}
          autoFocus
          returnKeyType="done"
          className="mt-2 w-full max-w-xs px-5 py-3.5 rounded-2xl bg-field text-center text-[17px] font-bold text-ink"
        />
      </View>
      <PrimaryButton label="Continue" onPress={() => onContinue(name.trim())} disabled={!canContinue} />
    </View>
  );
}
