import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import {
  Keyboard,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { SidekickAvatar } from './SidekickAvatar';
import { useChat } from '../store/chat';

// RN port of sidekick/src/chat.tsx. Same conversation UI (assistant/user
// bubbles, avatar, animated ellipsis, pill input) rebuilt in RN primitives;
// state and persistence live in the zustand store. Visuals mirror the web
// reference class-for-class via nativewind.
//
// Keyboard: the input bar rides on top of the keyboard via animated bottom
// padding driven by keyboardWillShow/Hide. (KeyboardAvoidingView can't measure
// itself inside the translated absolute-positioned chat drawer, so it left the
// input buried under the keyboard.)

// Sidekick head avatar — the live 3D head (real body color, face, worn hats/
// glasses), mirroring web's <SidekickAvatar>, sized `w-8 h-8`. Each is its own
// GL context (browser caps ~16), so we only mount it LIVE for the newest
// assistant bubble + the typing row (≤2 contexts no matter how long the history
// is); earlier bubbles reserve the same 32px slot to keep alignment. `paused`
// freezes the loop while the drawer is closed.
function Avatar({ live, paused }: { live: boolean; paused: boolean }) {
  if (!live) return <View className="w-8 h-8" />;
  return <SidekickAvatar size={32} paused={paused} />;
}

// Web renders a CSS `.ellipsis-dots` span: a 1.6s steps(1) cycle through
// "", ".", "..", "..." at 40% black, in a fixed-width (w-7 = 28px) slot so the
// bubble doesn't jitter. Reproduced here with a 400ms interval.
const DOT_FRAMES = ['', '.', '..', '...'];

function EllipsisDots() {
  const [i, setI] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setI((n) => (n + 1) % DOT_FRAMES.length), 400);
    return () => clearInterval(id);
  }, []);
  return (
    <Text
      className="text-[15px] leading-[21px]"
      style={{ width: 28, color: 'rgba(17,17,17,0.4)' }}
    >
      {DOT_FRAMES[i]}
    </Text>
  );
}

export function Chat({
  transparentTop = false,
  active = true,
}: {
  transparentTop?: boolean;
  // false when the chat drawer is closed — freezes the live head avatars
  active?: boolean;
}) {
  const { messages, loading, send } = useChat();
  const [input, setInput] = useState('');
  const scrollRef = useRef<ScrollView>(null);

  // only the newest assistant bubble carries a live GL head (see <Avatar>)
  let lastAssistantIdx = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'assistant') {
      lastAssistantIdx = i;
      break;
    }
  }

  useEffect(() => {
    const id = setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 50);
    return () => clearTimeout(id);
  }, [messages, loading]);

  // slide the input bar up with the keyboard (and keep the newest message in view)
  const kb = useSharedValue(0);
  useEffect(() => {
    const show = Keyboard.addListener('keyboardWillShow', (e) => {
      kb.value = withTiming(e.endCoordinates.height, {
        duration: e.duration || 250,
        easing: Easing.out(Easing.cubic),
      });
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 60);
    });
    const hide = Keyboard.addListener('keyboardWillHide', (e) => {
      kb.value = withTiming(0, { duration: e.duration || 250, easing: Easing.out(Easing.cubic) });
    });
    return () => {
      show.remove();
      hide.remove();
    };
  }, [kb]);
  const kbPad = useAnimatedStyle(() => ({ paddingBottom: kb.value }));

  const onSend = () => {
    const text = input.trim();
    if (!text || loading) return;
    setInput('');
    void send(text);
  };

  const canSend = !!input.trim() && !loading;

  return (
    // explicit flex:1 (not just className) so the white panel fills the drawer
    // reliably on RN-web, where nativewind flex-1 in an absolute parent is flaky
    <View style={{ flex: 1 }} className={transparentTop ? '' : 'bg-[#FBEFC9]'}>
      {/* White chat container — explicit white bg (nativewind bg-white on an
          Animated.View with a style array wasn't applying, so the cream drawer
          showed through; web is a WHITE panel with cream bubbles) */}
      <Animated.View
        style={[{ flex: 1, backgroundColor: '#ffffff' }, kbPad]}
        className="rounded-t-[32px] overflow-hidden"
      >
        <ScrollView
          ref={scrollRef}
          style={{ flex: 1 }}
          className="px-4 pt-9"
          contentContainerStyle={{ paddingBottom: 12, gap: 12 }}
          showsVerticalScrollIndicator={false}
        >
          {messages.map((m, i) =>
            m.role === 'assistant' ? (
              // maxWidth on the row + shrink on the bubble so the text WRAPS
              // within the panel instead of overflowing off the right edge
              <View key={i} style={{ maxWidth: '85%' }} className="flex-row items-end gap-2">
                <Avatar live={i === lastAssistantIdx && !loading} paused={!active} />
                <View className="shrink rounded-3xl rounded-bl-md bg-[#FBEFC9] px-4 py-2.5">
                  <Text className="text-[15px] leading-[21px] text-[#111]">{m.content}</Text>
                </View>
              </View>
            ) : (
              <View key={i} style={{ maxWidth: '80%' }} className="self-end">
                <View className="shrink rounded-3xl rounded-br-md bg-[#E9E9EC] px-4 py-2.5">
                  <Text className="text-[15px] leading-[21px] text-[#111]">{m.content}</Text>
                </View>
              </View>
            ),
          )}
          {loading ? (
            <View className="flex-row items-end gap-2">
              <Avatar live paused={!active} />
              {/* Sized exactly like a one-line message bubble so the swap to text doesn't shift the list. */}
              <View className="rounded-3xl rounded-bl-md bg-[#FBEFC9] px-4 py-2.5">
                <EllipsisDots />
              </View>
            </View>
          ) : null}
        </ScrollView>

        <View className="px-3 pt-2 pb-3 border-t border-[#111]/10 flex-row items-center gap-2">
          <TextInput
            value={input}
            onChangeText={setInput}
            placeholder="message"
            placeholderTextColor="rgba(17,17,17,0.4)"
            className="flex-1 rounded-full bg-[#F0F0F2] px-5 py-3 text-[15px] text-[#111]"
            onSubmitEditing={onSend}
            returnKeyType="send"
          />
          <Pressable
            onPress={onSend}
            disabled={!canSend}
            className={`w-11 h-11 rounded-full bg-[#F2C94C] items-center justify-center ${
              canSend ? '' : 'opacity-40'
            }`}
          >
            <Ionicons name="arrow-up" size={20} color="#fff" />
          </Pressable>
        </View>
      </Animated.View>
    </View>
  );
}
