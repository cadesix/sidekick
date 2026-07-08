import { Text, View } from "react-native";
import { BottomSheet } from "./BottomSheet";
import { PrimaryButton } from "./PrimaryButton";

/**
 * The contextual pre-permission sheet (12-life-integrations.md). Never a wall of
 * OS prompts at onboarding — instead a warm, in-voice ask right when the value
 * lands: the sidekick face, one honest sentence about what's shared, a single
 * primary action, and a low-stakes "maybe later".
 */
export function PrePermissionSheet({
  visible,
  onClose,
  emoji,
  title,
  body,
  confirmLabel,
  onConfirm,
  loading = false,
}: {
  visible: boolean;
  onClose: () => void;
  emoji: string;
  title: string;
  body: string;
  confirmLabel: string;
  onConfirm: () => void;
  loading?: boolean;
}) {
  return (
    <BottomSheet visible={visible} onClose={onClose}>
      <View className="items-center pt-2 pb-1">
        <View className="w-16 h-16 rounded-full bg-ink/5 items-center justify-center mb-4">
          <Text className="text-[30px]">{emoji}</Text>
        </View>
        <Text className="text-[20px] font-extrabold text-ink text-center mb-2">{title}</Text>
        <Text className="text-[15px] leading-[1.6] text-ink/60 text-center mb-6">{body}</Text>
      </View>
      <PrimaryButton label={confirmLabel} onPress={onConfirm} loading={loading} />
      <Text
        onPress={onClose}
        className="text-[13px] font-medium text-ink/40 text-center mt-4 py-2"
      >
        maybe later
      </Text>
    </BottomSheet>
  );
}
