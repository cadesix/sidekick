import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import { Dimensions, Keyboard, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  PHASE_COUNT,
  SESSIONS,
  buildArtifactPrompt,
  buildCardPrompt,
  buildControllerPrompt,
  flattenFields,
  parseArtifact,
  parseControllerTurn,
  phaseDef,
  readyToAdvance,
  type ControllerTurn,
  type PersonalityArtifact,
} from '@sidekick/core';

import { MSG_SHADOW, STREAM_GAP_MS, StreamedText, TypingDots, streamDurationMs } from './chat-stream';
import { useSidekickContext } from '../store/context';
import { useStarChat } from '../store/star-chat';

const { height: SCREEN_H } = Dimensions.get('window');
const KEY = process.env.EXPO_PUBLIC_OPENAI_API_KEY;

// The Star Chat runner (docs/STAR-CHAT.md): a generative-with-a-floor personality
// reading. The engine (phases, must-have floor, per-turn prompt, reducers) lives
// in @sidekick/core; this drives the loop: warm opener, then a direct first
// question, then each user answer feeds the controller, which reacts + extracts
// + steers (and asks their age itself a beat in, not as a cold gate). Each chapter
// boundary deepens the astral card + pays bond + unlocks the matching island; the
// last chapter renders the earned artifact.
//
// LLM: no server on mobile, so we call OpenAI directly when
// EXPO_PUBLIC_OPENAI_API_KEY is set. With no key the flow still walks (scripted
// nudges advance by the phase cap) and ends on a fallback artifact, so it's
// usable offline.

const OPENING = [
  "hey, i'm gonna get to know you through a little conversation,",
  'then give you a personality read: how you think, connect, and move through life ✦',
];
const PHASE1_OPENER = 'ok cool. so what do you do day to day, work, school, both?';
const SCRIPTED_NUDGE = 'mm, say more?';

// derive the compliance age band once the controller has learned their age (it
// asks casually a beat in, per the field hint — no scripted gate up front).
function deriveAgeBand() {
  const c = useStarChat.getState().convo;
  if (!c || c.ageBand || !c.fields.age?.value) return;
  const n = parseInt(c.fields.age.value.match(/\d{1,3}/)?.[0] ?? '', 10);
  if (n >= 5 && n <= 120) useStarChat.getState().setAge(n < 18 ? '<18' : '18+');
}

const FALLBACK_ARTIFACT: PersonalityArtifact = {
  archetype: 'a sky still forming',
  reading:
    "we've only just started mapping you, but there's already a lot up there worth knowing. the more we talk, the clearer it gets. ✦",
  traits: ['curious', 'open', 'worth knowing'],
  insights: [],
};

type Stage = 'chat' | 'generating' | 'artifact';

async function llm(system: string, user: string, maxTokens: number): Promise<string | null> {
  if (!KEY) return null;
  try {
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        max_tokens: maxTokens,
      }),
    });
    const data = await r.json();
    const reply = data?.choices?.[0]?.message?.content;
    return typeof reply === 'string' && reply.trim() ? reply.trim() : null;
  } catch {
    return null;
  }
}

export function StarChat({ onDone }: { onDone: () => void }) {
  const insets = useSafeAreaInsets();
  const msgs = useStarChat((s) => s.msgs);
  const artifact = useStarChat((s) => s.artifact);
  const convo = useStarChat((s) => s.convo);

  const [stage, setStage] = useState<Stage>('chat');
  const [input, setInput] = useState('');
  const [typing, setTyping] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  // messages already persisted when we mounted render as plain text; only lines
  // appended this session stream in (so a resume doesn't re-type the backlog).
  const streamFrom = useRef(useStarChat.getState().msgs.length);

  const later = (fn: () => void, ms: number) => {
    const t = setTimeout(fn, ms);
    timers.current.push(t);
  };
  useEffect(() => () => timers.current.forEach((t) => clearTimeout(t)), []);

  // keep the newest line in view
  useEffect(() => {
    const id = setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 50);
    return () => clearTimeout(id);
  }, [msgs, typing, stage]);

  // stream one bot line: typing → push → hold until it finishes → callback
  const showBot = (text: string, after?: () => void) => {
    setTyping(true);
    later(() => {
      setTyping(false);
      useStarChat.getState().pushMsg({ role: 'bot', text });
      later(() => after?.(), streamDurationMs(text) + STREAM_GAP_MS);
    }, 550);
  };
  // stream several bot lines one at a time, then callback
  const showSeq = (texts: string[], after?: () => void) => {
    let i = 0;
    const next = () => {
      if (i >= texts.length) return after?.();
      const t = texts[i];
      i += 1;
      showBot(t, next);
    };
    next();
  };

  // fade the surface in with the sky
  const enter = useSharedValue(0);
  useEffect(() => {
    enter.value = withTiming(1, { duration: 700, easing: Easing.out(Easing.cubic) });
  }, [enter]);
  const rootStyle = useAnimatedStyle(() => ({ opacity: enter.value }));

  // slide input up with the keyboard
  const kb = useSharedValue(0);
  useEffect(() => {
    const show = Keyboard.addListener('keyboardWillShow', (e) => {
      kb.value = withTiming(e.endCoordinates.height, { duration: e.duration || 250, easing: Easing.out(Easing.cubic) });
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

  // kick off: fresh → opening + age gate; resume → jump to where they were
  useEffect(() => {
    useStarChat.getState().start();
    const st = useStarChat.getState();
    if (st.done) {
      setStage('artifact');
      return;
    }
    setStage('chat');
    if (st.msgs.length === 0) {
      // open warm, then straight into the first real (direct) question; the
      // sidekick asks age itself a beat in, per the age field's hint.
      showSeq([...OPENING], () => showBot(PHASE1_OPENER));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const recentTranscript = () =>
    useStarChat
      .getState()
      .msgs.slice(-12)
      .map((m) => `${m.role === 'bot' ? 'sidekick' : 'user'}: ${m.text}`)
      .join('\n');

  // chapter boundary: deepen the astral card from everything learned + the card
  // they already have, then record chapter completion in the context store —
  // which pays bond, merges fields, and unlocks the matching island (islands are
  // folded in one-per-chapter, no longer the anchor). Fire-and-forget so the
  // conversation keeps flowing; the refreshed card lands over the head at home.
  const completeChapter = async (phase: number) => {
    const def = SESSIONS[phase - 1];
    const c = useStarChat.getState().convo;
    if (!def || !c) return;
    const prior = useSidekickContext.getState().astral;
    const raw = await llm(buildCardPrompt(c, prior), 'write it now.', 460);
    const art = raw ? parseArtifact(raw) : null;
    const card = art ? { archetype: art.archetype, reading: art.reading, traits: art.traits } : null;
    useSidekickContext.getState().completeSession(def, { fields: flattenFields(c), notes: [] }, card);
  };

  // last chapter: build the full artifact (with the evidence-cited insights) as
  // the payoff, and land the final card + last island via completeSession.
  const finishConversation = async (phase: number) => {
    setStage('generating');
    setTyping(true);
    const c = useStarChat.getState().convo;
    const raw = c ? await llm(buildArtifactPrompt(c), 'write the artifact now.', 520) : null;
    const art = (raw && parseArtifact(raw)) || FALLBACK_ARTIFACT;
    setTyping(false);
    const def = SESSIONS[phase - 1];
    if (def && c) {
      const card = { archetype: art.archetype, reading: art.reading, traits: art.traits };
      useSidekickContext.getState().completeSession(def, { fields: flattenFields(c), notes: [] }, card);
    }
    useStarChat.getState().finish(art);
    setStage('artifact');
  };

  // one controller turn: react + extract + steer, then advance on the floor
  const runController = async () => {
    const c = useStarChat.getState().convo;
    if (!c) return;
    setTyping(true);
    const raw = await llm(buildControllerPrompt(c), recentTranscript(), 340);
    setTyping(false);
    const turn: ControllerTurn =
      (raw && parseControllerTurn(raw)) || { message: SCRIPTED_NUDGE, fieldUpdates: [], phaseComplete: false };
    useStarChat.getState().applyTurn(turn); // folds fields, bumps the phase turn counter
    deriveAgeBand(); // capture the compliance band if this turn learned their age
    const next = useStarChat.getState().convo!;
    const advancing = readyToAdvance(next);
    const ending = advancing && next.phase >= PHASE_COUNT;
    const completedPhase = next.phase; // the chapter whose floor we just filled
    showBot(turn.message, () => {
      if (ending) {
        showSeq(["that's everything i wanted to ask ✦", 'let me pull your reading together…'], () => void finishConversation(completedPhase));
      } else if (advancing) {
        useStarChat.getState().advance();
        void completeChapter(completedPhase);
      }
    });
  };

  const busy = typing || stage === 'generating';
  const submit = () => {
    const text = input.trim();
    if (!text || busy) return;
    setInput('');
    useStarChat.getState().pushMsg({ role: 'user', text });
    if (stage === 'chat') void runController();
  };

  const chapter = convo && stage === 'chat' ? phaseDef(convo.phase)?.label : undefined;
  const sendDisabled = !input.trim() || busy;

  return (
    <Animated.View style={[{ height: SCREEN_H, paddingTop: insets.top }, rootStyle]}>
      {/* header: dive-out + the current chapter as the only progress cue */}
      <View className="px-4 pb-2.5 pt-3 flex-row items-center justify-between" pointerEvents="box-none">
        <Pressable
          onPress={onDone}
          accessibilityLabel="Leave onboarding"
          className="w-9 h-9 rounded-full bg-white/15 items-center justify-center"
        >
          <Ionicons name="chevron-down" size={20} color="rgba(255,255,255,0.8)" />
        </Pressable>
        {chapter ? (
          <Text className="text-[11px] font-bold uppercase tracking-[2px] text-white/50" style={MSG_SHADOW}>
            {chapter}
          </Text>
        ) : (
          <View />
        )}
      </View>

      <Animated.View style={[{ flex: 1, overflow: 'hidden' }, kbPad]}>
        <ScrollView
          ref={scrollRef}
          style={{ flex: 1 }}
          className="px-4"
          contentContainerStyle={{ flexGrow: 1, justifyContent: 'flex-end', paddingBottom: 12, paddingTop: 24, gap: 12 }}
          showsVerticalScrollIndicator={false}
        >
          {msgs.map((m, i) =>
            m.role === 'bot' ? (
              <View key={i} style={{ maxWidth: '90%' }} className="self-start">
                {i >= streamFrom.current ? (
                  <StreamedText
                    text={m.text}
                    className="text-[16px] leading-[23px] text-white"
                    style={MSG_SHADOW}
                    onReveal={() => scrollRef.current?.scrollToEnd({ animated: false })}
                  />
                ) : (
                  <Text className="text-[16px] leading-[23px] text-white" style={MSG_SHADOW}>
                    {m.text}
                  </Text>
                )}
              </View>
            ) : (
              <View key={i} style={{ maxWidth: '84%' }} className="self-end">
                <Text style={MSG_SHADOW} className="text-[16px] leading-[23px] text-white text-right">
                  {m.text}
                </Text>
              </View>
            ),
          )}
          {typing ? (
            <View className="self-start">
              <TypingDots />
            </View>
          ) : null}

          {stage === 'artifact' && artifact ? (
            <View className="mt-2 rounded-3xl border border-[#C9BCFF]/25 bg-[#170f2e]/80 p-5">
              <View className="flex-row items-center gap-1.5">
                <Text className="text-[12px] text-[#C9BCFF]">✦</Text>
                <Text className="text-[11px] font-extrabold uppercase tracking-[2px] text-[#C9BCFF]">your reading</Text>
              </View>
              <Text className="mt-2 text-[21px] font-extrabold leading-[26px] text-white">{artifact.archetype}</Text>
              {artifact.traits.length ? (
                <View className="mt-2.5 flex-row flex-wrap gap-1.5">
                  {artifact.traits.map((t, i) => (
                    <View key={i} className="rounded-full border border-white/10 bg-white/10 px-2.5 py-1">
                      <Text className="text-[12px] font-semibold text-[#E7E0FF]">{t}</Text>
                    </View>
                  ))}
                </View>
              ) : null}
              <Text className="mt-3.5 text-[14.5px] leading-[22px] text-[#E7E0FF]/90">{artifact.reading}</Text>
              {artifact.insights.length ? (
                <View className="mt-4 gap-3">
                  {artifact.insights.map((ins, i) => (
                    <View key={i}>
                      <Text className="text-[14px] font-bold text-white">{ins.claim}</Text>
                      <Text className="mt-0.5 text-[13px] leading-[19px] text-[#E7E0FF]/70">{ins.because}</Text>
                    </View>
                  ))}
                </View>
              ) : null}
            </View>
          ) : null}
        </ScrollView>

        <View className="px-3 pt-2 border-t border-white/10" style={{ paddingBottom: Math.max(insets.bottom, 12) + 8 }}>
          {stage === 'artifact' ? (
            <Pressable onPress={onDone} className="rounded-full bg-[#7A5AF8] py-3.5 items-center">
              <Text className="text-[16px] font-bold text-white">Continue</Text>
            </Pressable>
          ) : (
            <View className="flex-row items-center gap-2">
              <TextInput
                value={input}
                onChangeText={setInput}
                placeholder="message"
                placeholderTextColor="rgba(17,17,17,0.4)"
                className="flex-1 rounded-full bg-white/90 px-5 py-3 text-[15px] text-[#111]"
                onSubmitEditing={submit}
                returnKeyType="send"
              />
              <Pressable
                onPress={submit}
                disabled={sendDisabled}
                className={`w-11 h-11 rounded-full bg-[#7A5AF8] items-center justify-center ${sendDisabled ? 'opacity-40' : ''}`}
              >
                <Ionicons name="arrow-up" size={20} color="#fff" />
              </Pressable>
            </View>
          )}
        </View>
      </Animated.View>
    </Animated.View>
  );
}
