import { Text, View } from "react-native";
import * as Haptics from "expo-haptics";
import { SolidShadow } from "./SolidShadow";

/**
 * The document card rendered in the chat thread for the message that created or
 * updated a document (15 UI spec). SolidShadow card, doc emoji + title, a caption
 * meta line, a hairline, and the first couple of lines of the content as preview.
 *
 * Exported for the chat surface to render from a tool result — it is intentionally
 * NOT wired into the thread here (chat surfaces are owned by the multimodal wave).
 */
export function DocumentCard({
  title,
  emoji = "\u{1F4C4}",
  meta,
  preview,
  onPress,
}: {
  title: string;
  emoji?: string;
  meta: string;
  preview: string;
  onPress?: () => void;
}) {
  const press = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onPress?.();
  };
  return (
    <View className="max-w-[85%]">
      <SolidShadow radius={16} onPress={onPress ? press : undefined}>
        <View className="bg-white rounded-2xl p-4">
          <View className="flex-row items-center gap-2">
            <Text className="text-[16px]">{emoji}</Text>
            <Text className="flex-1 text-[17px] font-bold text-ink" numberOfLines={1}>
              {title}
            </Text>
          </View>
          <Text className="text-[12px] text-ink/60 mt-1">{meta}</Text>
          <View className="h-px bg-ink/10 my-2.5" />
          <Text className="text-[15px] leading-[1.6] text-ink/70" numberOfLines={2}>
            {preview}
          </Text>
        </View>
      </SolidShadow>
    </View>
  );
}
