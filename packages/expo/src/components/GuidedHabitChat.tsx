import { useCallback, useEffect, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ChatInputBar } from '../imessage/components/ChatInputBar';
import { MessageBubble } from '../imessage/components/MessageBubble';
import { TypingIndicator } from '../imessage/components/TypingIndicator';
import { colors } from '../imessage/theme';
import { streamChatTurn, trpc } from '../lib/api';

// Reusable guided-habit chat: a short, server-driven conversation that uncovers a
// pain point, gets ONE habit, and (generatively) turns it into a daily/weekly
// cadence, then seeds it as a goal. Driven by the onboarding chat pipeline
// (`kind:'onboarding'` conversations stream through the same turn.ts + onboarding
// tools). Reused by the onboarding chat phase and, later, the goal-screen "+".
//
// The conversation is created by the caller (startOnboardingChat) and passed in
// as `conversationId`. `onComplete` fires when the server signals a terminal beat
// (the habit is set) — the caller then finishes onboarding / closes the sheet.

type Msg = { id: string; role: 'me' | 'them'; text: string };

// Beats the server emits (stream meta) that mean "the flow is done".
const TERMINAL_BEATS = new Set(['done', 'complete', 'completed', 'wrap_up', 'wrapup', 'finish']);

export function GuidedHabitChat({
  conversationId,
  onComplete,
}: {
  conversationId: string;
  onComplete: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [messages, setMessages] = useState<Msg[]>([]);
  const [chips, setChips] = useState<string[]>([]);
  const [sending, setSending] = useState(false);
  // Once the flow reaches a terminal beat (habit set, reminder set), surface a
  // finish button rather than auto-completing — the wrap-up (notifications, final
  // line) is still a couple of turns, so the user taps in when they're ready.
  const [canFinish, setCanFinish] = useState(false);
  const scrollRef = useRef<ScrollView>(null);

  const scrollToEnd = useCallback(() => {
    requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
  }, []);

  // Play the server's opener(s) in like a live conversation — typing dots, then
  // the message, one at a time — rather than dumping them all instantly on mount.
  useEffect(() => {
    let alive = true;
    const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
    trpc.chat.history
      .query({ conversationId, limit: 50 })
      .then(async (rows) => {
        if (!alive) return;
        const history = rows.filter((r) => r.role === 'user' || r.role === 'assistant').reverse();
        for (const r of history) {
          if (!alive) return;
          const id = `h-${r.id}`;
          if (r.role === 'user') {
            setMessages((m) => [...m, { id, role: 'me', text: r.content }]);
            scrollToEnd();
            continue;
          }
          setMessages((m) => [...m, { id, role: 'them', text: '' }]); // typing dots
          scrollToEnd();
          await sleep(Math.min(1400, 450 + r.content.length * 18));
          if (!alive) return;
          setMessages((m) => m.map((x) => (x.id === id ? { ...x, text: r.content } : x))); // reveal
          scrollToEnd();
          await sleep(340);
        }
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [conversationId, scrollToEnd]);

  const send = useCallback(
    async (raw: string) => {
      const text = raw.trim();
      if (!text || sending) return;
      const botId = `them-${Date.now()}`;
      setMessages((m) => [
        ...m,
        { id: `me-${Date.now()}`, role: 'me', text },
        { id: botId, role: 'them', text: '' },
      ]);
      setChips([]);
      setSending(true);
      scrollToEnd();

      let acc = '';
      try {
        await streamChatTurn(
          { conversationId, text },
          (delta) => {
            acc += delta;
            setMessages((m) => m.map((x) => (x.id === botId ? { ...x, text: acc } : x)));
            scrollToEnd();
          },
          () => {},
          (meta) => {
            setChips(meta.replies ?? []);
            if (meta.beat && TERMINAL_BEATS.has(meta.beat)) setCanFinish(true);
          },
        );
        if (!acc.trim()) {
          setMessages((m) => m.map((x) => (x.id === botId ? { ...x, text: '…' } : x)));
        }
      } catch {
        setMessages((m) =>
          m.map((x) => (x.id === botId ? { ...x, text: '⚠️ something went wrong, try again' } : x)),
        );
      } finally {
        setSending(false);
        scrollToEnd();
      }
    },
    [conversationId, sending, scrollToEnd],
  );

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        ref={scrollRef}
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: 16, paddingBottom: 12, gap: 6 }}
        onContentSizeChange={scrollToEnd}
        keyboardDismissMode="interactive"
      >
        {messages.map((m) => {
          const mine = m.role === 'me';
          const waiting = !mine && m.text === '';
          // typing: the exact animated bubble-with-ellipses from the main chat
          if (waiting) {
            return (
              <View key={m.id} style={{ alignItems: 'flex-start' }}>
                <TypingIndicator />
              </View>
            );
          }
          return (
            <View key={m.id} style={{ alignItems: mine ? 'flex-end' : 'flex-start' }}>
              <View style={{ maxWidth: '82%' }}>
                <MessageBubble from={mine ? 'me' : 'them'} tail>
                  <Text
                    style={{
                      color: mine ? colors.sentText : colors.receivedText,
                      fontSize: 16,
                      lineHeight: 21,
                    }}
                  >
                    {m.text}
                  </Text>
                </MessageBubble>
              </View>
            </View>
          );
        })}
      </ScrollView>

      {/* generative reply chips (cadence options, quick answers) */}
      {chips.length > 0 && !sending ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={{ flexGrow: 0 }}
          contentContainerStyle={{ paddingHorizontal: 12, gap: 8, paddingBottom: 8, alignItems: 'center' }}
        >
          {chips.map((chip) => (
            <Pressable
              key={chip}
              onPress={() => send(chip)}
              className="border border-[#007AFF] rounded-full px-3.5 py-2"
            >
              <Text className="text-[14px] text-[#007AFF]">{chip}</Text>
            </Pressable>
          ))}
        </ScrollView>
      ) : null}

      {/* once wrapped up, let the user tap into the app when ready */}
      {canFinish ? (
        <View style={{ paddingHorizontal: 16, paddingBottom: 8 }}>
          <Pressable
            onPress={onComplete}
            style={{
              backgroundColor: '#4F46F0',
              borderRadius: 999,
              paddingVertical: 14,
              alignItems: 'center',
            }}
          >
            <Text style={{ color: '#fff', fontSize: 16, fontWeight: '700' }}>let's go →</Text>
          </Pressable>
        </View>
      ) : null}

      {/* the same iMessage input bar as the home chat (single-height, grows, enter-to-send) */}
      <View style={{ paddingBottom: insets.bottom }}>
        <ChatInputBar
          replyActive={false}
          attachmentState="none"
          tray={null}
          onSendText={(text) => void send(text)}
          onSendAudio={() => {}}
          onTogglePlusMenu={() => {}}
          plusMenuOpen={false}
          recording={false}
          onRecordingChange={() => {}}
        />
      </View>
    </KeyboardAvoidingView>
  );
}
