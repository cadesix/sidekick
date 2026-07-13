import { Image, Pressable, ScrollView, Text, View } from "react-native";
import { FileText, X } from "lucide-react-native";
import { type PendingAttachment, truncateFilename } from "~/features/chat/attachments";

/** A 2px ink progress bar along a chip's bottom edge while uploading (09 §composer). */
function UploadBar({ progress }: { progress: number }) {
  return (
    <View className="absolute left-0 right-0 bottom-0 h-0.5 bg-ink/10 rounded-full overflow-hidden">
      <View className="h-full bg-ink" style={{ width: `${Math.round(progress * 100)}%` }} />
    </View>
  );
}

function RemoveBadge({ onPress }: { onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-ink items-center justify-center"
      accessibilityLabel="Remove attachment"
    >
      <X size={12} color="#fff" strokeWidth={3} />
    </Pressable>
  );
}

/**
 * The pending-attachment row above the input (09 §composer): image thumbnails
 * (56px, rounded-12, ink × badge) and file/voice pills, each dimmed with an ink
 * progress bar while uploading.
 */
export function PendingAttachments({
  attachments,
  onRemove,
}: {
  attachments: PendingAttachment[];
  onRemove: (id: string) => void;
}) {
  if (attachments.length === 0) {
    return null;
  }
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      className="px-4 pb-2"
      contentContainerStyle={{ gap: 8, paddingTop: 6 }}
    >
      {attachments.map((attachment) => {
        const uploading = attachment.status === "uploading";
        const failed = attachment.status === "failed";
        const dim = uploading ? "opacity-50" : "";
        if (attachment.kind === "image") {
          return (
            <View key={attachment.id} className="w-14 h-14">
              <Image
                source={{ uri: attachment.localUri }}
                className={`w-14 h-14 rounded-xl border-2 border-ink ${dim}`}
                resizeMode="cover"
              />
              {uploading ? <UploadBar progress={attachment.progress} /> : null}
              {failed ? <View className="absolute inset-0 rounded-xl bg-flame/30" /> : null}
              <RemoveBadge onPress={() => onRemove(attachment.id)} />
            </View>
          );
        }
        return (
          <View key={attachment.id}>
            <View
              className={`flex-row items-center gap-1.5 border-2 border-ink bg-field rounded-full px-3 py-1.5 ${dim}`}
            >
              <FileText size={14} color={failed ? "#FF9F43" : "#111111"} strokeWidth={2} />
              <Text className="text-[13px] font-medium text-ink max-w-[140px]" numberOfLines={1}>
                {truncateFilename(attachment.filename, 18)}
              </Text>
              {uploading ? <UploadBar progress={attachment.progress} /> : null}
            </View>
            <RemoveBadge onPress={() => onRemove(attachment.id)} />
          </View>
        );
      })}
    </ScrollView>
  );
}
