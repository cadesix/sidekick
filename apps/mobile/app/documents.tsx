import { useState } from "react";
import { Image, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { GestureHandlerRootView, Swipeable } from "react-native-gesture-handler";
import { ChevronLeft } from "lucide-react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BottomSheet } from "~/components/BottomSheet";
import { PrimaryButton } from "~/components/PrimaryButton";
import { Skeleton } from "~/components/Skeleton";
import {
  type DocumentFolder,
  type DocumentListItem,
  type DocumentsHome,
  createFolder,
  deleteDocument,
  fetchDocuments,
  moveDocument,
} from "~/lib/api";
import { editedByline } from "~/lib/documents";

const SIDEKICK = require("../assets/sidekick-think.webp");

function FolderChip({
  label,
  emoji,
  selected,
  onPress,
}: {
  label: string;
  emoji: string | null;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      className={`flex-row items-center gap-1.5 rounded-full px-4 py-2 active:opacity-70 ${
        selected ? "bg-sun" : "bg-field"
      }`}
    >
      {emoji ? <Text className="text-[13px]">{emoji}</Text> : null}
      <Text className="text-[14px] font-bold text-ink">{label}</Text>
    </Pressable>
  );
}

function RowActions({ onMove, onDelete }: { onMove: () => void; onDelete: () => void }) {
  return (
    <View className="flex-row items-center pl-2">
      <Pressable
        onPress={onMove}
        className="w-20 h-full items-center justify-center bg-ink active:opacity-80"
      >
        <Text className="text-[14px] font-bold text-white">Move</Text>
      </Pressable>
      <Pressable
        onPress={onDelete}
        className="w-20 h-full items-center justify-center bg-flame active:opacity-80 rounded-r-2xl"
      >
        <Text className="text-[14px] font-bold text-white">Delete</Text>
      </Pressable>
    </View>
  );
}

function DocumentRow({
  doc,
  onMove,
  onDelete,
}: {
  doc: DocumentListItem;
  onMove: () => void;
  onDelete: () => void;
}) {
  const emoji = doc.folderEmoji ?? "\u{1F4C4}";
  return (
    <Swipeable renderRightActions={() => <RowActions onMove={onMove} onDelete={onDelete} />}>
      <Pressable
        onPress={() => router.push(`/document/${doc.id}`)}
        className="flex-row items-center gap-3 bg-white py-2.5 active:opacity-70"
      >
        <View className="w-11 h-11 rounded-xl bg-field items-center justify-center">
          <Text className="text-[20px]">{emoji}</Text>
        </View>
        <View className="flex-1">
          <Text className="text-[17px] font-bold text-ink" numberOfLines={1}>
            {doc.title}
          </Text>
          <Text className="text-[12px] text-ink/60 mt-0.5" numberOfLines={1}>
            {editedByline(doc.updatedAt, doc.lastEditedBy)}
          </Text>
        </View>
      </Pressable>
    </Swipeable>
  );
}

function EmptyState() {
  return (
    <View className="items-center pt-24 px-8">
      <Image source={SIDEKICK} className="w-24 h-24" resizeMode="contain" />
      <Text className="text-[15px] leading-[1.6] text-ink/55 text-center mt-4">
        when i make you something — plans, lists, drafts — it'll live here
      </Text>
    </View>
  );
}

export default function Documents() {
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null);
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [moving, setMoving] = useState<DocumentListItem | null>(null);

  const home = useQuery<DocumentsHome>({ queryKey: ["documents"], queryFn: fetchDocuments });
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["documents"] });

  const del = useMutation({ mutationFn: deleteDocument, onSuccess: invalidate });
  const move = useMutation({
    mutationFn: (input: { id: string; folderId: string | null }) =>
      moveDocument(input.id, input.folderId),
    onSuccess: () => {
      invalidate();
      setMoving(null);
    },
  });
  const addFolder = useMutation({
    mutationFn: createFolder,
    onSuccess: () => {
      invalidate();
      setNewFolderOpen(false);
      setNewFolderName("");
    },
  });

  const folders = home.data?.folders ?? [];
  const documents = home.data?.documents ?? [];
  const visible = selectedFolder
    ? documents.filter((doc) => doc.folderId === selectedFolder)
    : documents;

  return (
    <GestureHandlerRootView className="flex-1 bg-white" style={{ paddingTop: insets.top }}>
      <View className="flex-row items-center justify-between px-3 py-2">
        <View className="flex-row items-center">
          <Pressable
            onPress={() => router.back()}
            className="w-10 h-10 items-center justify-center active:opacity-60"
            accessibilityLabel="Back"
          >
            <ChevronLeft size={26} color="#111" strokeWidth={2.5} />
          </Pressable>
          <Text className="text-[26px] font-extrabold text-ink ml-1">Documents</Text>
        </View>
        <Pressable
          onPress={() => setNewFolderOpen(true)}
          className="px-3 py-2 active:opacity-60"
          accessibilityLabel="New folder"
        >
          <Text className="text-[13px] font-bold text-ink">+ Folder</Text>
        </Pressable>
      </View>

      <View className="pl-5 py-2">
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 8, paddingRight: 20 }}
        >
          <FolderChip
            label="All"
            emoji={null}
            selected={selectedFolder === null}
            onPress={() => setSelectedFolder(null)}
          />
          {folders.map((folder) => (
            <FolderChip
              key={folder.id}
              label={folder.name}
              emoji={folder.emoji}
              selected={selectedFolder === folder.id}
              onPress={() => setSelectedFolder(folder.id)}
            />
          ))}
        </ScrollView>
      </View>

      {home.isPending ? (
        <View className="px-5 pt-3 gap-2.5">
          <Skeleton className="h-14 rounded-2xl" />
          <Skeleton className="h-14 rounded-2xl" />
          <Skeleton className="h-14 rounded-2xl" />
        </View>
      ) : visible.length === 0 ? (
        <EmptyState />
      ) : (
        <ScrollView
          className="flex-1"
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 40 }}
          showsVerticalScrollIndicator={false}
        >
          {visible.map((doc) => (
            <DocumentRow
              key={doc.id}
              doc={doc}
              onMove={() => setMoving(doc)}
              onDelete={() => del.mutate(doc.id)}
            />
          ))}
        </ScrollView>
      )}

      <BottomSheet visible={newFolderOpen} onClose={() => setNewFolderOpen(false)}>
        <Text className="text-[20px] font-extrabold text-ink mb-3">New folder</Text>
        <TextInput
          value={newFolderName}
          onChangeText={setNewFolderName}
          placeholder="Folder name"
          placeholderTextColor="#9A9AA0"
          className="bg-field rounded-2xl px-4 py-3.5 text-[16px] text-ink mb-3"
          autoFocus
        />
        <PrimaryButton
          label="Create"
          onPress={() => addFolder.mutate(newFolderName.trim())}
          disabled={newFolderName.trim().length === 0}
          loading={addFolder.isPending}
        />
      </BottomSheet>

      <BottomSheet visible={moving !== null} onClose={() => setMoving(null)}>
        <Text className="text-[20px] font-extrabold text-ink mb-3">Move to folder</Text>
        <MoveTargets
          folders={folders}
          onSelect={(folderId) => {
            if (moving) {
              move.mutate({ id: moving.id, folderId });
            }
          }}
        />
      </BottomSheet>
    </GestureHandlerRootView>
  );
}

function MoveTargets({
  folders,
  onSelect,
}: {
  folders: DocumentFolder[];
  onSelect: (folderId: string | null) => void;
}) {
  return (
    <View className="gap-2">
      <Pressable
        onPress={() => onSelect(null)}
        className="flex-row items-center gap-2 rounded-2xl bg-field px-4 py-3.5 active:opacity-70"
      >
        <Text className="text-[16px] font-bold text-ink">Unfiled</Text>
      </Pressable>
      {folders.map((folder) => (
        <Pressable
          key={folder.id}
          onPress={() => onSelect(folder.id)}
          className="flex-row items-center gap-2 rounded-2xl bg-field px-4 py-3.5 active:opacity-70"
        >
          {folder.emoji ? <Text className="text-[15px]">{folder.emoji}</Text> : null}
          <Text className="text-[16px] font-bold text-ink">{folder.name}</Text>
        </Pressable>
      ))}
    </View>
  );
}
