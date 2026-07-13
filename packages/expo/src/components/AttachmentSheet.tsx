import { Pressable, Text, View } from "react-native";
import { Camera, FileText, Image as ImageIcon } from "lucide-react-native";
import { pastelFor } from "~/lib/tokens";
import { BottomSheet } from "./BottomSheet";

export type AttachmentSource = "library" | "camera" | "file";

const ROWS: { source: AttachmentSource; label: string; Icon: typeof Camera }[] = [
  { source: "library", label: "Photo library", Icon: ImageIcon },
  { source: "camera", label: "Camera", Icon: Camera },
  { source: "file", label: "File", Icon: FileText },
];

/**
 * The `+` action sheet (09 §composer): three rows — photo library, camera, file —
 * in the 06 §3.9 bottom-sheet recipe.
 */
export function AttachmentSheet({
  visible,
  onClose,
  onSelect,
}: {
  visible: boolean;
  onClose: () => void;
  onSelect: (source: AttachmentSource) => void;
}) {
  return (
    <BottomSheet visible={visible} onClose={onClose}>
      <View className="gap-2.5">
        {ROWS.map(({ source, label, Icon }, index) => (
          <Pressable
            key={source}
            onPress={() => {
              onClose();
              onSelect(source);
            }}
            style={{ backgroundColor: pastelFor(index) }}
            className="w-full flex-row items-center gap-4 rounded-2xl pl-4 pr-5 py-3.5 active:scale-[0.99]"
          >
            <Icon size={24} color="#111111" strokeWidth={2} />
            <Text className="flex-1 text-[17px] font-bold leading-[1.2] text-ink">{label}</Text>
          </Pressable>
        ))}
      </View>
    </BottomSheet>
  );
}
