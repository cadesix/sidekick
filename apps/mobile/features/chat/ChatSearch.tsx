import { useState } from "react";
import { FlatList, Pressable, Text, TextInput, View } from "react-native";
import { ChevronDown, Search } from "lucide-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery } from "@tanstack/react-query";
import { searchMessages } from "~/lib/api";
import type { ChatMessage } from "~/lib/chat-thread";
import { dayLabel } from "~/lib/date";

/** Split a snippet around the first case-insensitive match so the hit can be bolded. */
function highlightParts(content: string, query: string): { before: string; hit: string; after: string } {
  const index = content.toLowerCase().indexOf(query.toLowerCase());
  if (index < 0) {
    return { before: content, hit: "", after: "" };
  }
  return {
    before: content.slice(0, index),
    hit: content.slice(index, index + query.length),
    after: content.slice(index + query.length),
  };
}

function ResultRow({
  message,
  query,
  onPress,
}: {
  message: ChatMessage;
  query: string;
  onPress: () => void;
}) {
  const parts = highlightParts(message.content, query);
  return (
    <Pressable onPress={onPress} className="px-5 py-3 active:opacity-70">
      <Text className="text-[12px] font-medium text-ink/40 mb-1">
        {dayLabel(new Date(message.createdAt), new Date())}
      </Text>
      <Text className="text-[15px] leading-[1.375] text-ink" numberOfLines={2}>
        {parts.before}
        <Text className="font-bold">{parts.hit}</Text>
        {parts.after}
      </Text>
    </Pressable>
  );
}

/**
 * Full-screen message search over the immutable thread (08 Phase 2). Tapping a
 * result jumps the thread to that message via the centered/around mode.
 */
export function ChatSearch({
  conversationId,
  onClose,
  onJump,
}: {
  conversationId: string;
  onClose: () => void;
  onJump: (messageId: number) => void;
}) {
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState("");
  const trimmed = query.trim();

  const results = useQuery({
    queryKey: ["chat", "search", conversationId, trimmed],
    enabled: trimmed.length > 1,
    queryFn: () => searchMessages(conversationId, trimmed),
  });

  const matches = results.data ?? [];

  return (
    <View className="absolute inset-0 z-[60] bg-white" style={{ paddingTop: insets.top }}>
      <View className="flex-row items-center gap-2 px-4 py-2">
        <View className="flex-1 flex-row items-center gap-2 bg-field rounded-full px-4 py-2.5">
          <Search size={16} color="#111" strokeWidth={2.5} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search messages"
            placeholderTextColor="rgba(17,17,17,0.4)"
            autoFocus
            className="flex-1 text-[15px] text-ink"
          />
        </View>
        <Pressable
          onPress={onClose}
          className="w-9 h-9 rounded-full bg-field items-center justify-center active:opacity-80"
          accessibilityLabel="Close search"
        >
          <ChevronDown size={20} color="rgba(17,17,17,0.6)" strokeWidth={2.5} />
        </Pressable>
      </View>
      <FlatList
        data={matches}
        keyExtractor={(m) => `${m.id}`}
        keyboardShouldPersistTaps="handled"
        renderItem={({ item }) => (
          <ResultRow
            message={item}
            query={trimmed}
            onPress={() => {
              onJump(item.id);
              onClose();
            }}
          />
        )}
        ListEmptyComponent={
          <Text className="text-[15px] leading-[1.6] text-ink/40 text-center px-8 pt-10">
            {trimmed.length > 1 ? "no matches yet" : "type to search your whole history"}
          </Text>
        }
      />
    </View>
  );
}
