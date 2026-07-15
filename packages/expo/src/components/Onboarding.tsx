import { useEffect, useRef, useState } from 'react';
import { Dimensions, KeyboardAvoidingView, Platform, Pressable, Text, TextInput, View } from 'react-native';
import Animated, { FadeInDown, FadeInUp, SlideInUp } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Chat } from './Chat';
import { SidekickAvatar } from './SidekickAvatar';
import { SidekickCanvas } from './SidekickCanvas';
import { SKIN_COLORS, applySkin } from '../store/skin';
import { useProfile } from '../store/profile';
import { hydrateSettings, loadSettings, type SidekickSettings } from '../three/settings';
import { CHAT_FRAMING, HERO_FRAMING } from '../three/framing';
import type { Framing, SidekickController } from '../three/renderer';

// RN port of the web 3D cinematic onboarding (packages/web/src/onboarding.tsx):
// a locked evening meadow played as a scripted, screen-by-screen flow. The
// camera eases toward the current framing; the character's jump-in entrance,
// camera shake, and live recolor come through the canvas controller.
//
// 1. welcome      — wide empty evening lawn, "Ready to meet your sidekick?"
// 2. askName      — camera zooms in, "what's your name?"
// 3+4. reveal     — camera to hero, sidekick JUMPS in
// 4b. customize   — pick color (live recolor)
// 5. nameSidekick — "what's his name?"
// 6. notif        — iMessage-style banner drops in
// 7. chat         — tap → he holds the phone, chat opens → done

const SCREEN_H = Dimensions.get('window').height;

// white headline/subtitle styling, shared so the 6 overlay texts don't drift.
// width+textAlign force rn-web to center long titles instead of overflowing.
const TITLE_SHADOW = { width: '100%', textAlign: 'center', textShadowColor: 'rgba(0,0,0,0.4)', textShadowRadius: 10, textShadowOffset: { width: 0, height: 2 } } as const;
const SUBTITLE_SHADOW = { width: '100%', textAlign: 'center', textShadowColor: 'rgba(0,0,0,0.35)', textShadowRadius: 8, textShadowOffset: { width: 0, height: 2 } } as const;

const WIDE_FRAMING: Framing = { pos: [0, 1.9, 9.5], target: [0, 0.5, 0], fov: 43 };
const NAME_FRAMING: Framing = { pos: [0, 1.2, 7.2], target: [0, 0.5, 0], fov: 39 };

type Phase = 'welcome' | 'askName' | 'reveal' | 'customize' | 'nameSidekick' | 'notif' | 'chat';

const PHASE_FRAMING: Record<Phase, Framing> = {
  welcome: WIDE_FRAMING,
  askName: NAME_FRAMING,
  reveal: HERO_FRAMING,
  customize: HERO_FRAMING,
  nameSidekick: HERO_FRAMING,
  notif: HERO_FRAMING,
  chat: CHAT_FRAMING,
};

// chunky purple CTA with a hard drop shadow (matches web's BTN)
function Cta({ label, disabled, onPress }: { label: string; disabled?: boolean; onPress: () => void }) {
  return (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      className="w-full max-w-md self-center rounded-full bg-[#4F46F0] py-4"
      style={({ pressed }) => ({
        opacity: disabled ? 0.6 : 1,
        transform: [{ translateY: pressed && !disabled ? 3 : 0 }],
        shadowColor: '#372FC9',
        shadowOffset: { width: 0, height: pressed && !disabled ? 2 : 5 },
        shadowOpacity: 1,
        shadowRadius: 0,
      })}
    >
      <Text className="text-center text-[17px] font-extrabold text-white">{label}</Text>
    </Pressable>
  );
}

// centered titled text field with its own CTA
function NameEntry({
  title,
  placeholder,
  cta,
  onSubmit,
}: {
  title: string;
  placeholder: string;
  cta: string;
  onSubmit: (v: string) => void;
}) {
  const [value, setValue] = useState('');
  const can = value.trim().length > 0;
  return (
    <Animated.View entering={FadeInUp.duration(400)} className="absolute inset-0 z-20">
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        className="flex-1 items-center justify-center px-8"
      >
        <View className="w-full max-w-md">
        <Text className="text-center text-[40px] font-extrabold tracking-tight text-white" style={SUBTITLE_SHADOW}>
          {title}
        </Text>
        <TextInput
          autoFocus
          value={value}
          onChangeText={setValue}
          onSubmitEditing={() => can && onSubmit(value.trim())}
          placeholder={placeholder}
          placeholderTextColor="rgba(17,17,17,0.35)"
          maxLength={24}
          returnKeyType="done"
          className="mt-6 w-full rounded-2xl bg-white/90 px-5 py-4 text-center text-[17px] font-medium text-[#111]"
        />
        <View className="mt-3">
          <Cta label={cta} disabled={!can} onPress={() => can && onSubmit(value.trim())} />
        </View>
        </View>
      </KeyboardAvoidingView>
    </Animated.View>
  );
}

// iMessage-style notification that drops in from the top
function NotificationBanner({ sender, onPress }: { sender: string; onPress: () => void }) {
  const insets = useSafeAreaInsets();
  return (
    <Animated.View
      entering={SlideInUp.duration(500)}
      className="absolute inset-x-0 z-30 px-3"
      style={{ top: insets.top + 8 }}
    >
      <Pressable
        onPress={onPress}
        className="w-full max-w-md flex-row items-center gap-3 self-center rounded-[22px] bg-white px-3.5 py-3"
        style={{ shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.15, shadowRadius: 12 }}
      >
        <SidekickAvatar size={40} style={{ borderRadius: 10 }} />
        <View className="min-w-0 flex-1">
          <View className="flex-row items-baseline justify-between">
            <Text className="text-[14px] font-semibold text-[#111]" numberOfLines={1}>
              {sender}
            </Text>
            <Text className="text-[12px] text-[#111]/40">now</Text>
          </View>
          <Text className="text-[14px] leading-snug text-[#111]/80" numberOfLines={2}>
            Your sidekick is trying to send you a message! turn on notifications so you can get it
          </Text>
        </View>
      </Pressable>
    </Animated.View>
  );
}

// One overlay skeleton for the welcome/reveal/customize phases: a top header
// (title + optional subtitle) and a bottom CTA, with optional content (the
// color row) stacked above the CTA. Replaces three near-identical blocks.
function PhaseOverlay({
  topInset,
  titleSize,
  title,
  subtitle,
  ctaLabel,
  onContinue,
  children,
}: {
  topInset: number;
  titleSize: number;
  title: string;
  subtitle?: string;
  ctaLabel: string;
  onContinue: () => void;
  children?: React.ReactNode;
}) {
  const insets = useSafeAreaInsets();
  return (
    <>
      <Animated.View
        entering={FadeInUp.duration(500)}
        className="absolute inset-x-0 z-20 items-center px-8"
        style={{ top: insets.top + topInset }}
        pointerEvents="none"
      >
        <Text className="text-center font-extrabold tracking-tight text-white" style={{ fontSize: titleSize, ...TITLE_SHADOW }}>
          {title}
        </Text>
        {subtitle ? (
          <Text className="mt-2 text-center text-[18px] leading-snug text-white/85" style={SUBTITLE_SHADOW}>
            {subtitle}
          </Text>
        ) : null}
      </Animated.View>
      <View className="absolute inset-x-0 z-20 px-7" style={{ bottom: insets.bottom + 24 }}>
        <View className="w-full max-w-md self-center">
          {children}
          <Cta label={ctaLabel} onPress={onContinue} />
        </View>
      </View>
    </>
  );
}

export function Onboarding() {
  const controllerRef = useRef<SidekickController | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const later = (fn: () => void, ms: number) => {
    const t = setTimeout(fn, ms);
    timers.current.push(t);
    return t;
  };
  const [settings, setSettings] = useState<SidekickSettings | null>(null);
  useEffect(() => {
    hydrateSettings().then(() => setSettings({ ...loadSettings(), timeOfDay: 'evening' }));
    return () => timers.current.forEach(clearTimeout);
  }, []);

  const setUserNameStore = useProfile((s) => s.setUserName);
  const setSidekickNameStore = useProfile((s) => s.setSidekickName);
  const setOnboarded = useProfile((s) => s.setOnboarded);

  const [phase, setPhase] = useState<Phase>('welcome');
  const [animating, setAnimating] = useState(false);
  const [userName, setUserName] = useState('');
  const [sidekickName, setSidekickName] = useState('');
  const [color, setColor] = useState(SKIN_COLORS[0].id);
  // static: park the character below-frame until the reveal jump (matches web)
  const hidden = true;
  const [framing, setFraming] = useState<Framing>(WIDE_FRAMING);
  const [chatMounted, setChatMounted] = useState(false);

  const goTo = (next: Phase) => {
    setPhase(next);
    setFraming(PHASE_FRAMING[next]);
  };

  // 1 → 2
  const startNaming = () => {
    if (animating) return;
    setAnimating(true);
    setFraming(NAME_FRAMING);
    later(() => {
      goTo('askName');
      setAnimating(false);
    }, 700);
  };

  // 2 → 3+4: ease to hero, build suspense, then he jumps in
  const submitUserName = (name: string) => {
    if (animating) return;
    setUserName(name);
    setUserNameStore(name);
    setAnimating(true);
    goTo('reveal');
    controllerRef.current?.shake({ amp: 0.14, duration: 1.4, mode: 'build' });
    later(() => controllerRef.current?.jumpIn({ duration: 950 }), 1100);
    later(() => setAnimating(false), 2100);
  };

  // 4 → 4b
  const pickColor = (c: (typeof SKIN_COLORS)[number]) => {
    setColor(c.id);
    // same live-recolor path as the Appearance sheet: persist, push to the scene
    controllerRef.current?.applySettings(applySkin(c.id));
  };

  // 5 → 6
  const submitSidekickName = (name: string) => {
    setSidekickName(name);
    setSidekickNameStore(name);
    goTo('notif');
  };

  // 6 → 7
  const openChat = () => {
    setChatMounted(true);
    goTo('chat');
  };

  const finish = () => {
    setOnboarded(true); // the app gate re-renders to home
  };

  const sender = sidekickName.trim() || 'Sidekick';

  return (
    <View className="flex-1 overflow-hidden bg-white">
      {/* locked evening stage — persists across every phase */}
      {settings ? (
        <SidekickCanvas
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
          framing={framing}
          hidden={hidden}
          disableInput
          holdingPhone={phase === 'chat'}
          onController={(c) => {
            controllerRef.current = c;
            // land the scene in evening + parked as soon as it exists
            if (c) c.applySettings({ ...loadSettings(), timeOfDay: 'evening' });
          }}
        />
      ) : null}

      {/* 1. Welcome */}
      {phase === 'welcome' && !animating ? (
        <PhaseOverlay topInset={60} titleSize={52} title="Welcome!" subtitle="Ready to meet your sidekick?" ctaLabel="let's go" onContinue={startNaming} />
      ) : null}

      {/* 2. What's your name? */}
      {phase === 'askName' && !animating ? (
        <NameEntry key="askName" title="what's your name?" placeholder="your name" cta="continue" onSubmit={submitUserName} />
      ) : null}

      {/* 3+4. Reveal */}
      {phase === 'reveal' && !animating ? (
        <PhaseOverlay topInset={30} titleSize={38} title={`Hey ${userName || 'there'}, meet your sidekick!`} ctaLabel="continue" onContinue={() => goTo('customize')} />
      ) : null}

      {/* 4b. Customize */}
      {phase === 'customize' && !animating ? (
        <PhaseOverlay topInset={26} titleSize={36} title="Customize your sidekick" subtitle="pick a color" ctaLabel="continue" onContinue={() => goTo('nameSidekick')}>
          <View className="mb-6 flex-row justify-center gap-3.5">
            {SKIN_COLORS.map((c) => (
              <Pressable
                key={c.id}
                onPress={() => pickColor(c)}
                className="h-11 w-11 rounded-full"
                style={{ backgroundColor: c.body, borderWidth: color === c.id ? 4 : 2, borderColor: color === c.id ? '#ffffff' : 'rgba(255,255,255,0.7)' }}
              />
            ))}
          </View>
        </PhaseOverlay>
      ) : null}

      {/* 5. What's his name? */}
      {phase === 'nameSidekick' && !animating ? (
        <NameEntry key="nameSidekick" title="what's his name?" placeholder="name your sidekick" cta="continue" onSubmit={submitSidekickName} />
      ) : null}

      {/* 6. Notification banner */}
      {phase === 'notif' ? <NotificationBanner sender={sender} onPress={openChat} /> : null}

      {/* 7. Chat — sliver layout; a done button finishes onboarding */}
      {chatMounted ? (
        <Animated.View
          entering={FadeInDown.duration(300)}
          className="absolute inset-x-0 bottom-0 z-40 overflow-hidden rounded-t-[28px] bg-white"
          style={{ height: SCREEN_H * 0.8, shadowColor: '#000', shadowOffset: { width: 0, height: -8 }, shadowOpacity: 0.22, shadowRadius: 40 }}
        >
          <Chat transparentTop />
          <Pressable
            onPress={finish}
            className="absolute z-20 h-9 items-center justify-center rounded-full bg-[#4F46F0] px-4"
            style={{ top: 12, right: 12 }}
          >
            <Text className="text-[14px] font-bold text-white">done →</Text>
          </Pressable>
        </Animated.View>
      ) : null}
    </View>
  );
}
