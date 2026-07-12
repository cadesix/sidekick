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
  withDelay,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { useChat } from '../store/chat';

// RN port of sidekick/src/chat.tsx. Same conversation UI (assistant/user
// bubbles, avatar, typing dots, pill input) rebuilt in RN primitives; state and
// persistence live in the zustand store.
//
// Keyboard: the input bar rides on top of the keyboard via animated bottom
// padding driven by keyboardWillShow/Hide. (KeyboardAvoidingView can't measure
// itself inside the translated absolute-positioned chat drawer, so it left the
// input buried under the keyboard.)

function Dot({ delay }: { delay: number }) {
  const v = useSharedValue(0.3);
  useEffect(() => {
    v.value = withDelay(delay, withRepeat(withTiming(1, { duration: 500 }), -1, true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const style = useAnimatedStyle(() => ({ opacity: v.value }));
  return <Animated.View style={style} className="w-2 h-2 rounded-full bg-black/30" />;
}

function TypingDots() {
  return (
    <View className="flex-row gap-1 py-1">
      <Dot delay={0} />
      <Dot delay={160} />
      <Dot delay={320} />
    </View>
  );
}

export function Chat({ transparentTop = false }: { transparentTop?: boolean }) {
  const { messages, loading, send } = useChat();
  const [input, setInput] = useState('');
  const scrollRef = useRef<ScrollView>(null);

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

  return (
    <View className={`flex-1 ${transparentTop ? '' : 'bg-[#FBEFC9]'}`}>
      <Animated.View style={kbPad} className="flex-1 bg-white rounded-t-[32px] overflow-hidden">
        <ScrollView
          ref={scrollRef}
          className="flex-1 px-4 pt-9"
          contentContainerStyle={{ paddingBottom: 12, gap: 12 }}
          showsVerticalScrollIndicator={false}
        >
          {messages.map((m, i) =>
            m.role === 'assistant' ? (
              <View key={i} className="flex-row items-end gap-2 max-w-[85%]">
                <View className="w-8 h-8 rounded-full bg-[#F2C94C] items-center justify-center">
                  <Ionicons name="happy" size={18} color="#fff" />
                </View>
                <View className="rounded-3xl rounded-bl-md bg-[#FBEFC9] px-4 py-2.5">
                  <Text className="text-[15px] leading-5 text-[#111]">{m.content}</Text>
                </View>
              </View>
            ) : (
              <View key={i} className="self-end max-w-[80%]">
                <View className="rounded-3xl rounded-br-md bg-[#E9E9EC] px-4 py-2.5">
                  <Text className="text-[15px] leading-5 text-[#111]">{m.content}</Text>
                </View>
              </View>
            ),
          )}
          {loading ? (
            <View className="flex-row items-end gap-2">
              <View className="w-8 h-8 rounded-full bg-[#F2C94C] items-center justify-center">
                <Ionicons name="happy" size={18} color="#fff" />
              </View>
              <View className="rounded-3xl rounded-bl-md bg-[#FBEFC9] px-4 py-2.5">
                <TypingDots />
              </View>
            </View>
          ) : null}
        </ScrollView>

        <View className="px-3 pt-2 pb-3 border-t border-black/10 flex-row items-center gap-2">
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
            disabled={!input.trim() || loading}
            className={`w-11 h-11 rounded-full bg-[#F2C94C] items-center justify-center ${
              !input.trim() || loading ? 'opacity-40' : ''
            }`}
          >
            <Ionicons name="arrow-up" size={20} color="#fff" />
          </Pressable>
        </View>
      </Animated.View>
    </View>
  );
}
