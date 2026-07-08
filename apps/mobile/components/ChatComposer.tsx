import { useState } from "react";
import { Alert, Pressable, Text, TextInput, View } from "react-native";
import { Mic, Plus } from "lucide-react-native";
import { type PendingAttachment } from "~/features/chat/attachments";
import { pickFile, pickImages, takePhoto } from "~/features/chat/pickers";
import { attachmentStatus, retryAttachment, uploadAttachment } from "~/lib/api";
import { AttachmentSheet, type AttachmentSource } from "./AttachmentSheet";
import { PendingAttachments } from "./PendingAttachments";
import { SendButton } from "./SendButton";
import { VoiceRecorder, type RecordedVoice } from "./VoiceRecorder";

const POLL_INTERVAL_MS = 1200;
const POLL_MAX = 40;
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * The chat composer (09 §composer): `+` action sheet, pending-attachment chips,
 * the mic/send toggle, and in-place voice recording. Owns the upload + ingest
 * lifecycle for pending attachments and only lets a message send once every
 * attachment is `ready`. `onSend` receives the text plus the ready attachment ids.
 */
export function ChatComposer({
  onSend,
  sending,
}: {
  onSend: (text: string, attachmentIds: string[]) => void;
  sending: boolean;
}) {
  const [text, setText] = useState("");
  const [pending, setPending] = useState<PendingAttachment[]>([]);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function patch(id: string, fields: Partial<PendingAttachment>): void {
    setPending((prev) => prev.map((p) => (p.id === id ? { ...p, ...fields } : p)));
  }

  async function pollReady(localId: string, attachmentId: string): Promise<void> {
    for (let i = 0; i < POLL_MAX; i++) {
      const [status] = await attachmentStatus([attachmentId]);
      if (status?.status === "ready") {
        patch(localId, { status: "ready" });
        return;
      }
      if (status?.status === "failed") {
        patch(localId, { status: "failed" });
        return;
      }
      await sleep(POLL_INTERVAL_MS);
    }
    patch(localId, { status: "failed" });
  }

  async function upload(attachment: PendingAttachment): Promise<void> {
    try {
      const { attachmentId } = await uploadAttachment({
        kind: attachment.kind,
        mime: attachment.mime,
        bytes: attachment.bytes,
        uri: attachment.localUri,
        filename: attachment.filename,
        width: attachment.width,
        height: attachment.height,
        durationMs: attachment.durationMs,
      });
      patch(attachment.id, { attachmentId, status: "processing", progress: 1 });
      await pollReady(attachment.id, attachmentId);
    } catch {
      patch(attachment.id, { status: "failed" });
    }
  }

  function addAndUpload(attachments: PendingAttachment[]): void {
    if (attachments.length === 0) {
      return;
    }
    setError(null);
    setPending((prev) => [...prev, ...attachments]);
    for (const attachment of attachments) {
      void upload(attachment);
    }
  }

  async function onPickSource(source: AttachmentSource): Promise<void> {
    if (source === "library") {
      addAndUpload(await pickImages());
      return;
    }
    if (source === "camera") {
      addAndUpload(await takePhoto());
      return;
    }
    const result = await pickFile();
    if (result && "error" in result) {
      setError(result.error);
      return;
    }
    if (result) {
      addAndUpload([result.attachment]);
    }
  }

  function onRemove(id: string): void {
    setPending((prev) => prev.filter((p) => p.id !== id));
    setError(null);
  }

  function onRetry(attachment: PendingAttachment): void {
    if (attachment.attachmentId) {
      patch(attachment.id, { status: "processing" });
      void retryAttachment(attachment.attachmentId).then(() =>
        pollReady(attachment.id, attachment.attachmentId ?? ""),
      );
      return;
    }
    patch(attachment.id, { status: "uploading" });
    void upload(attachment);
  }

  function onVoiceComplete(voice: RecordedVoice): void {
    setRecording(false);
    addAndUpload([
      {
        id: `voice-${Date.now()}`,
        kind: "audio",
        localUri: voice.uri,
        mime: "audio/m4a",
        bytes: 0,
        filename: "voice.m4a",
        durationMs: voice.durationMs,
        status: "uploading",
        progress: 0,
      },
    ]);
  }

  const readyIds = pending
    .filter((p) => p.status === "ready" && p.attachmentId)
    .map((p) => p.attachmentId ?? "");
  const anyUnsettled = pending.some((p) => p.status === "uploading" || p.status === "processing");
  const anyFailed = pending.some((p) => p.status === "failed");
  const canSend =
    !sending &&
    !anyUnsettled &&
    !anyFailed &&
    (text.trim().length > 0 || readyIds.length > 0);
  const showMic = text.trim().length === 0 && pending.length === 0;

  function submit(): void {
    if (!canSend) {
      return;
    }
    onSend(text, readyIds);
    setText("");
    setPending([]);
    setError(null);
  }

  if (recording) {
    return <VoiceRecorder onCancel={() => setRecording(false)} onComplete={onVoiceComplete} />;
  }

  return (
    <View>
      <PendingAttachments attachments={pending} onRemove={onRemove} />
      {pending
        .filter((p) => p.status === "failed")
        .map((p) => (
          <Pressable key={`retry-${p.id}`} onPress={() => onRetry(p)} className="px-4 active:opacity-60">
            <Text className="text-[12px] font-medium text-flame">
              couldn't upload {p.filename} — tap to try again
            </Text>
          </Pressable>
        ))}
      {error ? <Text className="px-4 pb-1 text-[12px] font-medium text-flame">{error}</Text> : null}

      <View className="flex-row items-end gap-2 px-4 pt-2 border-t border-ink/10">
        <Pressable
          onPress={() => setSheetOpen(true)}
          className="w-9 h-9 rounded-full border-2 border-ink bg-white items-center justify-center active:opacity-70"
          accessibilityLabel="Add attachment"
        >
          <Plus size={20} color="#111111" strokeWidth={3} />
        </Pressable>

        <TextInput
          value={text}
          onChangeText={setText}
          placeholder="Message…"
          placeholderTextColor="rgba(17,17,17,0.4)"
          multiline
          className="flex-1 bg-field rounded-[22px] px-4 py-2.5 text-[15px] text-ink max-h-28"
        />

        {showMic ? (
          <Pressable
            onPress={() => {
              setError(null);
              setRecording(true);
            }}
            className="w-11 h-11 rounded-full bg-sun items-center justify-center active:opacity-80"
            accessibilityRole="button"
            accessibilityLabel="Record voice message"
          >
            <Mic size={20} color="#fff" strokeWidth={2.5} />
          </Pressable>
        ) : (
          <SendButton onPress={submit} disabled={!canSend} />
        )}
      </View>

      <AttachmentSheet
        visible={sheetOpen}
        onClose={() => setSheetOpen(false)}
        onSelect={(source) => {
          void onPickSource(source).catch(() => Alert.alert("couldn't add that"));
        }}
      />
    </View>
  );
}
