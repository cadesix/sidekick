import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useRef, useState } from 'react';
import {
  Dimensions,
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
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { sessionFor, type SessionDef } from '@sidekick/core';

import { SidekickAvatar } from './SidekickAvatar';
import { useSidekickContext } from '../store/context';

const { height: SCREEN_H } = Dimensions.get('window');

// RN port of the web guided-session runner (packages/web/src/components/
// session-chat.tsx): a session's OWN chat surface. Scripted asks, free-form
// answers, one LLM acknowledgment per beat (with a single optional probe),
// progress persisted per answer so the user can dive out (chevron) and back in.
// Ends with an extraction pass → recap → "did i get that right?" → rewards.
//
// LLM: the web app proxied /api/chat server-side. On mobile there's no server,
// so we call OpenAI directly when EXPO_PUBLIC_OPENAI_API_KEY is set (same pattern
// as lib/chat-api.ts); with no key every LLM step falls back to a scripted line
// so the whole flow is fully usable offline.

type Msg = { role: 'bot' | 'user'; text: string };
type Phase = 'asking' | 'answer' | 'probe' | 'extracting' | 'confirm' | 'done';

const KEY = process.env.EXPO_PUBLIC_OPENAI_API_KEY;
const NAME = 'sidekick';

// the opening bot message — sets the mystical framing: the stars overhead are a
// living map of how aligned you two are, and truly opening up lights them.
const INTRO_EXPLAINER =
  'the stars up there are ours ✦ the more i truly know you, the more of them light up — it\'s how we find our alignment. let\'s draw a little of the sky tonight 🌙';

// one OpenAI turn with a custom inline system prompt → the reply text (or null
// on no-key / error, so callers can fall back to a scripted line)
async function llm(system: string, user: string): Promise<string | null> {
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
        max_tokens: 400,
      }),
    });
    const data = await r.json();
    const reply = data?.choices?.[0]?.message?.content;
    return typeof reply === 'string' && reply.trim() ? reply.trim() : null;
  } catch {
    return null;
  }
}

// one short in-voice reaction to an answer (optionally with ONE follow-up)
async function fetchAck(def: SessionDef, ask: string, answer: string, probe: boolean): Promise<string | null> {
  const system =
    `you are ${NAME}, a warm lowercase internet-native friend running a short get-to-know-you chat. ` +
    `the user just answered your question. reply with ONE short specific reaction to what they said (max 18 words)` +
    (probe ? ', then ask ONE short follow-up question about it' : '. do NOT ask a question') +
    '. ' +
    (def.sensitive ? 'the topic is personal: be gentle, never pry, never joke at their expense. ' : '') +
    'no capital letters, no em-dash.';
  return llm(system, `you asked: ${ask}\nthey answered: ${answer}`);
}

// the extraction pass: transcript + schema → fields, notes, and the recap line
async function fetchExtraction(
  def: SessionDef,
  transcript: string,
): Promise<{ fields: Record<string, string>; notes: { tag: string; text: string }[]; recap: string } | null> {
  const system =
    `you extract structured profile data from a get-to-know-you chat transcript. respond with ONLY valid JSON, no fences, in this shape:\n` +
    `{"fields": {…}, "notes": [{"tag": "…", "text": "…"}], "recap": "…"}\n` +
    `- "fields" keys MUST be from: ${def.schema.fields.join(', ') || '(none)'} — short lowercase values, omit anything the user didn't clearly say\n` +
    `- "notes" tags MUST be from: ${def.schema.notes.join(', ')} — text is a short quote-like capture of the user's own words\n` +
    `- "recap" is a 1-2 sentence playful readback of what you learned, as a lowercase internet-native friend, ending with "locked in 🔒". no em-dash.`;
  const reply = await llm(system, transcript);
  if (!reply) return null;
  try {
    const raw = reply
      .replace(/^```(json)?/m, '')
      .replace(/```\s*$/m, '')
      .trim();
    const parsed = JSON.parse(raw);
    return {
      fields: parsed.fields ?? {},
      notes: Array.isArray(parsed.notes) ? parsed.notes : [],
      recap: typeof parsed.recap === 'string' ? parsed.recap : 'ok, got all of that. locked in 🔒',
    };
  } catch {
    return null;
  }
}

function Dot({ delay }: { delay: number }) {
  const v = useSharedValue(0.3);
  useEffect(() => {
    v.value = withDelay(delay, withRepeat(withTiming(1, { duration: 500 }), -1, true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const style = useAnimatedStyle(() => ({ opacity: v.value }));
  return <Animated.View style={style} className="w-2 h-2 rounded-full bg-white/70" />;
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

export function SessionChat({
  sessionId,
  onClose,
  onDone,
  onConstellation,
}: {
  sessionId: string;
  // dive out mid-session (progress is already saved per beat)
  onClose: () => void;
  // completed: host closes the window and may offer travel
  onDone: () => void;
  // report constellation progress → the night sky lights `lit` of `total` stars
  onConstellation?: (lit: number, total: number) => void;
}) {
  const insets = useSafeAreaInsets();
  const def = sessionFor(sessionId);
  const saveSessionProgress = useSidekickContext((s) => s.saveSessionProgress);
  const completeSession = useSidekickContext((s) => s.completeSession);

  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [typing, setTyping] = useState(false);
  const [phase, setPhase] = useState<Phase>('asking');
  const [input, setInput] = useState('');
  const scrollRef = useRef<ScrollView>(null);
  const beatIdx = useRef(0);
  const answers = useRef<string[]>([]);
  const transcriptExtra = useRef(''); // recap corrections appended for re-extraction
  const extraction = useRef<{ fields: Record<string, string>; notes: { tag: string; text: string }[] } | null>(null);
  const confirmedOnce = useRef(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  // keep the newest bubble in view
  useEffect(() => {
    const id = setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 50);
    return () => clearTimeout(id);
  }, [msgs, typing, phase]);
  // clear pending timers on unmount
  useEffect(() => () => timers.current.forEach((t) => clearTimeout(t)), []);

  // slide the input bar up with the keyboard
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

  // fade the whole surface in over ~0.8s so it arrives with the sky darkening
  const enter = useSharedValue(0);
  useEffect(() => {
    enter.value = withTiming(1, { duration: 800, easing: Easing.out(Easing.cubic) });
  }, [enter]);
  const rootStyle = useAnimatedStyle(() => ({ opacity: enter.value }));

  const later = (fn: () => void, ms: number) => {
    const t = setTimeout(fn, ms);
    timers.current.push(t);
  };
  const showBotThen = (texts: string[], after: () => void) => {
    let i = 0;
    const next = () => {
      if (i >= texts.length) return after();
      const text = texts[i];
      i += 1;
      setTyping(true);
      later(() => {
        setTyping(false);
        setMsgs((m) => [...m, { role: 'bot', text }]);
        later(next, 300);
      }, 600);
    };
    next();
  };

  const askBeat = (idx: number) => {
    if (!def) return;
    beatIdx.current = idx;
    setPhase('asking');
    // a star lights for each beat already behind us (beats 0..idx-1 are done)
    onConstellation?.(idx, def.beats.length);
    showBotThen(def.beats[idx].ask, () => setPhase('answer'));
  };

  // kick off: fresh intro, or a "where were we" resume at the saved beat
  useEffect(() => {
    if (!def) return;
    const st = useSidekickContext.getState().sessions[def.id];
    answers.current = st ? [...st.answers] : [];
    const resuming = !!st && st.beat > 0 && !st.done;
    if (resuming) {
      showBotThen(['oh hey, you\'re back!!', 'where were we… right:'], () => askBeat(st.beat));
    } else {
      showBotThen([INTRO_EXPLAINER, ...def.intro], () => askBeat(0));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [def?.id]);

  const transcript = () =>
    (def?.beats ?? [])
      .map((b, i) => (answers.current[i] ? `q: ${b.ask.join(' ')}\na: ${answers.current[i]}` : null))
      .filter(Boolean)
      .join('\n\n') + transcriptExtra.current;

  const finish = async () => {
    if (!def) return;
    onConstellation?.(def.beats.length, def.beats.length); // all beats in → full constellation
    setPhase('extracting');
    setTyping(true);
    const ex = await fetchExtraction(def, transcript());
    setTyping(false);
    extraction.current = ex ? { fields: ex.fields, notes: ex.notes } : { fields: {}, notes: [] };
    showBotThen([ex?.recap ?? 'ok, got all of that. locked in 🔒', 'did i get that right?'], () => setPhase('confirm'));
  };

  const nextBeat = () => {
    if (!def) return;
    const n = beatIdx.current + 1;
    if (n < def.beats.length) askBeat(n);
    else void finish();
  };

  const celebrate = () => {
    if (!def) return;
    completeSession(def, { fields: extraction.current?.fields ?? {}, notes: extraction.current?.notes ?? [] });
    showBotThen([`and that's ${def.title.toLowerCase()} done. +${def.bond}% bond 🧡`, 'the island\'s open. let\'s gooo 🏝️'], () =>
      setPhase('done'),
    );
  };

  const submit = async () => {
    if (!def) return;
    const text = input.trim();
    if (!text || typing || phase === 'asking' || phase === 'extracting') return;
    setInput('');
    setMsgs((m) => [...m, { role: 'user', text }]);

    if (phase === 'confirm') {
      const yes = /^(y|yes|yep|yeah|yup|sure|correct|mostly|all good|👍|✓)/i.test(text) && text.length < 24;
      if (yes || confirmedOnce.current) return celebrate();
      confirmedOnce.current = true;
      transcriptExtra.current += `\n\ncorrection from the user about your summary: ${text}`;
      setPhase('extracting');
      setTyping(true);
      const ex = await fetchExtraction(def, transcript());
      setTyping(false);
      if (ex) extraction.current = { fields: ex.fields, notes: ex.notes };
      showBotThen([ex ? `ok fixed. ${ex.recap}` : 'ok noted!!', 'good now?'], () => setPhase('confirm'));
      return;
    }

    const beat = def.beats[beatIdx.current];
    const prev = answers.current[beatIdx.current];
    answers.current[beatIdx.current] = prev ? `${prev} / ${text}` : text;
    saveSessionProgress(def.id, beatIdx.current, answers.current);

    if (phase === 'probe') {
      // the one follow-up is answered — move on with a tiny scripted beat
      showBotThen(['got it got it'], nextBeat);
      return;
    }
    // decide: probe once on substantial answers (never on sensitive sessions)
    const wantProbe = !!beat.probe && !def.sensitive && text.length >= 12;
    setPhase('asking');
    setTyping(true);
    const ack = await fetchAck(def, beat.ask.join(' '), text, wantProbe);
    setTyping(false);
    if (ack) {
      setMsgs((m) => [...m, { role: 'bot', text: ack }]);
      if (wantProbe) {
        setPhase('probe');
        return;
      }
      later(nextBeat, 350);
    } else {
      // offline/errored: keep the session moving with a scripted ack
      showBotThen(['love that'], nextBeat);
    }
  };

  if (!def) return null;
  const progress = Math.min(beatIdx.current + 1, def.beats.length);
  const sendDisabled = !input.trim() || typing || phase === 'asking' || phase === 'extracting';

  return (
    // Transparent over the 3D night sky (rendered by the main canvas behind).
    // Explicit height (NOT flex-1) so the input pins to the bottom on RN-web,
    // where a top/bottom-only absolute parent doesn't size flex children.
    // Fades in over ~0.8s as the sky darkens under the camera's pan up.
    <Animated.View style={[{ height: SCREEN_H, paddingTop: insets.top }, rootStyle]}>
      {/* header: the live sidekick head (mounted once here — never remounts, so
          no flash), the session title + progress, and the dive-out chevron */}
      <View className="items-center px-4 pb-2.5 pt-3">
        <Pressable
          onPress={onClose}
          accessibilityLabel="Leave session"
          className="absolute right-3 top-2.5 w-9 h-9 rounded-full bg-white/15 items-center justify-center"
        >
          <Ionicons name="chevron-down" size={20} color="rgba(255,255,255,0.8)" />
        </Pressable>
        <SidekickAvatar size={44} style={{ marginBottom: 4 }} />
        <Text className="text-[16px] font-extrabold text-white">{def.title}</Text>
        <Text className="mt-0.5 text-[11px] font-semibold text-[#C9BCFF]">
          {phase === 'done' ? 'complete!' : `${progress} of ${def.beats.length}`}
        </Text>
      </View>

      {/* clear focal zone up top — the constellation + stars live here, nothing
          covers them (the messages sit in the panel below) */}
      <View style={{ height: SCREEN_H * 0.32 }} pointerEvents="none" />

      {/* lower panel: a semi-transparent night-glass container holding the
          scrolling messages + input, so the sky stays the focal point above */}
      <Animated.View
        style={[
          {
            flex: 1,
            backgroundColor: 'rgba(12,8,28,0.55)',
            borderTopLeftRadius: 28,
            borderTopRightRadius: 28,
            borderTopWidth: 1,
            borderColor: 'rgba(255,255,255,0.08)',
            overflow: 'hidden',
          },
          kbPad,
        ]}
      >
        <ScrollView
          ref={scrollRef}
          style={{ flex: 1 }}
          className="px-4 pt-4"
          contentContainerStyle={{ paddingBottom: 12, gap: 12 }}
          showsVerticalScrollIndicator={false}
        >
          {/* no bubbles — just white text. bot lines left, user lines right. the
              sidekick's head lives once in the header (no per-line GL contexts) */}
          {msgs.map((m, i) =>
            m.role === 'bot' ? (
              <View key={i} style={{ maxWidth: '90%' }} className="self-start">
                <Text className="text-[15px] leading-[22px] text-white">{m.text}</Text>
              </View>
            ) : (
              <View key={i} style={{ maxWidth: '84%' }} className="self-end">
                <Text className="text-[15px] leading-[22px] text-white text-right">{m.text}</Text>
              </View>
            ),
          )}
          {typing ? (
            <View className="self-start">
              <TypingDots />
            </View>
          ) : null}
        </ScrollView>

        <View
          className="px-3 pt-2 border-t border-white/10"
          style={{ paddingBottom: Math.max(insets.bottom, 12) + 8 }}
        >
          {phase === 'done' ? (
            <Pressable onPress={onDone} className="rounded-full bg-[#7A5AF8] py-3.5 items-center">
              <Text className="text-[16px] font-bold text-white">See the island</Text>
            </Pressable>
          ) : (
            <View className="flex-row items-center gap-2">
              <TextInput
                value={input}
                onChangeText={setInput}
                placeholder={phase === 'confirm' ? 'yep / fix something…' : 'message'}
                placeholderTextColor="rgba(17,17,17,0.4)"
                className="flex-1 rounded-full bg-white/90 px-5 py-3 text-[15px] text-[#111]"
                onSubmitEditing={() => void submit()}
                returnKeyType="send"
              />
              <Pressable
                onPress={() => void submit()}
                disabled={sendDisabled}
                className={`w-11 h-11 rounded-full bg-[#7A5AF8] items-center justify-center ${sendDisabled ? 'opacity-40' : ''}`}
              >
                <Ionicons name="arrow-up" size={20} color="#fff" />
              </Pressable>
            </View>
          )}
        </View>

        {/* soft gradient fade at the top of the message list, so messages
            dissolve into the sky/constellation zone above instead of hard-cutting
            at the panel edge (pointerEvents none so it never blocks scroll) */}
        <LinearGradient
          colors={['rgba(14,9,30,0.95)', 'rgba(14,9,30,0)']}
          pointerEvents="none"
          style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 72 }}
        />
      </Animated.View>
    </Animated.View>
  );
}
