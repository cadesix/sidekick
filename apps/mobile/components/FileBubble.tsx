import { useEffect } from "react";
import { Pressable, Text, View } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import { FileText } from "lucide-react-native";
import { formatBytes, truncateFilename } from "~/features/chat/attachments";

const USER_CORNERS = { borderRadius: 24, borderBottomRightRadius: 6 } as const;

/** "PDF" / "DOCX" / "CSV" from mime or extension for the size caption (09). */
function typeLabel(mime: string, filename: string): string {
  const ext = filename.includes(".") ? filename.split(".").pop() ?? "" : "";
  if (mime === "application/pdf" || ext === "pdf") {
    return "PDF";
  }
  if (ext.length > 0) {
    return ext.toUpperCase();
  }
  return "FILE";
}

function ReadingLabel() {
  const opacity = useSharedValue(0.4);
  useEffect(() => {
    opacity.value = withRepeat(withTiming(1, { duration: 700, easing: Easing.linear }), -1, true);
  }, [opacity]);
  const style = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return (
    <Animated.Text style={style} className="text-[12px] font-medium text-ink/60">
      reading it…
    </Animated.Text>
  );
}

/**
 * File message bubble (09 §file bubble): a card row with a file-type glyph, the
 * filename, and a `PDF · 2.3 MB` caption. `processing` swaps the caption for an
 * animated "reading it…"; `failed` shows a flame-colored retry line.
 */
export function FileBubble({
  filename,
  bytes,
  mime,
  status,
  onRetry,
}: {
  filename: string;
  bytes: number;
  mime: string;
  status: string;
  onRetry?: () => void;
}) {
  return (
    <View className="self-end max-w-[80%]">
      <View className="bg-usergray px-3.5 py-3 flex-row items-center gap-3" style={USER_CORNERS}>
        <View className="w-10 h-10 rounded-xl bg-white items-center justify-center border-2 border-ink">
          <FileText size={20} color="#111111" strokeWidth={2} />
        </View>
        <View className="flex-1">
          <Text className="text-[15px] font-bold text-ink" numberOfLines={1}>
            {truncateFilename(filename, 28)}
          </Text>
          {status === "processing" ? (
            <ReadingLabel />
          ) : status === "failed" ? (
            <Pressable onPress={onRetry} accessibilityRole="button" className="active:opacity-60">
              <Text className="text-[12px] font-medium text-flame">couldn't read this — try again?</Text>
            </Pressable>
          ) : (
            <Text className="text-[12px] font-medium text-ink/60">
              {typeLabel(mime, filename)} · {formatBytes(bytes)}
            </Text>
          )}
        </View>
      </View>
    </View>
  );
}
