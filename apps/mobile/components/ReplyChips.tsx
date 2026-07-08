import { Pressable, Text, View } from "react-native";

const USER_CORNERS = { borderRadius: 24, borderBottomRightRadius: 6 } as const;

/**
 * Scripted reply options rendered as draft user bubbles, stacked bottom-right
 * (06 §3.4). Tapping one sends it as the user's message; the caller removes the
 * rest.
 */
export function ReplyChips({
  options,
  onSelect,
}: {
  options: string[];
  onSelect: (text: string) => void;
}) {
  return (
    <View className="self-end items-end gap-2">
      <Text className="text-[12px] font-medium text-ink/40">Choose your reply</Text>
      {options.map((text) => (
        <Pressable
          key={text}
          onPress={() => onSelect(text)}
          className="bg-usergray px-4 py-2.5 active:opacity-70"
          style={USER_CORNERS}
        >
          <Text className="text-[15px] leading-[1.375] text-ink">{text}</Text>
        </Pressable>
      ))}
    </View>
  );
}
