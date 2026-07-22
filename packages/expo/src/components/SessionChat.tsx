import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import {
  Alert,
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

import { islandOpensWith, sessionFor } from '@sidekick/core';

import { SliderRow } from './look-controls';
import {
  ackSessionAnswer,
  completeSession,
  extractSession,
  saveSessionProgress,
  type SessionExtractionRun,
} from '../lib/api';
import {
  patchSessionComplete,
  patchSessionProgress,
  SNAPSHOT_QUERY_KEY,
  snapshotSessions,
  type Snapshot,
} from '../lib/state';
import { starFaceSnippet, useStarFaceConfig } from '../store/starFaceConfig';
import { useSidekickContext, type Astral } from '../store/context';

const { height: SCREEN_H } = Dimensions.get('window');

// RN port of the web guided-session runner (packages/web/src/components/
// session-chat.tsx): a session's OWN chat surface. Scripted asks, free-form
// answers, one LLM acknowledgment per beat (with a single optional probe),
// progress persisted per answer so the user can dive out (chevron) and back in.
// Ends with an extraction pass → recap → "did i get that right?" → rewards.
//
// LLM + persistence are server-side (plan 20 decision 9): every answer upserts
// `sessions.progress`, the ack/extraction run over the server-stored transcript,
// and `sessions.complete` pays rewards from core's catalog. When any LLM call
// fails the flow falls back to a scripted line, exactly as it always has —
// only completion truly needs the network (it pays out).

type Msg = { role: 'bot' | 'user'; text: string };
type Phase = 'asking' | 'answer' | 'probe' | 'extracting' | 'confirm' | 'done';

// What the star chat is — shown ONCE, on the user's very first session. Every
// later session opens with WELCOME_BACK + that session's own `def.intro`
// instead, since the framing only needs explaining the first time.
const STAR_CHAT_INTRO = [
  'this is our star chat, where i get to know you better',
  'as you answer, your star chart will come together',
  'the better i know you, the better i can help',
  'and at the end you can see your astral card!',
];
const WELCOME_BACK = 'welcome back to our star chat';

// the end-of-session payoff: the astral card, rewritten each session from the
// WHOLE server-stored profile. `archetype` is a poetic title, `traits` are
// quick descriptors.
type Analysis = Astral;
// shown when the model's analysis didn't parse (the server returned no card)
const FALLBACK_ANALYSIS: Analysis = {
  archetype: 'a sky still forming',
  reading:
    "i'm still learning your constellation, but i can already tell there's a lot up there worth mapping. the more we talk, the brighter it all gets. ✦",
  traits: ['curious', 'open', 'worth knowing'],
};

// ---- TEMPORARY: star-face look-dev -----------------------------------------
// OFF: the tuned numbers are baked into the constants in three/renderer.ts, so
// the chat transcript is back. Flip this to true to dial the sky in live again
// (the sliders start from those same values). To delete the tool for good: this
// flag + StarFaceTuner below, store/starFaceConfig.ts, the renderer's
// setStarFace, and the canvas's starFace prop — the uniforms stay.
export const STAR_FACE_TUNING = true; // TEMP: re-tuning the star sky (bake + flip back when done)

export function StarFaceTuner() {
  const cfg = useStarFaceConfig();
  const set = useStarFaceConfig((s) => s.set);
  const reset = useStarFaceConfig((s) => s.reset);
  const [saved, setSaved] = useState(false);
  // Every drag already persists (the store is on AsyncStorage), so this is the
  // last mile: print the values as a paste-ready block for renderer.ts, which is
  // the only way a tuning session actually lands in the code.
  const save = () => {
    console.log('\n' + starFaceSnippet(cfg) + '\n');
    setSaved(true);
    setTimeout(() => setSaved(false), 1600);
  };
  return (
    <ScrollView
      style={{ flex: 1 }}
      className="px-3 pt-3"
      contentContainerStyle={{ paddingBottom: 16 }}
      showsVerticalScrollIndicator={false}
    >
      <View className="flex-row items-center justify-between px-1 pb-1">
        <Text className="text-[11px] font-extrabold uppercase tracking-[2px] text-[#C9BCFF]">
          ✦ star face — temporary
        </Text>
        <View className="flex-row items-center gap-2">
          <Pressable onPress={reset} className="rounded-full bg-white/15 px-3 py-1">
            <Text className="text-[11px] font-bold text-white">reset</Text>
          </Pressable>
          <Pressable onPress={save} className="rounded-full bg-[#7A5AF8] px-3 py-1">
            <Text className="text-[11px] font-bold text-white">{saved ? 'logged ✓' : 'save'}</Text>
          </Pressable>
        </View>
      </View>
      <Text className="px-1 pb-1 text-[10px] text-[#C9BCFF]/60">
        every drag is saved automatically · save prints the constants to the console
      </Text>
      <SliderRow label="Line alpha" value={cfg.lineAlpha} min={0} max={1} onChange={(v) => set('lineAlpha', v)} />
      <SliderRow label="Dust bright" value={cfg.dustWeight} min={0} max={1} onChange={(v) => set('dustWeight', v)} />
      <SliderRow label="Star size" value={cfg.starSize} min={0.3} max={3} onChange={(v) => set('starSize', v)} />
      <SliderRow label="Shine speed" value={cfg.shineSpeed} min={0} max={2} onChange={(v) => set('shineSpeed', v)} />
      <SliderRow label="Shine depth" value={cfg.shineDepth} min={0} max={1} onChange={(v) => set('shineDepth', v)} />
      <SliderRow label="Size" value={cfg.size} min={5} max={30} onChange={(v) => set('size', v)} />
      <SliderRow label="Height" value={cfg.height} min={14} max={40} onChange={(v) => set('height', v)} />
      <SliderRow label="Depth" value={cfg.depth} min={-50} max={-12} onChange={(v) => set('depth', v)} />
      <SliderRow label="Pitch" value={cfg.pitch} min={-0.4} max={1.2} onChange={(v) => set('pitch', v)} />
      <SliderRow label="Pulse pitch" value={cfg.pulseAmt} min={0} max={0.2} onChange={(v) => set('pulseAmt', v)} />
      <SliderRow label="Pulse depth" value={cfg.pulseDepth} min={0} max={4} onChange={(v) => set('pulseDepth', v)} />
      <SliderRow label="Pulse rate" value={cfg.pulseHz} min={0.01} max={0.3} onChange={(v) => set('pulseHz', v)} />
    </ScrollView>
  );
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
}: {
  sessionId: string;
  // dive out mid-session (progress is already saved per beat)
  onClose: () => void;
  // completed: host closes the window and may offer travel
  onDone: () => void;
}) {
  const insets = useSafeAreaInsets();
  const def = sessionFor(sessionId);
  const queryClient = useQueryClient();

  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [typing, setTyping] = useState(false);
  const [phase, setPhase] = useState<Phase>('asking');
  const [input, setInput] = useState('');
  const scrollRef = useRef<ScrollView>(null);
  const beatIdx = useRef(0);
  // Cumulative answers, indexed by beat. Holes appear on a cold-start resume
  // (the snapshot carries beat/done but not answers — they're server-side), so
  // reads treat entries as possibly-undefined and writes send '' for the gaps.
  const answers = useRef<(string | undefined)[]>([]);
  const corrections = useRef<string[]>([]); // recap corrections, re-sent to sessions.extract
  const extraction = useRef<{ fields: Record<string, string>; notes: { tag: string; text: string }[] } | null>(null);
  // the refreshed card this session produced, handed to sessions.complete. null =
  // nothing new (offline/parse fail), so the stored card survives untouched.
  const nextAstral = useRef<Astral | null>(null);
  // opens on the card they already have (snapshot.astral), so a returning user
  // sees it update rather than appear from nothing
  const [analysis, setAnalysis] = useState<Analysis>(
    () => queryClient.getQueryData<Snapshot>(SNAPSHOT_QUERY_KEY)?.astral ?? FALLBACK_ANALYSIS,
  );
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
    showBotThen(def.beats[idx].ask, () => setPhase('answer'));
  };

  // kick off: three openings — resume where they left off, the one-time star
  // chat explainer (first session ever), or a welcome-back + this session's
  // topic intro for every session after that
  useEffect(() => {
    if (!def) return;
    const sessions = snapshotSessions(queryClient.getQueryData<Snapshot>(SNAPSHOT_QUERY_KEY));
    const st = sessions[def.id];
    // this run's answers survive a dive-out in the ephemeral store; across a
    // cold start they live server-side only, so the array starts sparse
    const stored = useSidekickContext.getState().sessionAnswers[def.id];
    answers.current = stored ? [...stored] : [];
    const resuming = !!st && st.beat > 0 && !st.done;
    // first star chat ever = they've never touched a session before this one
    const firstEver = Object.keys(sessions).length === 0;
    if (resuming) {
      showBotThen(['oh hey, you\'re back!!', 'where were we… right:'], () => askBeat(st.beat));
    } else if (firstEver) {
      showBotThen([...STAR_CHAT_INTRO, ...def.intro], () => askBeat(0));
    } else {
      showBotThen([WELCOME_BACK, ...def.intro], () => askBeat(0));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [def?.id]);

  // Upsert the transcript server-side (the authoritative copy). A failed write
  // is simply retried by the next answer's cumulative upsert — but it also means
  // the stored beat is stale, so the caller skips the ack (whose ask the server
  // derives from that stored beat) and uses the scripted line instead.
  const postProgress = async (): Promise<boolean> => {
    if (!def) return false;
    const toSend = Array.from(answers.current, (a) => a ?? '');
    useSidekickContext.getState().setSessionAnswers(def.id, toSend);
    try {
      const { stateVersion } = await saveSessionProgress(def.id, beatIdx.current, toSend);
      patchSessionProgress(queryClient, def.id, beatIdx.current, stateVersion);
      return true;
    } catch {
      return false;
    }
  };

  // the extraction pass over the server-stored transcript; null = model failure
  // (the flow proceeds with an empty extraction and its scripted recap line)
  const runExtraction = async (): Promise<SessionExtractionRun | null> => {
    if (!def) return null;
    try {
      return await extractSession(
        def.id,
        corrections.current.length ? corrections.current : undefined,
      );
    } catch {
      return null;
    }
  };

  const storedAstral = () =>
    queryClient.getQueryData<Snapshot>(SNAPSHOT_QUERY_KEY)?.astral ?? null;

  const finish = async () => {
    if (!def) return;
    setPhase('extracting');
    setTyping(true);
    const ex = await runExtraction();
    setTyping(false);
    extraction.current = ex ? { fields: ex.fields, notes: ex.notes } : { fields: {}, notes: [] };
    // Show: fresh card, else the one they already have, else a placeholder.
    // Persist: ONLY a fresh card — `?? null` keeps sessions.complete from
    // writing, so a bad reading leaves the earned card untouched.
    setAnalysis(ex?.analysis ?? storedAstral() ?? FALLBACK_ANALYSIS);
    nextAstral.current = ex?.analysis ?? null;
    showBotThen([ex?.recap ?? 'ok, got all of that. locked in 🔒', 'did i get that right?'], () => setPhase('confirm'));
  };

  const nextBeat = () => {
    if (!def) return;
    const n = beatIdx.current + 1;
    if (n < def.beats.length) askBeat(n);
    else void finish();
  };

  const celebrate = async () => {
    if (!def) return;
    // 'extracting' disables the input while the completion is in flight
    setPhase('extracting');
    setTyping(true);
    try {
      const result = await completeSession(def.id, {
        fields: extraction.current?.fields ?? {},
        notes: extraction.current?.notes ?? [],
        astral: nextAstral.current,
      });
      setTyping(false);
      // the response carries the catalog-paid coins/bond + refreshed card —
      // patch the snapshot so the map, star and balances update immediately
      patchSessionComplete(queryClient, def.id, result);
      // Flag the island until the map is seen — but only if this completion
      // actually OPENED it. The first island is unlocked from launch, so
      // finishing its session opens nothing new and must not claim otherwise.
      if (islandOpensWith(def.id)) {
        useSidekickContext.getState().markUnseenIsland(def.id);
      }
      // the payoff is the card itself (rendered below) — these lines hand off to it
      showBotThen(
        [`and that's ${def.title.toLowerCase()} done. +${def.bond}% bond 🧡`, 'here\'s your astral card, updated ✦'],
        () => setPhase('done'),
      );
    } catch (error) {
      // a session can't complete offline (plan 20): surface it and stay on the
      // recap step — another "yes" retries (complete is replay-safe server-side)
      setTyping(false);
      const message =
        error instanceof Error && error.message
          ? error.message
          : 'something went wrong — try again';
      Alert.alert("Couldn't finish the session", message);
      setPhase('confirm');
    }
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
      corrections.current.push(text);
      setPhase('extracting');
      setTyping(true);
      const ex = await runExtraction();
      setTyping(false);
      if (ex) {
        extraction.current = { fields: ex.fields, notes: ex.notes };
        // same rule as finish(): only a real card displaces what's on screen or
        // in the store
        if (ex.analysis) {
          setAnalysis(ex.analysis);
          nextAstral.current = ex.analysis;
        }
      }
      showBotThen([ex ? `ok fixed. ${ex.recap}` : 'ok noted!!', 'good now?'], () => setPhase('confirm'));
      return;
    }

    const beat = def.beats[beatIdx.current];
    const prev = answers.current[beatIdx.current];
    answers.current[beatIdx.current] = prev ? `${prev} / ${text}` : text;
    const saved = await postProgress();

    if (phase === 'probe') {
      // the one follow-up is answered — move on with a tiny scripted beat
      showBotThen(['got it got it'], nextBeat);
      return;
    }
    // decide: probe once on substantial answers (never on sensitive sessions)
    const wantProbe = !!beat.probe && !def.sensitive && text.length >= 12;
    setPhase('asking');
    setTyping(true);
    let ack: string | null = null;
    if (saved) {
      try {
        ack = (await ackSessionAnswer(def.id, text, wantProbe)).text;
      } catch {
        ack = null;
      }
    }
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
  const sendDisabled = !input.trim() || typing || phase === 'asking' || phase === 'extracting';

  return (
    // Transparent over the 3D night sky (rendered by the main canvas behind).
    // Explicit height (NOT flex-1) so the input pins to the bottom on RN-web,
    // where a top/bottom-only absolute parent doesn't size flex children.
    // Fades in over ~0.8s as the sky darkens under the camera's pan up.
    <Animated.View style={[{ height: SCREEN_H, paddingTop: insets.top }, rootStyle]}>
      {/* Just the dive-out chevron. No title, step count or avatar — the sky IS
          the header, and the sidekick is already up there in stars. */}
      <View className="px-4 pb-2.5 pt-3" pointerEvents="box-none">
        <Pressable
          onPress={onClose}
          accessibilityLabel="Leave session"
          className="absolute right-3 top-2.5 w-9 h-9 rounded-full bg-white/15 items-center justify-center"
        >
          <Ionicons name="chevron-down" size={20} color="rgba(255,255,255,0.8)" />
        </Pressable>
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
        {STAR_FACE_TUNING ? (
          <StarFaceTuner />
        ) : (
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

          {/* end-of-session payoff: the astral analysis card (the constellation
              is fully formed in the sky above by now) */}
          {phase === 'done' ? (
            <View className="mt-2 rounded-3xl border border-[#C9BCFF]/25 bg-[#170f2e]/80 p-5">
              <View className="flex-row items-center gap-1.5">
                <Text className="text-[12px] text-[#C9BCFF]">✦</Text>
                <Text className="text-[11px] font-extrabold uppercase tracking-[2px] text-[#C9BCFF]">
                  your astral card
                </Text>
              </View>
              <Text className="mt-2 text-[21px] font-extrabold leading-[26px] text-white">{analysis.archetype}</Text>
              {analysis.traits.length ? (
                <View className="mt-2.5 flex-row flex-wrap gap-1.5">
                  {analysis.traits.map((t, i) => (
                    <View key={i} className="rounded-full border border-white/10 bg-white/10 px-2.5 py-1">
                      <Text className="text-[12px] font-semibold text-[#E7E0FF]">{t}</Text>
                    </View>
                  ))}
                </View>
              ) : null}
              <Text className="mt-3.5 text-[14.5px] leading-[22px] text-[#E7E0FF]/90">{analysis.reading}</Text>
            </View>
          ) : null}
        </ScrollView>
        )}

        <View
          className="px-3 pt-2 border-t border-white/10"
          style={{ paddingBottom: Math.max(insets.bottom, 12) + 8 }}
        >
          {phase === 'done' ? (
            <Pressable onPress={onDone} className="rounded-full bg-[#7A5AF8] py-3.5 items-center">
              <Text className="text-[16px] font-bold text-white">Continue</Text>
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
      </Animated.View>
    </Animated.View>
  );
}
