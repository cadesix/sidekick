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
import { router } from 'expo-router';
import { ChevronLeft, RotateCcw, Send, SlidersHorizontal } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { PERSONA_PROMPT } from '@sidekick/shared/prompts';

import { TypingDots } from '~/components/chat-stream';
import { MessageBubble } from '~/imessage/components/MessageBubble';
import { colors } from '~/imessage/theme';
import { streamChatLab } from '~/lib/api';
import type { ChatMsg } from '~/lib/openai';

// Chat Lab (dev): a scratchpad for iterating on the sidekick voice / texting
// traits with a LIVE-EDITABLE system prompt — the capability the old web Chat
// Lab gave us before packages/web was deleted.
//
// It runs through the dev-only server endpoint `/dev/chat-lab`, which drives the
// REAL prod model (gpt-5.6-sol) on an ephemeral transcript with our overridden
// system prompt — so the voice matches production exactly, minus persistence and
// tools. This is where decideStyle() + trait directives will plug in server-side.
// Requires the server running at EXPO_PUBLIC_API_URL and a dev session (AuthGate
// establishes one on launch).

const PROMPT_KEY = 'sidekick_chat_lab_prompt';
const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8787';

// Voice-only base for STYLE work: keeps persona-v2's texting voice but strips the
// goal / accountability framing (which makes the model nudge toward a goal every
// turn — noise when we're tuning pure texting style). Goals are pinned separately;
// use the "persona-v2" chip to compare against the real shipping persona.
const VOICE_BASE = `you are the user's sidekick, texting them like a close, caring friend. warm, a little cheeky, real.

write like a real person texting, never like an AI:
- short and casual, usually 1-2 lines. lowercase.
- no em dashes (use a comma or a period), no title case, no markdown, no lists.
- nothing assistant-y or corporate, no "happy to help" energy, no "it's not just X, it's Y".
- an occasional emoji is fine.

just have a real conversation. react first, ask a quick follow-up sometimes, be present. this is a friend texting, not an interview.`;

export default function ChatLabRoute() {
  const insets = useSafeAreaInsets();
  const [system, setSystem] = useState<string>(VOICE_BASE);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [showPrompt, setShowPrompt] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  const loaded = useRef(false);

  // restore the last-edited prompt; fall back to the live persona
  useEffect(() => {
    AsyncStorage.getItem(PROMPT_KEY)
      .then((v) => {
        if (v != null) setSystem(v);
      })
      .finally(() => {
        loaded.current = true;
      });
  }, []);
  // persist edits (once the restore has run, so we never clobber a saved prompt)
  useEffect(() => {
    if (loaded.current) AsyncStorage.setItem(PROMPT_KEY, system).catch(() => {});
  }, [system]);

  const scrollToEnd = useCallback(() => {
    requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
  }, []);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || sending) return;
    const next: ChatMsg[] = [...messages, { role: 'user', content: text }];
    // append the user line + an empty assistant placeholder we stream into
    setMessages([...next, { role: 'assistant', content: '' }]);
    setInput('');
    setSending(true);
    scrollToEnd();

    const setLast = (content: string) =>
      setMessages((m) => {
        const copy = m.slice();
        copy[copy.length - 1] = { role: 'assistant', content };
        return copy;
      });

    let acc = '';
    try {
      await streamChatLab({ system, messages: next }, (delta) => {
        acc += delta;
        setLast(acc);
        scrollToEnd();
      });
      if (!acc.trim()) setLast('⚠️ empty reply from model');
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'request failed';
      setLast(`⚠️ ${msg}\ncan the app reach the server at ${API_URL}? (is it running?)`);
    } finally {
      setSending(false);
      scrollToEnd();
    }
  }, [input, sending, messages, system, scrollToEnd]);

  const resetTranscript = useCallback(() => setMessages([]), []);

  return (
    <View style={{ flex: 1, backgroundColor: '#fff', paddingTop: insets.top }}>
      {/* header */}
      <View className="flex-row items-center px-2 h-12 border-b border-black/5">
        <Pressable
          accessibilityLabel="Back"
          onPress={() => router.back()}
          className="w-10 h-10 items-center justify-center"
        >
          <ChevronLeft size={26} color="#111" />
        </Pressable>
        <Text className="text-[17px] font-semibold text-ink">Chat Lab</Text>
        <Text className="text-[11px] text-ink/30 ml-2">gpt-5.6-sol · prod model</Text>
        <View className="flex-1" />
        <Pressable
          accessibilityLabel="Clear conversation"
          onPress={resetTranscript}
          className="w-10 h-10 items-center justify-center"
        >
          <RotateCcw size={19} color="#111" />
        </Pressable>
        <Pressable
          accessibilityLabel="Edit system prompt"
          onPress={() => setShowPrompt((s) => !s)}
          className="w-10 h-10 items-center justify-center"
        >
          <SlidersHorizontal size={19} color={showPrompt ? '#007AFF' : '#111'} />
        </Pressable>
      </View>

      {/* collapsible system-prompt editor */}
      {showPrompt ? (
        <View className="border-b border-black/5 bg-black/[0.02] px-3 pt-2 pb-3">
          <View className="flex-row items-center mb-1.5">
            <Text className="text-[11px] font-semibold uppercase tracking-wider text-ink/40">
              System prompt
            </Text>
            <View className="flex-1" />
            <Text className="text-[11px] text-ink/30 mr-3">{system.length} chars</Text>
            <Pressable onPress={() => setSystem(VOICE_BASE)} hitSlop={8}>
              <Text className="text-[12px] font-semibold text-[#007AFF]">voice base</Text>
            </Pressable>
            <Pressable onPress={() => setSystem(PERSONA_PROMPT.text)} hitSlop={8} className="ml-3">
              <Text className="text-[12px] font-semibold text-ink/40">persona-v2</Text>
            </Pressable>
          </View>
          <TextInput
            value={system}
            onChangeText={setSystem}
            multiline
            textAlignVertical="top"
            placeholder="system prompt…"
            className="text-[13px] text-ink leading-[18px]"
            style={{ maxHeight: 200, minHeight: 90 }}
          />
        </View>
      ) : null}

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={insets.top + 48}
      >
        {/* transcript */}
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={{ padding: 14, paddingBottom: 20, gap: 6 }}
          onContentSizeChange={scrollToEnd}
        >
          {messages.length === 0 ? (
            <View className="items-center py-16">
              <Text className="text-[14px] text-ink/30 text-center">
                say something to the sidekick.{'\n'}tweak the system prompt with the sliders icon ↗
              </Text>
            </View>
          ) : null}

          {messages.map((m, i) => {
            const mine = m.role === 'user';
            // an empty assistant bubble = the reply is still streaming in
            const waiting = !mine && m.content === '';
            return (
              <View key={i} style={{ alignItems: mine ? 'flex-end' : 'flex-start' }}>
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
                        {m.content}
                      </Text>
                    )}
                  </MessageBubble>
                </View>
              </View>
            );
          })}
        </ScrollView>

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
              // Enter sends; Shift+Enter inserts a newline (web / hardware keyboard)
              const ne = e.nativeEvent as { key?: string; shiftKey?: boolean };
              if (ne.key === 'Enter' && !ne.shiftKey) {
                e.preventDefault?.();
                void send();
              }
            }}
          />
          <Pressable
            onPress={send}
            disabled={!input.trim() || sending}
            className="w-10 h-10 rounded-full items-center justify-center"
            style={{ backgroundColor: !input.trim() || sending ? '#00000015' : '#007AFF' }}
          >
            <Send size={18} color={!input.trim() || sending ? '#00000055' : '#fff'} />
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}
