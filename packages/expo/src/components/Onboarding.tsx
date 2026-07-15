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

const WIDE_FRAMING: Framing = { pos: [0, 1.9, 9.5], target: [0, 0.5, 0], fov: 43 };
const NAME_FRAMING: Framing = { pos: [0, 1.2, 7.2], target: [0, 0.5, 0], fov: 39 };
const HERO_FRAMING: Framing = { pos: [0, 0.66, 4.2], target: [0, 0.56, 0], fov: 41.1 };
// chat: sheet covers ~80%, so pull way back + aim low — whole body in the sliver
const SLIVER_FRAMING: Framing = { pos: [0, 1.6, 13], target: [0, -2.0, 0], fov: 30 };

type Phase = 'welcome' | 'askName' | 'reveal' | 'customize' | 'nameSidekick' | 'notif' | 'chat';

const PHASE_FRAMING: Record<Phase, Framing> = {
  welcome: WIDE_FRAMING,
  askName: NAME_FRAMING,
  reveal: HERO_FRAMING,
  customize: HERO_FRAMING,
  nameSidekick: HERO_FRAMING,
  notif: HERO_FRAMING,
  chat: SLIVER_FRAMING,
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
        <Text className="text-center text-[40px] font-extrabold tracking-tight text-white" style={{ width: '100%', textAlign: 'center', textShadowColor: 'rgba(0,0,0,0.35)', textShadowRadius: 8, textShadowOffset: { width: 0, height: 2 } }}>
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

export function Onboarding() {
  const insets = useSafeAreaInsets();
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
  const [hidden] = useState(true);
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
    controllerRef.current?.setColors(c.body, c.shadow); // live recolor
    applySkin(c.id); // persist (setColors already updated the running scene)
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
        <>
          <Animated.View
            entering={FadeInUp.duration(500)}
            className="absolute inset-x-0 z-20 items-center px-8"
            style={{ top: insets.top + 60 }}
            pointerEvents="none"
          >
            <Text className="text-center text-[52px] font-extrabold tracking-tight text-white" style={{ width: '100%', textAlign: 'center', textShadowColor: 'rgba(0,0,0,0.4)', textShadowRadius: 10, textShadowOffset: { width: 0, height: 2 } }}>
              Welcome!
            </Text>
            <Text className="mt-3 text-center text-[20px] leading-snug text-white/85" style={{ width: '100%', textAlign: 'center', textShadowColor: 'rgba(0,0,0,0.35)', textShadowRadius: 8, textShadowOffset: { width: 0, height: 2 } }}>
              Ready to meet your sidekick?
            </Text>
          </Animated.View>
          <View className="absolute inset-x-0 z-20 px-7" style={{ bottom: insets.bottom + 24 }}>
            <Cta label="let's go" disabled={animating} onPress={startNaming} />
          </View>
        </>
      ) : null}

      {/* 2. What's your name? */}
      {phase === 'askName' && !animating ? (
        <NameEntry key="askName" title="what's your name?" placeholder="your name" cta="continue" onSubmit={submitUserName} />
      ) : null}

      {/* 3+4. Reveal */}
      {phase === 'reveal' && !animating ? (
        <>
          <Animated.View
            entering={FadeInUp.duration(500)}
            className="absolute inset-x-0 z-20 items-center px-8"
            style={{ top: insets.top + 30 }}
            pointerEvents="none"
          >
            <Text className="text-center text-[38px] font-extrabold tracking-tight text-white" style={{ width: '100%', textAlign: 'center', textShadowColor: 'rgba(0,0,0,0.4)', textShadowRadius: 10, textShadowOffset: { width: 0, height: 2 } }}>
              Hey {userName || 'there'}, meet your sidekick!
            </Text>
          </Animated.View>
          <View className="absolute inset-x-0 z-20 px-7" style={{ bottom: insets.bottom + 24 }}>
            <Cta label="continue" onPress={() => goTo('customize')} />
          </View>
        </>
      ) : null}

      {/* 4b. Customize */}
      {phase === 'customize' && !animating ? (
        <>
          <Animated.View
            entering={FadeInUp.duration(500)}
            className="absolute inset-x-0 z-20 items-center px-8"
            style={{ top: insets.top + 26 }}
            pointerEvents="none"
          >
            <Text className="text-center text-[36px] font-extrabold tracking-tight text-white" style={{ width: '100%', textAlign: 'center', textShadowColor: 'rgba(0,0,0,0.4)', textShadowRadius: 10, textShadowOffset: { width: 0, height: 2 } }}>
              Customize your sidekick
            </Text>
            <Text className="mt-2 text-center text-[17px] text-white/85" style={{ width: '100%', textAlign: 'center', textShadowColor: 'rgba(0,0,0,0.35)', textShadowRadius: 8, textShadowOffset: { width: 0, height: 2 } }}>
              pick a color
            </Text>
          </Animated.View>
          <View className="absolute inset-x-0 z-20 px-7" style={{ bottom: insets.bottom + 24 }}>
            <View className="w-full max-w-md self-center">
              <View className="mb-6 flex-row justify-center gap-3.5">
                {SKIN_COLORS.map((c) => (
                  <Pressable
                    key={c.id}
                    onPress={() => pickColor(c)}
                    className="h-11 w-11 rounded-full"
                    style={{
                      backgroundColor: c.body,
                      borderWidth: color === c.id ? 4 : 2,
                      borderColor: color === c.id ? '#ffffff' : 'rgba(255,255,255,0.7)',
                    }}
                  />
                ))}
              </View>
              <Cta label="continue" onPress={() => goTo('nameSidekick')} />
            </View>
          </View>
        </>
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
