import { useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { ChevronLeft } from "lucide-react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BottomSheet } from "~/components/BottomSheet";
import { MarkdownDocument } from "~/components/MarkdownDocument";
import { PrimaryButton } from "~/components/PrimaryButton";
import { Skeleton } from "~/components/Skeleton";
import { SolidShadow } from "~/components/SolidShadow";
import {
  type DocumentDetail,
  type DocumentVersion,
  fetchDocument,
  fetchDocumentVersions,
  restoreDocumentVersion,
  saveDocument,
} from "~/lib/api";
import { relativeTime, toggleTaskInMarkdown } from "~/lib/documents";

function versionLabel(version: DocumentVersion): string {
  const when = new Date(version.createdAt).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  const author = version.editedBy === "user" ? "you" : "sidekick";
  return `${when} · ${author}`;
}

function CancelPill({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <SolidShadow radius={999} onPress={onPress}>
      <View className="px-6 py-4 items-center justify-center rounded-full bg-white">
        <Text className="text-[16px] font-semibold text-ink">{label}</Text>
      </View>
    </SolidShadow>
  );
}

export default function DocumentScreen() {
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const params = useLocalSearchParams<{ id: string }>();
  const id = params.id;

  const [editing, setEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftContent, setDraftContent] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [preview, setPreview] = useState<DocumentVersion | null>(null);

  const doc = useQuery<DocumentDetail>({
    queryKey: ["document", id],
    queryFn: () => fetchDocument(id),
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["document", id] });
    queryClient.invalidateQueries({ queryKey: ["documents"] });
  };

  const save = useMutation({
    mutationFn: saveDocument,
    onSuccess: () => {
      invalidate();
      setEditing(false);
    },
  });

  const restore = useMutation({
    mutationFn: restoreDocumentVersion,
    onSuccess: () => {
      invalidate();
      setHistoryOpen(false);
      setPreview(null);
    },
  });

  const versions = useQuery<DocumentVersion[]>({
    queryKey: ["document-versions", id],
    queryFn: () => fetchDocumentVersions(id),
    enabled: historyOpen,
  });

  const startEditing = (data: DocumentDetail) => {
    setDraftTitle(data.title);
    setDraftContent(data.content);
    setEditing(true);
  };

  const toggleTask = (data: DocumentDetail, nextContent: string) => {
    save.mutate({ id, content: nextContent, title: data.title });
  };

  return (
    <View className="flex-1 bg-white" style={{ paddingTop: insets.top }}>
      <View className="flex-row items-center justify-between px-3 py-2">
        <Pressable
          onPress={() => router.back()}
          className="w-10 h-10 items-center justify-center active:opacity-60"
          accessibilityLabel="Back"
        >
          <ChevronLeft size={26} color="#111" strokeWidth={2.5} />
        </Pressable>
        {doc.data && !editing ? (
          <Pressable onPress={() => setHistoryOpen(true)} className="px-3 py-2 active:opacity-60">
            <Text className="text-[13px] font-bold text-ink">History</Text>
          </Pressable>
        ) : null}
      </View>

      {doc.isPending ? (
        <View className="px-5 pt-3 gap-3">
          <Skeleton className="h-8 w-2/3 rounded-xl" />
          <Skeleton className="h-40 rounded-2xl" />
        </View>
      ) : !doc.data ? (
        <View className="px-5 pt-10">
          <Text className="text-[15px] text-ink/55">this document couldn't be found</Text>
        </View>
      ) : editing ? (
        <EditorBody
          insets={insets.bottom}
          title={draftTitle}
          content={draftContent}
          onChangeTitle={setDraftTitle}
          onChangeContent={setDraftContent}
          saving={save.isPending}
          onSave={() => save.mutate({ id, title: draftTitle.trim(), content: draftContent })}
          onCancel={() => setEditing(false)}
        />
      ) : (
        <ViewerBody
          insets={insets.bottom}
          doc={doc.data}
          onEdit={() => startEditing(doc.data)}
          onToggleTask={(next) => toggleTask(doc.data, next)}
        />
      )}

      <BottomSheet
        visible={historyOpen}
        onClose={() => {
          setHistoryOpen(false);
          setPreview(null);
        }}
      >
        {preview ? (
          <View>
            <Text className="text-[13px] font-bold text-ink/60 mb-2">{versionLabel(preview)}</Text>
            <ScrollView style={{ maxHeight: 360 }} showsVerticalScrollIndicator={false}>
              <MarkdownDocument content={preview.content} />
            </ScrollView>
            <View className="mt-3">
              <PrimaryButton
                label="Restore this version"
                onPress={() => restore.mutate(preview.id)}
                loading={restore.isPending}
              />
            </View>
            <Pressable onPress={() => setPreview(null)} className="items-center py-3 active:opacity-60">
              <Text className="text-[13px] font-bold text-ink/55">Back to history</Text>
            </Pressable>
          </View>
        ) : (
          <View>
            <Text className="text-[20px] font-extrabold text-ink mb-3">History</Text>
            {versions.isPending ? (
              <Skeleton className="h-24 rounded-2xl" />
            ) : (
              <View className="gap-2">
                {(versions.data ?? []).map((version) => (
                  <Pressable
                    key={version.id}
                    onPress={() => setPreview(version)}
                    className="rounded-2xl bg-field px-4 py-3.5 active:opacity-70"
                  >
                    <Text className="text-[15px] font-bold text-ink">{versionLabel(version)}</Text>
                  </Pressable>
                ))}
              </View>
            )}
          </View>
        )}
      </BottomSheet>
    </View>
  );
}

function ViewerBody({
  insets,
  doc,
  onEdit,
  onToggleTask,
}: {
  insets: number;
  doc: DocumentDetail;
  onEdit: () => void;
  onToggleTask: (nextContent: string) => void;
}) {
  return (
    <View className="flex-1">
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 120 }}
        showsVerticalScrollIndicator={false}
      >
        <Text className="text-[28px] font-extrabold text-ink tracking-[-0.02em] mb-1">
          {doc.title}
        </Text>
        <Text className="text-[12px] text-ink/50 mb-4">
          updated {relativeTime(doc.updatedAt)}
        </Text>
        <MarkdownDocument
          content={doc.content}
          onToggleTask={(label) => onToggleTask(toggleTaskInMarkdown(doc.content, label))}
        />
      </ScrollView>
      <View
        className="absolute inset-x-0 bottom-0 bg-white px-5 pt-3 border-t border-ink/10"
        style={{ paddingBottom: insets + 12 }}
      >
        <PrimaryButton label="Edit" onPress={onEdit} />
      </View>
    </View>
  );
}

function EditorBody({
  insets,
  title,
  content,
  onChangeTitle,
  onChangeContent,
  saving,
  onSave,
  onCancel,
}: {
  insets: number;
  title: string;
  content: string;
  onChangeTitle: (value: string) => void;
  onChangeContent: (value: string) => void;
  saving: boolean;
  onSave: () => void;
  onCancel: () => void;
}) {
  return (
    <View className="flex-1 px-5">
      <TextInput
        value={title}
        onChangeText={onChangeTitle}
        placeholder="Title"
        placeholderTextColor="#9A9AA0"
        className="text-[24px] font-extrabold text-ink mb-3"
      />
      <TextInput
        value={content}
        onChangeText={onChangeContent}
        placeholder="Write in markdown…"
        placeholderTextColor="#9A9AA0"
        multiline
        textAlignVertical="top"
        className="flex-1 bg-field rounded-2xl p-4 text-[15px] leading-[1.6] text-ink"
      />
      <View
        className="flex-row items-center justify-end gap-3 py-3"
        style={{ paddingBottom: insets + 12 }}
      >
        <CancelPill label="Cancel" onPress={onCancel} />
        <View className="flex-1 max-w-[180px]">
          <PrimaryButton label="Save" onPress={onSave} loading={saving} />
        </View>
      </View>
    </View>
  );
}
