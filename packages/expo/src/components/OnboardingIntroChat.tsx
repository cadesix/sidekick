import { useCallback, useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Pressable } from './Pressable';
import { regulateAction } from '../lib/api';
import { hapticMessage, hapticTap } from '../lib/haptics';
import { MessageBubble } from '../imessage/components/MessageBubble';
import { TypingIndicator } from '../imessage/components/TypingIndicator';
import { colors, type } from '../imessage/theme';
import { enablePushNotifications } from '../lib/notifications/registration';

// Scripted onboarding intro chat. A deterministic, client-side conversation (no
// LLM/server) so we can iterate on copy + feel fast. The sidekick introduces
// itself, learns why the user is here, and — for the habit path — lands one daily
// action, then asks for notifications. WIP: copy, branches, the improve→action
// map, and dream outcomes are all still being written. Edit SCRIPT / IMPROVE below.

// darker blue for the chips' hard "pressable button" bottom edge (under #007AFF)
const CHIP_SHADOW = '#0051D5';

type Choice = { label: string; value: string };

// What onboarding persists (packages/server onboarding.commitResult): the habit
// becomes a Goals object; the talk path seeds check-in prefs.
export type OnboardingResult = {
  reason: 'talk' | 'habits' | 'both';
  habit?: { slug: string; label: string; actionLabel: string; cadence: { type: 'daily' } };
  talk?: { topic: string };
};
// reason: talk | habits | both. improve/action drive the habit path; topic the
// talk path (seeds the daily check-in copy). onComplete gets the whole object.
type Vars = {
  name: string;
  reason: string;
  improve: string;
  action: string;
  topic: string;
};
type Msg = { id: string; role: 'me' | 'them'; text: string };

// One tap-through per "improve" option: the noun we're adding more of, the dream
// outcome we promise, and the daily actions to choose from. All placeholder copy.
const IMPROVE: Record<
  string,
  { label: string; thing: string; dream: string; actions: string[] }
> = {
  'eat-healthier': {
    label: 'eat healthier',
    thing: 'good food',
    dream: 'eating clean',
    actions: ['drink water first thing', 'swap one snack for fruit', 'cook one meal at home'],
  },
  'exercise-more': {
    label: 'exercise more',
    thing: 'movement',
    dream: 'feeling stronger',
    actions: ['a 10-min walk', '10 pushups', '5 min of stretching'],
  },
  'wake-earlier': {
    label: 'wake up earlier',
    thing: 'good mornings',
    dream: 'an early riser',
    actions: ['lights out 15 min earlier', 'no phone in bed', 'alarm across the room'],
  },
  'read-more': {
    label: 'read more books',
    thing: 'good books',
    dream: 'a few books deep',
    actions: ['read 5 pages', 'read before bed', 'one chapter a day'],
  },
  'be-organized': {
    label: 'be more organized',
    thing: 'order',
    dream: 'on top of it all',
    actions: ["write tomorrow's top 3", 'tidy one thing', 'clear your inbox'],
  },
  'mental-health': {
    label: 'improve my mental health',
    thing: 'calm',
    dream: 'feeling lighter',
    actions: ['1 min of breathing', 'jot one gratitude', 'a short walk outside'],
  },
};
const IMPROVE_ORDER = [
  'eat-healthier',
  'exercise-more',
  'wake-earlier',
  'read-more',
  'be-organized',
  'mental-health',
];

// {name} / {thing} / {dream} are resolved at send time from the chosen options.
function fill(s: string, v: Vars): string {
  const imp = IMPROVE[v.improve];
  return s
    .replace('{name}', v.name)
    .replace('{thing}', imp?.thing ?? 'good stuff')
    .replace('{dream}', imp?.dream ?? 'thriving');
}

type Node =
  | { kind: 'say'; when?: (v: Vars) => boolean; lines: string[] }
  // a tap that just posts a user bubble and advances (no branching); the options
  // are interchangeable phrasings of "continue"
  | { kind: 'reply'; when?: (v: Vars) => boolean; labels: string[] }
  // `input` adds a free-text field alongside the chips; `regulate` routes what
  // they type through the LLM to normalize it into a daily checkpoint first.
  | {
      kind: 'choose';
      when?: (v: Vars) => boolean;
      set: keyof Vars;
      options: (v: Vars) => Choice[];
      input?: { placeholder: string; regulate?: boolean };
    }
  | { kind: 'act'; when?: (v: Vars) => boolean; act: 'notif' | 'finish' };

const notTalk = (v: Vars) => v.reason !== 'talk';
const isTalk = (v: Vars) => v.reason === 'talk';

const SCRIPT: Node[] = [
  {
    kind: 'say',
    lines: [
      'heyy!',
      'i guess i should properly introduce myself',
      "i'm {name}. but you named me, so you already know that…",
    ],
  },
  { kind: 'reply', labels: ['Hi {name}!', 'yes i did!'] },
  {
    kind: 'say',
    lines: [
      'im kind of like chatgpt, except way cuter and smarter',
      'and more chill',
      'and i remember things about you',
      'and i have a ~soul~ and consciousness ✨',
      '(jk. maybe)',
    ],
  },
  { kind: 'reply', labels: ['so what do you do?', 'okayy tell me more'] },
  { kind: 'say', lines: ['i help you run your life!'] },
  {
    kind: 'say',
    lines: [
      'but in order to do that i need to learn a little about your life first…',
      "soo first of all, why'd you download this app?",
    ],
  },
  {
    kind: 'choose',
    set: 'reason',
    options: () => [
      { label: 'to talk and get advice', value: 'talk' },
      { label: 'to build better habits', value: 'habits' },
      { label: 'both!', value: 'both' },
    ],
  },
  // talk path: one open follow-up on what's on their mind — seeds the check-ins.
  { kind: 'say', when: isTalk, lines: ['i got you', 'anything specific on your mind?'] },
  {
    kind: 'choose',
    when: isTalk,
    set: 'topic',
    // value === label so the stored check-in prefs read naturally
    options: () => [
      { label: 'work & career', value: 'work & career' },
      { label: 'relationships', value: 'relationships' },
      { label: 'stress & anxiety', value: 'stress & anxiety' },
      { label: 'just life', value: 'life' },
    ],
  },
  // habit path
  {
    kind: 'say',
    when: notTalk,
    lines: [
      "nicee. did you know that you're 80% more likely to keep your habits with an accountability partner (like me!)",
      "what's one thing you want to improve about your life right now?",
    ],
  },
  {
    kind: 'choose',
    when: notTalk,
    set: 'improve',
    options: () => IMPROVE_ORDER.map((k) => ({ label: IMPROVE[k].label, value: k })),
  },
  {
    kind: 'say',
    when: notTalk,
    lines: ['we could all use more {thing} in our lives.', "let's start with one action per day. which feels doable?"],
  },
  {
    kind: 'choose',
    when: notTalk,
    set: 'action',
    options: (v) => (IMPROVE[v.improve]?.actions ?? []).map((a) => ({ label: a, value: a })),
    input: { placeholder: 'or type your own…', regulate: true },
  },
  {
    kind: 'say',
    when: notTalk,
    lines: ["perf, i'll shoot you a text to check in every day", "and you'll be {dream} in no time"],
  },
  // notifications — habit path lead
  {
    kind: 'say',
    when: notTalk,
    lines: ['one last thing', "can you turn on notifications so my texts don't get blocked?"],
  },
  // talk path lead: dive in + the same notif ask, in its own voice
  {
    kind: 'say',
    when: isTalk,
    lines: [
      'alright lets dive in.',
      "i'll also remember to check in with you about our conversation. can u do me a quick favor and enable notifications so my messages don't get blocked?",
    ],
  },
  { kind: 'act', act: 'notif' },
  { kind: 'say', lines: ['yay okay', 'come on in 🤝'] },
  { kind: 'act', act: 'finish' },
];

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// A reply button. Static style array (pressed via state) rather than the
// `({pressed}) => …` callback — NativeWind's css-interop drops the function form
// of `style` on native, which would leave the chip with no fill (invisible).
function ReplyChip({ label, onPress }: { label: string; onPress: () => void }) {
  const [pressed, setPressed] = useState(false);
  return (
    <Pressable
      onPress={() => {
        hapticTap();
        onPress();
      }}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      style={[chipStyles.base, pressed ? chipStyles.pressed : null]}
    >
      <Text style={chipStyles.text}>{label}</Text>
    </Pressable>
  );
}

const chipStyles = StyleSheet.create({
  base: {
    maxWidth: '85%',
    backgroundColor: colors.blue,
    borderRadius: 20,
    paddingHorizontal: 18,
    paddingVertical: 11,
    // hard (zero-blur) darker-blue underside → raised, pressable button
    shadowColor: CHIP_SHADOW,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 1,
    shadowRadius: 0,
    elevation: 4,
  },
  pressed: {
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
    transform: [{ translateY: 3 }],
  },
  text: { color: '#fff', fontSize: 15, fontWeight: '600' },
});

// Map the collected vars into the persisted shape: the improve/action pair → a
// daily habit goal; the talk topic/focus → check-in prefs.
function buildResult(v: Vars): OnboardingResult {
  const reason = (v.reason || 'habits') as OnboardingResult['reason'];
  const result: OnboardingResult = { reason };
  if (v.improve && v.action) {
    result.habit = {
      slug: v.improve,
      label: IMPROVE[v.improve]?.label ?? v.improve,
      actionLabel: v.action,
      cadence: { type: 'daily' },
    };
  }
  if (v.reason === 'talk' && v.topic) {
    result.talk = { topic: v.topic };
  }
  return result;
}

export function OnboardingIntroChat({
  sidekickName,
  onComplete,
}: {
  sidekickName: string;
  // called at the end with the structured picks (persisted server-side)
  onComplete: (result: OnboardingResult) => void;
}) {
  const insets = useSafeAreaInsets();
  const [messages, setMessages] = useState<Msg[]>([]);
  const [typing, setTyping] = useState(false);
  const [chips, setChips] = useState<Choice[]>([]);
  // the current step's free-text field (only the action step has one), + its value
  const [inputCfg, setInputCfg] = useState<{ placeholder: string; regulate?: boolean } | null>(null);
  const [inputText, setInputText] = useState('');
  const scrollRef = useRef<ScrollView>(null);
  const idRef = useRef(0);
  const aliveRef = useRef(true);
  const startedRef = useRef(false);
  const varsRef = useRef<Vars>({
    name: sidekickName.trim() || 'your sidekick',
    reason: '',
    improve: '',
    action: '',
    topic: '',
  });
  // where to resume + which var to set (if any), once the current chip is tapped
  const pendingRef = useRef<{ index: number; set?: keyof Vars } | null>(null);

  const nextId = () => `m${idRef.current++}`;
  const scrollToEnd = useCallback(() => {
    requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
  }, []);

  const pump = useCallback(
    async (from: number) => {
      let i = from;
      while (i < SCRIPT.length && aliveRef.current) {
        const node = SCRIPT[i];
        const v = varsRef.current;
        if (node.when && !node.when(v)) {
          i++;
          continue;
        }
        if (node.kind === 'say') {
          for (const raw of node.lines) {
            if (!aliveRef.current) return;
            setTyping(true);
            scrollToEnd();
            await sleep(Math.min(1400, 450 + raw.length * 16));
            if (!aliveRef.current) return;
            setTyping(false);
            const text = fill(raw, varsRef.current);
            setMessages((m) => [...m, { id: nextId(), role: 'them', text }]);
            hapticMessage(); // soft pop as each incoming message lands
            scrollToEnd();
            await sleep(320);
          }
          i++;
        } else if (node.kind === 'reply') {
          pendingRef.current = { index: i };
          setChips(node.labels.map((l) => ({ label: fill(l, v), value: l })));
          scrollToEnd();
          return; // wait for the tap (resumed in onPick)
        } else if (node.kind === 'choose') {
          pendingRef.current = { index: i, set: node.set };
          setChips(node.options(v));
          setInputCfg(node.input ?? null);
          scrollToEnd();
          return; // wait for a tap or typed answer (resumed in onPick / onSubmitInput)
        } else {
          if (node.act === 'notif') {
            try {
              await enablePushNotifications();
            } catch {
              // web / denied — keep going, this is a feel-test
            }
            i++;
          } else {
            onComplete(buildResult(varsRef.current));
            return;
          }
        }
      }
    },
    [onComplete, scrollToEnd],
  );

  const onPick = useCallback(
    (choice: Choice) => {
      const pending = pendingRef.current;
      if (!pending) return;
      pendingRef.current = null;
      setChips([]);
      setInputCfg(null);
      setMessages((m) => [...m, { id: nextId(), role: 'me', text: choice.label }]);
      if (pending.set) varsRef.current = { ...varsRef.current, [pending.set]: choice.value };
      scrollToEnd();
      void pump(pending.index + 1);
    },
    [pump, scrollToEnd],
  );

  // The free-text answer at a `choose` step with an `input`. For the action step
  // (`regulate`), the typed idea is run through the LLM: a daily-checkpoint
  // rewrite continues the flow, while a non-daily idea gets a nudge and re-asks.
  const onSubmitInput = useCallback(
    async (raw: string) => {
      const text = raw.trim();
      const pending = pendingRef.current;
      if (!text || !pending || !pending.set || typing) return;
      hapticTap();
      setMessages((m) => [...m, { id: nextId(), role: 'me', text }]);
      setInputText('');
      setChips([]);
      setInputCfg(null);
      const node = SCRIPT[pending.index];
      const cfg = node.kind === 'choose' ? node.input : undefined;
      // no regulation → take the raw text as the value and continue
      if (!cfg?.regulate) {
        pendingRef.current = null;
        varsRef.current = { ...varsRef.current, [pending.set]: text };
        scrollToEnd();
        void pump(pending.index + 1);
        return;
      }
      // regulate: the sidekick "thinks", then either accepts a daily version or nudges
      setTyping(true);
      scrollToEnd();
      const improveLabel = IMPROVE[varsRef.current.improve]?.label ?? varsRef.current.improve;
      let res: Awaited<ReturnType<typeof regulateAction>>;
      try {
        res = await regulateAction(improveLabel, text);
      } catch {
        res = { ok: true, action: text }; // network hiccup — accept as-is, never block onboarding
      }
      if (!aliveRef.current) return;
      setTyping(false);
      if (res.ok) {
        setMessages((m) => [...m, { id: nextId(), role: 'them', text: `love it. ${res.action} a day 💪` }]);
        hapticMessage();
        pendingRef.current = null;
        varsRef.current = { ...varsRef.current, [pending.set]: res.action };
        scrollToEnd();
        // small beat so the confirmation reads before the next scripted line
        await sleep(650);
        if (!aliveRef.current) return;
        void pump(pending.index + 1);
      } else {
        // stay on this step: nudge, then re-show the chips + input for another try
        setMessages((m) => [...m, { id: nextId(), role: 'them', text: res.nudge }]);
        hapticMessage();
        const v = varsRef.current;
        setChips(node.kind === 'choose' ? node.options(v) : []);
        setInputCfg(cfg);
        scrollToEnd();
      }
    },
    [pump, scrollToEnd, typing],
  );

  // Start the script once. Kept separate from the unmount teardown below so a
  // changing `pump` identity (onComplete is a fresh closure each parent render)
  // can't tear down `aliveRef` mid-sequence and freeze the chat.
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    void pump(0);
  }, [pump]);
  useEffect(() => () => {
    aliveRef.current = false;
  }, []);

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        ref={scrollRef}
        style={{ flex: 1 }}
        contentContainerStyle={{
          paddingHorizontal: 16,
          paddingTop: 24,
          // extra bottom breathing room so the last message never sits in the
          // bottom-left corner (there's no input field here to provide it).
          paddingBottom: insets.bottom + 28,
          gap: 6,
        }}
        showsVerticalScrollIndicator={false}
        onContentSizeChange={scrollToEnd}
        keyboardDismissMode="interactive"
        keyboardShouldPersistTaps="handled"
      >
        {messages.map((m) => {
          const mine = m.role === 'me';
          return (
            <View key={m.id} style={{ alignItems: mine ? 'flex-end' : 'flex-start' }}>
              <View style={{ maxWidth: '82%' }}>
                <MessageBubble from={mine ? 'me' : 'them'} tail>
                  <Text
                    style={{
                      color: mine ? colors.sentText : colors.receivedText,
                      fontSize: type.body.fontSize,
                      lineHeight: type.body.lineHeight,
                    }}
                  >
                    {m.text}
                  </Text>
                </MessageBubble>
              </View>
            </View>
          );
        })}
        {/* same loading bubble as the home chat */}
        {typing ? <TypingIndicator /> : null}

        {/* reply options sit right below the last message — where your reply
            would land — right-aligned like an outgoing bubble, scrolling with the
            transcript instead of in a separate bottom bar. iMessage-blue, styled
            as buttons — no tail, white text, hard (zero-blur) darker-blue edge. */}
        {chips.length > 0 ? (
          <View style={{ marginTop: 8, gap: 10, alignItems: 'flex-end' }}>
            {chips.map((chip) => (
              <ReplyChip key={chip.value} label={chip.label} onPress={() => onPick(chip)} />
            ))}
          </View>
        ) : null}
      </ScrollView>

      {/* free-text composer — only on steps that allow it (the action step). Pinned
          below the transcript so "or type your own…" sits under the preset chips. */}
      {inputCfg ? (
        <View
          style={{
            paddingHorizontal: 16,
            paddingTop: 8,
            paddingBottom: insets.bottom + 10,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <TextInput
            value={inputText}
            onChangeText={setInputText}
            placeholder={inputCfg.placeholder}
            placeholderTextColor="#9aa0a6"
            style={composerStyles.field}
            returnKeyType="send"
            onSubmitEditing={() => void onSubmitInput(inputText)}
            editable={!typing}
          />
          <Pressable
            accessibilityLabel="Send"
            onPress={() => void onSubmitInput(inputText)}
            disabled={typing || inputText.trim().length === 0}
            style={[
              composerStyles.send,
              typing || inputText.trim().length === 0 ? composerStyles.sendDisabled : null,
            ]}
          >
            <Text style={composerStyles.sendGlyph}>↑</Text>
          </Pressable>
        </View>
      ) : null}
    </KeyboardAvoidingView>
  );
}

const composerStyles = StyleSheet.create({
  field: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 11,
    fontSize: 15,
    color: '#111',
    // soft flat shadow to match the onboarding container styling
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 6,
    elevation: 2,
  },
  send: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.blue,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendDisabled: { opacity: 0.4 },
  sendGlyph: { color: '#fff', fontSize: 20, fontWeight: '800', lineHeight: 22 },
});
