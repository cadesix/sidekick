import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { Dimensions, Keyboard, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  PHASE_COUNT,
  buildArtifactPrompt,
  buildCardPrompt,
  buildControllerPrompt,
  flattenFields,
  islandOpensWith,
  isSessionDone,
  parseArtifact,
  parseControllerTurn,
  phaseDef,
  readyToAdvance,
  sessionForPhase,
  type ControllerTurn,
  type PersonalityArtifact,
} from '@sidekick/core';

import { MSG_SHADOW, STREAM_GAP_MS, StreamedText, TypingDots, streamDurationMs } from './chat-stream';
import { completeSession } from '../lib/api';
import { llm } from '../lib/openai';
import { patchSessionComplete, snapshotSessions, SNAPSHOT_QUERY_KEY, type Snapshot } from '../lib/state';
import { useSidekickContext } from '../store/context';
import { useStarChat } from '../store/star-chat';

const { height: SCREEN_H } = Dimensions.get('window');

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

// The chat sits over the 3D night sky, and the sidekick's star-head constellation
// floats in the upper area behind it. Rather than cover the top with a scrim
// (which would hide the head too), we ALPHA-fade the messages themselves toward
// the top, so the head shows straight through where the text dissolves. A long,
// gentle ramp: fully gone at the very top, fully solid by ~45% (roughly the
// bottom of the head). Web-only for now (react-native-web forwards the CSS mask);
// iOS parity would want @react-native-masked-view/masked-view.
const FADE_TOP =
  Platform.OS === 'web'
    ? ({
        maskImage: 'linear-gradient(to bottom, transparent 0%, rgba(0,0,0,0.55) 30%, black 46%)',
        WebkitMaskImage: 'linear-gradient(to bottom, transparent 0%, rgba(0,0,0,0.55) 30%, black 46%)',
      } as object)
    : null;

const FALLBACK_ARTIFACT: PersonalityArtifact = {
  archetype: 'a sky still forming',
  reading:
    "we've only just started mapping you, but there's already a lot up there worth knowing. the more we talk, the clearer it gets. ✦",
  traits: ['curious', 'open', 'worth knowing'],
  insights: [],
};

type Stage = 'chat' | 'generating' | 'artifact';

// Serializes all astral-card writes (chapter + final), module-scoped so it holds
// across a StarChat unmount/remount — the final card can never be overwritten by
// a still-pending earlier chapter's card. There is only ever one Star Chat.
let cardChain: Promise<void> = Promise.resolve();

export function StarChat({ onDone }: { onDone: (updated?: boolean) => void }) {
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const msgs = useStarChat((s) => s.msgs);
  const artifact = useStarChat((s) => s.artifact);
  const convo = useStarChat((s) => s.convo);
  const hydrated = useStarChat((s) => s.hydrated);
  // read the server snapshot from cache when we need the current astral / whether
  // a chapter's session is already completed (progression is server-owned now).
  const snapshot = () => queryClient.getQueryData<Snapshot>(SNAPSHOT_QUERY_KEY);

  const [stage, setStage] = useState<Stage>('chat');
  const [input, setInput] = useState('');
  const [typing, setTyping] = useState(false);
  // locked for the whole span of one turn (LLM + bot stream + boundary callback),
  // so a second send can't fire while a chapter advance is still pending — which
  // would double-advance and double-pay bond.
  const [working, setWorking] = useState(false);
  // at the end the card isn't shown inline; a teaser box opens it as a reveal modal
  const [revealOpen, setRevealOpen] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const mounted = useRef(true);
  const started = useRef(false);
  // true once any chapter has actually completed this session; gates the home
  // reaction so a quick open-then-leave doesn't falsely claim the card updated.
  const didUpdate = useRef(false);
  // messages already present when we start render as plain text; only lines
  // appended this session stream in (so a resume doesn't re-type the backlog).
  // Set in the kickoff effect, after hydration, so it reflects the real backlog.
  const streamFrom = useRef(Number.MAX_SAFE_INTEGER);

  const later = (fn: () => void, ms: number) => {
    const t = setTimeout(() => {
      if (mounted.current) fn();
    }, ms);
    timers.current.push(t);
  };
  useEffect(
    () => () => {
      mounted.current = false;
      timers.current.forEach((t) => clearTimeout(t));
    },
    [],
  );

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

  // kick off once both stores have hydrated (else start() could clobber an
  // in-progress persisted conversation or seed without the funnel goals):
  // fresh → opening + first question; resume → jump to where they were.
  useEffect(() => {
    if (!hydrated || started.current) return;
    started.current = true;
    // TODO(warm-start): goals moved server-side (fetchGoals); pass the user's
    // chosen goal slugs here to pre-seed `goal` + the motivation hypothesis again.
    useStarChat.getState().start();
    const st = useStarChat.getState();
    streamFrom.current = st.msgs.length; // whatever's already here renders plain
    retryUnconfirmedChapters(); // re-fire any chapter whose server completion failed earlier
    if (st.done) {
      setStage('artifact');
      return;
    }
    setStage('chat');
    // resume that already reached the final boundary but left before finalizing
    // (dive-out in the wrap-up window): finalize now instead of stranding them.
    if (st.convo && st.convo.phase >= PHASE_COUNT && readyToAdvance(st.convo)) {
      void finishConversation(st.convo.phase);
      return;
    }
    // Fresh start, or interrupted mid-opening (the first question was never
    // delivered): (re)deliver the opening, clearing any half-shown lines so they
    // don't duplicate. Safe: no user data exists before the first answer. Once
    // PHASE1_OPENER is present, the opening is done and we fall through (a
    // delivered-but-unanswered first question is just a normal awaiting-answer).
    if (!st.msgs.some((m) => m.text === PHASE1_OPENER) && !st.msgs.some((m) => m.role === 'user')) {
      if (st.msgs.length) useStarChat.setState({ msgs: [] });
      streamFrom.current = 0;
      // open warm, then straight into the first real (direct) question; the
      // sidekick asks age itself a beat in, per the age field's hint.
      showSeq([...OPENING], () => showBot(PHASE1_OPENER));
      return;
    }
    // a turn was interrupted mid-LLM (trailing user message, unanswered): re-run
    // the controller instead of stranding it. A trailing BOT message is a normal
    // resume (a question awaiting the user's answer) and needs nothing.
    if (st.msgs.length && st.msgs[st.msgs.length - 1].role === 'user') {
      void runController();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated]);

  const recentTranscript = () =>
    useStarChat
      .getState()
      .msgs.slice(-12)
      .map((m) => `${m.role === 'bot' ? 'sidekick' : 'user'}: ${m.text}`)
      .join('\n');

  // chapter boundary: deepen the astral card from everything learned + the card
  // they already have, then record chapter completion in the context store —
  // which pays bond, merges fields, and unlocks the matching island (islands are
  // folded in one-per-chapter, no longer the anchor). The conversation keeps
  // flowing (not awaited), but the card writes are CHAINED so a later chapter can
  // never land its card before an earlier one and stale-overwrite it. All writes
  // are to the persisted store, so they complete safely even after unmount.
  // withCard=false records a chapter's rewards/island/fields WITHOUT sending an
  // astral (the server overwrites users.astral with any card it's handed). Used by
  // the catch-up retry for earlier chapters, so re-completing a stale earlier
  // chapter can't clobber a newer chapter's card — only the latest one carries one.
  const completeChapter = (phase: number, withCard = true) => {
    cardChain = cardChain.then(async () => {
      const def = sessionForPhase(phase);
      const c = useStarChat.getState().convo;
      if (!def || !c) return;
      if (isSessionDone(snapshotSessions(snapshot()), def.id)) return; // already completed server-side
      let card: { archetype: string; reading: string; traits: string[] } | null = null;
      if (withCard) {
        const prior = snapshot()?.astral ?? null;
        const raw = await llm(buildCardPrompt(c, prior), 'write it now.', 460);
        const art = raw ? parseArtifact(raw) : null;
        card = art ? { archetype: art.archetype, reading: art.reading, traits: art.traits } : null;
        if (isSessionDone(snapshotSessions(snapshot()), def.id)) return; // guard post-await (idempotent)
      }
      try {
        // server pays catalog rewards by sessionId + persists the extraction/card;
        // patch the snapshot so bond, the card, and island unlock update at home.
        const result = await completeSession(def.id, { fields: flattenFields(c), notes: [], astral: card });
        patchSessionComplete(queryClient, def.id, result);
        if (islandOpensWith(def.id)) useSidekickContext.getState().markUnseenIsland(def.id);
        didUpdate.current = true; // only claim "card updated" once the snapshot is actually patched
      } catch {
        // transient failure (offline / server error): retried on the next open by
        // retryUnconfirmedChapters. Idempotent + server replay-safe, so no double-pay.
      }
    });
  };

  // last chapter: build the full artifact (with the evidence-cited insights) as
  // the payoff, and land the final card + last island via completeSession.
  const finishConversation = async (phase: number) => {
    if (mounted.current) {
      setStage('generating');
      setTyping(true);
    }
    const c = useStarChat.getState().convo;
    const raw = c ? await llm(buildArtifactPrompt(c), 'write the artifact now.', 520) : null;
    const art = (raw && parseArtifact(raw)) || FALLBACK_ARTIFACT;
    const def = sessionForPhase(phase);
    const card = { archetype: art.archetype, reading: art.reading, traits: art.traits };
    // Land the final card THROUGH the same chain as the chapter cards, so it can
    // never be overwritten by a still-pending earlier-chapter card write (final
    // card must win). Idempotent: the isSessionDone check + completeSession run
    // with no await between them, so a dive-out + reopen double-finalize pays once.
    cardChain = cardChain.then(async () => {
      // fully idempotent: a dive-out + reopen can start a second finalize. Both
      // route through this one chain, so the first sets done and any later one
      // sees it and skips — no double reward and no re-writing the reveal artifact.
      if (useStarChat.getState().done) return;
      if (def && c && !isSessionDone(snapshotSessions(snapshot()), def.id)) {
        try {
          const result = await completeSession(def.id, { fields: flattenFields(c), notes: [], astral: card });
          patchSessionComplete(queryClient, def.id, result);
          if (islandOpensWith(def.id)) useSidekickContext.getState().markUnseenIsland(def.id);
          didUpdate.current = true;
        } catch {
          // transient failure: the reading still shows (local artifact); server
          // completion is retried on the next open by retryUnconfirmedChapters.
        }
      } else {
        didUpdate.current = true; // already server-complete (a resume re-finalize)
      }
      // set the local reveal artifact regardless; `done` also gates resume, and a
      // still-unconfirmed final session gets retried on the next open.
      useStarChat.getState().finish(art);
    });
    await cardChain;
    if (mounted.current) {
      setTyping(false);
      setWorking(false);
      setStage('artifact');
    }
  };

  // A chapter's server completion is fire-and-forget; a transient failure (offline
  // / server error) leaves the client advanced but the session not done
  // server-side. On mount, re-fire completion for any reached chapter the snapshot
  // still shows incomplete. Idempotent: completeChapter guards on isSessionDone and
  // the server completion is replay-safe, so already-done chapters no-op. Skips
  // when the snapshot hasn't loaded yet (nothing to compare against).
  const retryUnconfirmedChapters = () => {
    const c = useStarChat.getState().convo;
    if (!c || !snapshot()) return;
    const reached = useStarChat.getState().done ? PHASE_COUNT : Math.min(c.phase - 1, PHASE_COUNT);
    for (let p = 1; p <= reached; p += 1) {
      const def = sessionForPhase(p);
      // only the latest reached chapter carries a card — earlier catch-ups must
      // not overwrite a newer chapter's astral with their older one.
      if (def && !isSessionDone(snapshotSessions(snapshot()), def.id)) completeChapter(p, p === reached);
    }
  };

  // one controller turn: react + extract + steer, then advance on the floor. The
  // `working` lock spans the whole turn so a second send can't race the advance.
  const runController = async () => {
    const c = useStarChat.getState().convo;
    if (!c) return;
    setWorking(true);
    setTyping(true);
    const raw = await llm(buildControllerPrompt(c), recentTranscript(), 340);
    if (!mounted.current) return; // dove out before applyTurn — nothing applied, resume re-runs it
    const turn: ControllerTurn =
      (raw && parseControllerTurn(raw)) || { message: SCRIPTED_NUDGE, fieldUpdates: [], phaseComplete: false };
    // Apply the turn, do the boundary's STORE side, AND persist the reply — all
    // synchronously — so the store is always consistent: once a user answer is
    // processed the transcript ends with the bot reply. (So a trailing USER
    // message on resume unambiguously means the turn wasn't applied → safe to
    // re-run; and a dive-out mid-stream can't drop the chapter completion.)
    useStarChat.getState().applyTurn(turn); // folds fields, bumps the phase turn counter
    const next = useStarChat.getState().convo!;
    const advancing = readyToAdvance(next);
    const ending = advancing && next.phase >= PHASE_COUNT;
    const completedPhase = next.phase; // the chapter whose floor we just filled
    if (advancing && !ending) {
      // advance the local phase now (unmount-safe); completeChapter fires the
      // server completion in the background and flips didUpdate once the snapshot
      // is actually patched (so the home reaction can't speak a not-yet-written card).
      useStarChat.getState().advance();
      completeChapter(completedPhase);
    }
    setTyping(false);
    useStarChat.getState().pushMsg({ role: 'bot', text: turn.message });
    // let the reply stream in, then finalize (ending) or unlock input. If the user
    // leaves first this won't fire, but the store is already consistent: resume
    // sees the persisted reply (no re-run) and the finalize-on-resume branch
    // catches an ending.
    later(() => {
      if (ending) {
        showSeq(["that's everything i wanted to ask ✦", 'let me pull your reading together…'], () => void finishConversation(completedPhase));
      } else {
        setWorking(false);
      }
    }, streamDurationMs(turn.message) + STREAM_GAP_MS);
  };

  // !convo → not started/hydrated yet: block sends so a pre-start message can't be
  // pushed and then wiped when start() seeds a fresh conversation.
  const busy = !convo || typing || working || stage === 'generating';
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
          onPress={() => onDone(didUpdate.current)}
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
          style={[{ flex: 1 }, FADE_TOP]}
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
        </ScrollView>

        <View className="px-3 pt-2 border-t border-white/10" style={{ paddingBottom: Math.max(insets.bottom, 12) + 8 }}>
          {stage === 'artifact' ? (
            // the card isn't shown inline; this teaser opens the reveal modal
            <Pressable
              onPress={() => setRevealOpen(true)}
              className="flex-row items-center rounded-3xl border border-[#C9BCFF]/40 bg-[#170f2e]/90 px-4 py-3.5"
              style={{ gap: 12, shadowColor: '#7A5AF8', shadowOpacity: 0.5, shadowRadius: 16, shadowOffset: { width: 0, height: 0 } }}
            >
              <View className="h-10 w-10 rounded-full items-center justify-center bg-[#7A5AF8]">
                <Text className="text-[18px] text-white">✦</Text>
              </View>
              <View className="flex-1">
                <Text className="text-[15px] font-extrabold text-white">Reveal your astral card</Text>
                <Text className="text-[12px] text-[#C9BCFF]/70">your reading is ready, tap to open</Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color="#C9BCFF" />
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

      {stage === 'artifact' && revealOpen && artifact ? (
        <AstralReveal artifact={artifact} onContinue={() => onDone(didUpdate.current)} />
      ) : null}
    </Animated.View>
  );
}

// The end-of-chat payoff: the astral card revealed as a modal (a dark backdrop +
// the card scaling/fading up), instead of appearing inline. Continue dismisses
// the whole Star Chat, and the sidekick reacts back on the home screen (the
// host's onDone speaks the reading).
function AstralReveal({ artifact, onContinue }: { artifact: PersonalityArtifact; onContinue: () => void }) {
  const insets = useSafeAreaInsets();
  const t = useSharedValue(0);
  useEffect(() => {
    t.value = withTiming(1, { duration: 640, easing: Easing.out(Easing.cubic) });
  }, [t]);
  const backStyle = useAnimatedStyle(() => ({ opacity: t.value }));
  const cardStyle = useAnimatedStyle(() => ({
    opacity: Math.min(1, t.value * 1.5),
    transform: [{ scale: 0.88 + t.value * 0.12 }, { translateY: (1 - t.value) * 26 }],
  }));

  return (
    <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 90, alignItems: 'center', justifyContent: 'center', padding: 22 }}>
      <Animated.View style={[{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(9,8,20,0.92)' }, backStyle]} />
      <Animated.View style={[{ width: '100%', maxWidth: 420 }, cardStyle]}>
        <View
          className="rounded-[28px] border border-[#C9BCFF]/30 bg-[#160e2c] overflow-hidden"
          style={{ maxHeight: SCREEN_H * 0.66, shadowColor: '#7A5AF8', shadowOpacity: 0.6, shadowRadius: 30, shadowOffset: { width: 0, height: 0 } }}
        >
          <ScrollView contentContainerStyle={{ padding: 24 }} showsVerticalScrollIndicator={false}>
            <View className="flex-row items-center gap-1.5">
              <Text className="text-[12px] text-[#C9BCFF]">✦</Text>
              <Text className="text-[11px] font-extrabold uppercase tracking-[2px] text-[#C9BCFF]">your astral card</Text>
            </View>
            <Text className="mt-2.5 text-[26px] font-extrabold leading-[30px] text-white">{artifact.archetype}</Text>
            {artifact.traits.length ? (
              <View className="mt-3 flex-row flex-wrap gap-1.5">
                {artifact.traits.map((tr, i) => (
                  <View key={i} className="rounded-full border border-white/10 bg-white/10 px-2.5 py-1">
                    <Text className="text-[12px] font-semibold text-[#E7E0FF]">{tr}</Text>
                  </View>
                ))}
              </View>
            ) : null}
            <Text className="mt-4 text-[15px] leading-[23px] text-[#E7E0FF]/90">{artifact.reading}</Text>
            {artifact.insights.length ? (
              <View className="mt-5 gap-3.5">
                {artifact.insights.map((ins, i) => (
                  <View key={i}>
                    <Text className="text-[14px] font-bold text-white">{ins.claim}</Text>
                    <Text className="mt-0.5 text-[13px] leading-[19px] text-[#E7E0FF]/70">{ins.because}</Text>
                  </View>
                ))}
              </View>
            ) : null}
          </ScrollView>
        </View>
        <Pressable
          onPress={onContinue}
          className="mt-4 rounded-full bg-[#7A5AF8] py-3.5 items-center"
          style={{ marginBottom: Math.max(insets.bottom, 8) }}
        >
          <Text className="text-[16px] font-bold text-white">Continue</Text>
        </Pressable>
      </Animated.View>
    </View>
  );
}
