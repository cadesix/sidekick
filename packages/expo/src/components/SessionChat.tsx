import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import { Dimensions, Keyboard, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { sessionFor, type SessionDef } from '@sidekick/core';

import { MSG_SHADOW, STREAM_GAP_MS, StreamedText, TypingDots, streamDurationMs } from './chat-stream';
import { SliderRow } from './look-controls';
import { starFaceSnippet, useStarFaceConfig } from '../store/starFaceConfig';
import { useSidekickContext, type Astral, type ContextNote } from '../store/context';
import { llm } from '../lib/openai';

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

const NAME = 'sidekick';

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
// WHOLE profile (see store/context). `archetype` is a poetic title, `traits`
// are quick descriptors.
type Analysis = Astral;
// shown when there's no AI key or the model's analysis didn't parse
const FALLBACK_ANALYSIS: Analysis = {
  archetype: 'a sky still forming',
  reading:
    "i'm still learning your constellation, but i can already tell there's a lot up there worth mapping. the more we talk, the brighter it all gets. ✦",
  traits: ['curious', 'open', 'worth knowing'],
};

// A poetic 2-4 word title. Real ones run ~19-25 chars ("the restless
// cartographer"), so this only bites a model that ignored the prompt — but it
// cuts on a word boundary rather than mid-word, because the result is shown to
// the user and spoken over the sidekick's head.
const ARCHETYPE_MAX = 48;

function capArchetype(s: string): string {
  if (s.length <= ARCHETYPE_MAX) return s;
  const cut = s.slice(0, ARCHETYPE_MAX);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trim();
}

// null when the model gave us nothing usable — NOT a fallback card. The
// difference is load-bearing: completeSession persists whatever it's handed and
// only declines when the card is null, so fabricating one here would overwrite a
// real reading earned by earlier sessions with "a sky still forming".
function parseAnalysis(a: unknown): Analysis | null {
  // Array.isArray: [] is typeof 'object' too, and an array is never a card.
  if (!a || typeof a !== 'object' || Array.isArray(a)) return null;
  const o = a as Record<string, unknown>;
  // capped: the archetype flows into astralNews() and out to the speech bubble,
  // which grows upward until it collides with the star above the head. The
  // prompt asks for 2-4 words, but a model that ignores that shouldn't be able
  // to break the layout.
  const archetype = typeof o.archetype === 'string' ? capArchetype(o.archetype.trim()) : '';
  // The archetype IS the card: it headlines it, and it's the line astralNews
  // speaks over the sidekick's head. Without a real one there is nothing worth
  // persisting — and a fallback-headed card would both overwrite an earned
  // reading and have the sidekick announce "i've got you as a sky still
  // forming". So no archetype, no card. (`{}`, `[]`, blank fields and
  // traits-only all land here.)
  if (!archetype) return null;
  const reading = typeof o.reading === 'string' ? o.reading.trim() : '';
  // trim + drop blanks: [''] is not a trait
  const traits = Array.isArray(o.traits)
    ? o.traits
        .filter((t): t is string => typeof t === 'string' && !!t.trim())
        .map((t) => t.trim())
        .slice(0, 4)
    : [];
  // a real archetype with a thin reading/traits is still a card — fall those back
  return {
    archetype,
    reading: reading || FALLBACK_ANALYSIS.reading,
    traits: traits.length ? traits : FALLBACK_ANALYSIS.traits,
  };
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

// A digest of everything earlier sessions already learned. Feeds the astral
// card so it reads as ONE person growing clearer, not six unrelated readings.
// Notes are capped — by the last session there can be a lot of them, and the
// card only needs the gist.
function priorProfile(fields: Record<string, string>, notes: ContextNote[], astral: Astral | null): string {
  const f = Object.entries(fields).map(([k, v]) => `${k}: ${v}`);
  const n = notes.slice(-14).map((x) => `${x.tag}: ${x.text}`);
  if (!f.length && !n.length && !astral) return '';
  return (
    `what you ALREADY know about them from earlier star chats (context for the astral card only —\n` +
    `do NOT re-extract any of this into "fields" or "notes"):\n` +
    (f.length ? `${f.join('\n')}\n` : '') +
    (n.length ? `${n.join('\n')}\n` : '') +
    (astral ? `\ntheir astral card right now:\narchetype: ${astral.archetype}\nreading: ${astral.reading}\ntraits: ${astral.traits.join(', ')}\n` : '') +
    `\n--- this session's transcript (extract fields + notes from THIS ONLY) ---\n`
  );
}

// the extraction pass: transcript + schema → fields, notes, the recap line, and
// the refreshed astral card
async function fetchExtraction(
  def: SessionDef,
  transcript: string,
  prior: { fields: Record<string, string>; notes: ContextNote[]; astral: Astral | null },
): Promise<{ fields: Record<string, string>; notes: { tag: string; text: string }[]; recap: string; analysis: Analysis | null } | null> {
  const head = priorProfile(prior.fields, prior.notes, prior.astral);
  const returning = !!head;
  const system =
    `you extract structured profile data from a get-to-know-you chat transcript. respond with ONLY valid JSON, no fences, in this shape:\n` +
    `{"fields": {…}, "notes": [{"tag": "…", "text": "…"}], "recap": "…", "analysis": {"archetype": "…", "reading": "…", "traits": ["…"]}}\n` +
    `- "fields" keys MUST be from: ${def.schema.fields.join(', ') || '(none)'} — short lowercase values, omit anything the user didn't clearly say\n` +
    `- "notes" tags MUST be from: ${def.schema.notes.join(', ')} — text is a short quote-like capture of the user's own words\n` +
    `- "recap" is a 1-2 sentence playful readback of what you learned, as a lowercase internet-native friend, ending with "locked in 🔒". no em-dash.\n` +
    `- "analysis" is their ASTRAL CARD: a warm, high-level, almost-astrology read of who this person is.\n` +
    (returning
      ? `  this is an UPDATE. rewrite the whole card from EVERYTHING you know (the profile above PLUS this transcript),\n` +
        `  so it's richer and more specific than the card they have now. keep what still rings true, deepen it with what's new.\n`
      : `  build it ONLY from what they shared in this transcript.\n`) +
    `  - "archetype": a poetic 2-4 word lowercase title capturing their vibe (e.g. "the midnight builder")\n` +
    `  - "reading": a warm, slightly mystical 2-3 sentence read of who they are — like a personalized horoscope grounded in what they actually said. speak in essence and pattern, not a list of facts. lowercase, no em-dash, no clichés\n` +
    `  - "traits": 3-4 short lowercase trait words${returning ? ' drawn from the full picture' : ' drawn from the chat'}`;
  // extraction JSON is the biggest payload (fields + notes + recap + analysis) —
  // give it real headroom so it never truncates mid-object
  const reply = await llm(system, head + transcript, 900);
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
      analysis: parseAnalysis(parsed.analysis),
    };
  } catch {
    return null;
  }
}

// ---- TEMPORARY: star-face look-dev -----------------------------------------
// OFF: the tuned numbers are baked into the constants in three/renderer.ts, so
// the chat transcript is back. Flip this to true to dial the sky in live again
// (the sliders start from those same values). To delete the tool for good: this
// flag + StarFaceTuner below, store/starFaceConfig.ts, the renderer's
// setStarFace, and the canvas's starFace prop — the uniforms stay.
export const STAR_FACE_TUNING = false;

function StarFaceTuner() {
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
  // the refreshed card this session produced, handed to completeSession. null =
  // nothing new (offline/parse fail), so the stored card survives untouched.
  const nextAstral = useRef<Astral | null>(null);
  // opens on the card they already have, so a returning user sees it update
  // rather than appear from nothing
  const [analysis, setAnalysis] = useState<Analysis>(
    () => useSidekickContext.getState().astral ?? FALLBACK_ANALYSIS,
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
        // one at a time: don't start the next line until this one has fully
        // streamed in, or two would type simultaneously
        later(next, streamDurationMs(text) + STREAM_GAP_MS);
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
    const { sessions } = useSidekickContext.getState();
    const st = sessions[def.id];
    answers.current = st ? [...st.answers] : [];
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

  const transcript = () =>
    (def?.beats ?? [])
      .map((b, i) => (answers.current[i] ? `q: ${b.ask.join(' ')}\na: ${answers.current[i]}` : null))
      .filter(Boolean)
      .join('\n\n') + transcriptExtra.current;

  // the profile as it stands BEFORE this session lands — the astral card is
  // rewritten from this plus the new transcript
  const prior = () => {
    const { fields, notes, astral } = useSidekickContext.getState();
    return { fields, notes, astral };
  };

  const finish = async () => {
    if (!def) return;
    setPhase('extracting');
    setTyping(true);
    const ex = await fetchExtraction(def, transcript(), prior());
    setTyping(false);
    extraction.current = ex ? { fields: ex.fields, notes: ex.notes } : { fields: {}, notes: [] };
    // Show: fresh card, else the one they already have, else a placeholder.
    // Persist: ONLY a fresh card — `?? null` keeps completeSession from writing,
    // so a bad reading leaves the earned card untouched.
    setAnalysis(ex?.analysis ?? prior().astral ?? FALLBACK_ANALYSIS);
    nextAstral.current = ex?.analysis ?? null;
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
    completeSession(
      def,
      { fields: extraction.current?.fields ?? {}, notes: extraction.current?.notes ?? [] },
      nextAstral.current,
    );
    // the payoff is the card itself (rendered below) — these lines hand off to it
    showBotThen(
      [`and that's ${def.title.toLowerCase()} done. +${def.bond}% bond 🧡`, 'here\'s your astral card, updated ✦'],
      () => setPhase('done'),
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
      const ex = await fetchExtraction(def, transcript(), prior());
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
      // let the ack finish streaming before the next beat's question types in
      later(nextBeat, streamDurationMs(ack) + STREAM_GAP_MS);
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

      {/* No container: the conversation sits directly over the night sky and its
          star-constellation head. Messages bottom-anchor and push UP as you chat
          (contentContainerStyle flex-end), so the sky stays clear above until the
          chat fills it. Text is inked for legibility over the stars. */}
      <Animated.View style={[{ flex: 1, overflow: 'hidden' }, kbPad]}>
        {STAR_FACE_TUNING ? (
          <StarFaceTuner />
        ) : (
        <ScrollView
          ref={scrollRef}
          style={{ flex: 1 }}
          className="px-4"
          contentContainerStyle={{ flexGrow: 1, justifyContent: 'flex-end', paddingBottom: 12, paddingTop: 24, gap: 12 }}
          showsVerticalScrollIndicator={false}
        >
          {/* no bubbles — just text. bot lines left (streamed in), user right. */}
          {msgs.map((m, i) =>
            m.role === 'bot' ? (
              <View key={i} style={{ maxWidth: '90%' }} className="self-start">
                <StreamedText
                  text={m.text}
                  className="text-[16px] leading-[23px] text-white"
                  style={MSG_SHADOW}
                  onReveal={() => scrollRef.current?.scrollToEnd({ animated: false })}
                />
              </View>
            ) : (
              <View key={i} style={{ maxWidth: '84%' }} className="self-end">
                <Text style={MSG_SHADOW} className="text-[16px] leading-[23px] text-white text-right">{m.text}</Text>
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
