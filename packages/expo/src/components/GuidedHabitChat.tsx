import { useCallback, useEffect, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { TypingDots } from './chat-stream';
import { MessageBubble } from '../imessage/components/MessageBubble';
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
  const [input, setInput] = useState('');
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

  // Load the intro message the server generated when the conversation started.
  useEffect(() => {
    let alive = true;
    trpc.chat.history
      .query({ conversationId, limit: 50 })
      .then((rows) => {
        if (!alive) return;
        const mapped: Msg[] = rows
          .filter((r) => r.role === 'user' || r.role === 'assistant')
          .reverse()
          .map((r) => ({
            id: String(r.id),
            role: r.role === 'user' ? 'me' : 'them',
            text: r.content,
          }));
        setMessages(mapped);
        scrollToEnd();
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
      setInput('');
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
        contentContainerStyle={{ padding: 16, paddingBottom: 12, gap: 6 }}
        onContentSizeChange={scrollToEnd}
        keyboardDismissMode="interactive"
      >
        {messages.map((m) => {
          const mine = m.role === 'me';
          const waiting = !mine && m.text === '';
          return (
            <View key={m.id} style={{ alignItems: mine ? 'flex-end' : 'flex-start' }}>
              <View style={{ maxWidth: '82%' }}>
                <MessageBubble from={mine ? 'me' : 'them'} tail>
                  {waiting ? (
                    <TypingDots />
                  ) : (
                    <Text
                      style={{
                        color: mine ? colors.sentText : colors.receivedText,
                        fontSize: 16,
                        lineHeight: 21,
                      }}
                    >
                      {m.text}
                    </Text>
                  )}
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
          contentContainerStyle={{ paddingHorizontal: 12, gap: 8, paddingBottom: 8 }}
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

      {/* composer */}
      <View
        className="flex-row items-end px-3 pt-2 border-t border-black/5"
        style={{ paddingBottom: Math.max(insets.bottom, 10) }}
      >
        <TextInput
          value={input}
          onChangeText={setInput}
          placeholder="message"
          placeholderTextColor="#00000040"
          multiline
          className="flex-1 text-[16px] text-ink bg-black/[0.05] rounded-2xl px-3.5 py-2.5 mr-2"
          style={{ maxHeight: 120 }}
          onKeyPress={(e) => {
            const ne = e.nativeEvent as { key?: string; shiftKey?: boolean };
            if (Platform.OS === 'web' && ne.key === 'Enter' && !ne.shiftKey) {
              e.preventDefault?.();
              void send(input);
            }
          }}
        />
        <Pressable
          onPress={() => send(input)}
          disabled={!input.trim() || sending}
          className="w-10 h-10 rounded-full items-center justify-center"
          style={{ backgroundColor: !input.trim() || sending ? '#00000015' : '#007AFF' }}
        >
          <Text style={{ color: !input.trim() || sending ? '#00000055' : '#fff', fontSize: 18 }}>
            ↑
          </Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}
