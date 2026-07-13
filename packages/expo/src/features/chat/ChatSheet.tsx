import { type ReactNode, useState } from "react";
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  Text,
  View,
  type ViewToken,
} from "react-native";
import Animated, { SlideInDown, SlideOutDown, ZoomIn } from "react-native-reanimated";
import { ChevronDown, Search } from "lucide-react-native";
import DateTimePicker, { type DateTimePickerEvent } from "@react-native-community/datetimepicker";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { SidekickBubble, TypingBubble, UserBubble } from "~/components/ChatBubbles";
import { SearchingCaption } from "~/components/SearchingCaption";
import { ChatComposer } from "~/components/ChatComposer";
import { ReplyChips } from "~/components/ReplyChips";
import { Skeleton } from "~/components/Skeleton";
import { ThreadMessage } from "~/components/ThreadMessage";
import { recordAdImpression } from "~/lib/api";
import { type RenderRow, useChat } from "./useChat";
import { ChatSearch } from "./ChatSearch";

const CHAT_HEADER = require("../../../assets/chat-header.webp");

function Highlighted({ children }: { children: ReactNode }) {
  return (
    <Animated.View entering={ZoomIn} className="rounded-3xl bg-sun/30 -mx-1 px-1">
      {children}
    </Animated.View>
  );
}

function Separator({ label, onLongPress }: { label: string; onLongPress: () => void }) {
  return (
    <Pressable onLongPress={onLongPress} className="items-center py-1">
      <Text className="text-[12px] font-medium text-ink/40">{label}</Text>
    </Pressable>
  );
}

function ChatLoading() {
  return (
    <View className="flex-1 px-4 pt-6 gap-3 justify-end">
      <Skeleton className="h-10 w-2/3 rounded-3xl" />
      <Skeleton className="h-10 w-1/2 rounded-3xl self-end" />
      <Skeleton className="h-16 w-3/4 rounded-3xl" />
    </View>
  );
}

export function ChatSheet({ onClose }: { onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const chat = useChat();
  const [searchOpen, setSearchOpen] = useState(false);
  const [pickerDate, setPickerDate] = useState<Date | null>(null);

  /**
   * Ad impressions fire from list viewability at ≥50% visible (05 / 07 §8), the
   * RN equivalent of the web IntersectionObserver — never on render. FlatList
   * requires a stable callback identity, so the handler and its once-per-adUnit
   * set live in a lazy state initializer.
   */
  const [adViewability] = useState(() => {
    const fired = new Set<string>();
    return {
      viewabilityConfig: { itemVisiblePercentThreshold: 50 },
      onViewableItemsChanged: ({ viewableItems }: { viewableItems: ViewToken[] }) => {
        for (const token of viewableItems) {
          const row: RenderRow = token.item;
          if (row.kind === "message" && row.ad !== null && !fired.has(row.ad.adUnitId)) {
            fired.add(row.ad.adUnitId);
            void recordAdImpression(row.ad.adUnitId).catch(() => {});
          }
        }
      },
    };
  });

  function onPickDate(event: DateTimePickerEvent, date?: Date) {
    setPickerDate(null);
    if (event.type === "set" && date) {
      chat.jumpToDate(date);
    }
  }

  function renderRow({ item }: { item: RenderRow }) {
    if (item.kind === "separator") {
      return <Separator label={item.label} onLongPress={() => setPickerDate(new Date(item.date))} />;
    }
    if (item.kind === "typing") {
      return (
        <View className="gap-1.5">
          <TypingBubble />
          {item.searching ? <SearchingCaption /> : null}
        </View>
      );
    }
    if (item.kind === "error") {
      return (
        <Pressable onPress={chat.retry} className="flex-row items-end gap-2 max-w-[85%] active:opacity-70">
          <View className="bg-cream px-4 py-2.5" style={{ borderRadius: 24, borderBottomLeftRadius: 6 }}>
            <Text className="text-[15px] leading-[1.375] text-ink">hmm, i glitched — tap to resend ↻</Text>
          </View>
        </Pressable>
      );
    }
    if (item.kind === "live") {
      return item.role === "assistant" ? <SidekickBubble text={item.text} /> : <UserBubble text={item.text} />;
    }
    const bubble = (
      <ThreadMessage
        role={item.role}
        text={item.text}
        attachments={item.attachments}
        toolCalls={item.toolCalls}
        ad={item.ad}
      />
    );
    return item.highlight ? <Highlighted>{bubble}</Highlighted> : bubble;
  }

  return (
    <View className="absolute inset-0 z-40">
      <Pressable onPress={onClose} className="h-[7%]" accessibilityLabel="Close chat" />
      <Animated.View entering={SlideInDown.duration(450)} exiting={SlideOutDown.duration(400)} className="flex-1">
        <View className="items-center">
          <Animated.Image
            entering={ZoomIn.springify().damping(12).stiffness(180)}
            source={CHAT_HEADER}
            style={{ width: 176, aspectRatio: 1.5, marginBottom: -22 }}
            resizeMode="contain"
          />
        </View>

        <View className="absolute right-3 z-20 flex-row gap-2" style={{ top: 10 }}>
          <Pressable
            onPress={() => setSearchOpen(true)}
            className="w-9 h-9 rounded-full bg-white/85 items-center justify-center active:bg-white"
            accessibilityLabel="Search messages"
          >
            <Search size={18} color="rgba(17,17,17,0.6)" strokeWidth={2.5} />
          </Pressable>
          <Pressable
            onPress={onClose}
            className="w-9 h-9 rounded-full bg-white/85 items-center justify-center active:bg-white"
            accessibilityLabel="Close chat"
          >
            <ChevronDown size={20} color="rgba(17,17,17,0.6)" strokeWidth={2.5} />
          </Pressable>
        </View>

        <View className="flex-1 bg-white rounded-t-[32px] overflow-hidden">
          <KeyboardAvoidingView
            className="flex-1"
            behavior={Platform.OS === "ios" ? "padding" : undefined}
            keyboardVerticalOffset={insets.top}
          >
            {chat.centered ? (
              <Pressable
                onPress={chat.clearFocus}
                className="absolute top-3 left-1/2 -ml-20 z-10 w-40 items-center rounded-full bg-ink px-4 py-2 active:opacity-80"
              >
                <Text className="text-white text-[13px] font-bold">Jump to latest ↓</Text>
              </Pressable>
            ) : null}

            {chat.loading ? (
              <ChatLoading />
            ) : (
              <FlatList
                data={chat.rows}
                inverted
                keyExtractor={(row) => row.key}
                renderItem={renderRow}
                onEndReached={chat.loadOlder}
                onEndReachedThreshold={0.5}
                viewabilityConfig={adViewability.viewabilityConfig}
                onViewableItemsChanged={adViewability.onViewableItemsChanged}
                showsVerticalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
                contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 24, gap: 12 }}
              />
            )}

            {chat.replyOptions.length > 0 ? (
              <View className="px-4 pb-2">
                <ReplyChips options={chat.replyOptions} onSelect={(text) => chat.send(text)} />
              </View>
            ) : null}

            <View style={{ paddingBottom: insets.bottom > 0 ? insets.bottom : 12 }}>
              <ChatComposer
                onSend={(text, attachmentIds) => chat.send(text, attachmentIds)}
                sending={chat.isStreaming}
              />
            </View>
          </KeyboardAvoidingView>
        </View>
      </Animated.View>

      {searchOpen && chat.conversationId !== null ? (
        <ChatSearch
          conversationId={chat.conversationId}
          onClose={() => setSearchOpen(false)}
          onJump={(id) => chat.focusMessage(id)}
        />
      ) : null}

      {pickerDate ? (
        <DateTimePicker value={pickerDate} mode="date" display="inline" onChange={onPickDate} />
      ) : null}
    </View>
  );
}
