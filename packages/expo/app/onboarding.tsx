import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Animated, {
  FadeInUp,
  SlideInUp,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { setSkinColor, startOnboardingChat } from '../src/lib/api';
import { GuidedHabitChat } from '../src/components/GuidedHabitChat';
import {
  loadOnboarding,
  markOnboardingComplete,
  refreshOnboarding,
  saveOnboardingField,
  saveStep,
} from '../src/lib/onboarding';
import { OnboardingAuth } from '../src/components/OnboardingAuth';
import { SidekickAvatar } from '../src/components/SidekickAvatar';
import { SidekickCanvas } from '../src/components/SidekickCanvas';
import { useAuthStore } from '../src/lib/auth-store';
import type { Framing, SidekickController } from '../src/three/renderer';
import { hydrateSettings, loadSettings } from '../src/three/settings';
import { applySkin, hydrateSkinFromMirror, saveSkinMirror, SKIN_COLORS, type SkinColor } from '../src/store/skin';

// Onboarding: a locked 3D stage (evening meadow) played as a scripted,
// screen-by-screen flow. The camera eases toward the current `framing`; the
// character's jump-in entrance, camera shakes, and live recolor come through
// the SidekickController. Faithful RN port of the deleted web onboarding.tsx.
//
// 0. auth         — sign in over the empty lawn (OnboardingAuth); skipped if
//                   already signed in. Advances to welcome once signedIn.
// 1. welcome      — wide empty evening lawn, "Ready to meet your sidekick?"
// 2. askName      — camera zooms in, centered "what's your name?" input
// 3. reveal       — camera to hero, sidekick JUMPS in, "Hey {name}, meet your sidekick!"
// 4. customize    — pick the sidekick's color (live recolor)
// 5. nameSidekick — centered "what's his name?" input
// 6. notif        — an iMessage-style banner drops in (push-prompt slot)
// 7. chat         — STUB: sheet slides up, he holds the phone → finish → home

// Establishing shot: pulled back on the empty lawn (character parked below).
const WIDE_FRAMING: Framing = { pos: [0, 1.9, 9.5], target: [0, 0.5, 0], fov: 43 };
// Name step: zoomed in toward where the sidekick will land (still empty).
const NAME_FRAMING: Framing = { pos: [0, 1.2, 7.2], target: [0, 0.5, 0], fov: 39 };
// Hero: full-body, centered (matches home's hero shot).
const HERO_FRAMING: Framing = { pos: [0, 0.66, 4.2], target: [0, 0.56, 0], fov: 41.1 };
// Naming the sidekick: the keyboard rises and the input sits low, so pull the
// camera back and aim down — the mascot shrinks into the upper band and stays
// visible above the input while typing. Tune-by-eye.
const NAMESIDEKICK_FRAMING: Framing = { pos: [0, 1.0, 7.5], target: [0, -0.9, 0], fov: 42 };
// Chat: the sheet covers ~80%, so the camera pulls way back and aims low — the
// whole standing character composes into the top sliver.
const SLIVER_FRAMING: Framing = { pos: [0, 1.6, 13], target: [0, -2.0, 0], fov: 30 };

type Phase = 'auth' | 'welcome' | 'askName' | 'reveal' | 'customize' | 'nameSidekick' | 'notif' | 'chat';

const PHASE_ORDER: Phase[] = ['auth', 'welcome', 'askName', 'reveal', 'customize', 'nameSidekick', 'notif', 'chat'];

// Declarative entry state per phase: what the scene must look like when you land
// on a phase COLD (deep link / reload-resume), independent of whatever cinematic
// normally plays on the way in.
const PHASES: Record<Phase, { framing: Framing; characterVisible: boolean }> = {
  auth: { framing: WIDE_FRAMING, characterVisible: false },
  welcome: { framing: WIDE_FRAMING, characterVisible: false },
  askName: { framing: NAME_FRAMING, characterVisible: false },
  reveal: { framing: HERO_FRAMING, characterVisible: true },
  customize: { framing: HERO_FRAMING, characterVisible: true },
  nameSidekick: { framing: NAMESIDEKICK_FRAMING, characterVisible: true },
  notif: { framing: HERO_FRAMING, characterVisible: true },
  chat: { framing: SLIVER_FRAMING, characterVisible: true },
};

// Force the evening look live (in-memory, never persisted) so onboarding always
// plays at dusk regardless of the real time-of-day — and Home is untouched.
function eveningSettings() {
  return { ...loadSettings(), timeOfDay: 'evening' as const };
}

export default function Onboarding() {
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const controllerRef = useRef<SidekickController | null>(null);
  // drives the phase-0 auth step: signedOut → start at 'auth'; the advance
  // effect below moves to 'welcome' once sign-in flips this to 'signedIn'.
  const authStatus = useAuthStore((s) => s.status);

  // resolved once hydrate + resume complete; the scene mounts only after, so the
  // renderer reads the account skin and the resumed phase's entrance state.
  const [ready, setReady] = useState(false);
  const initialPhaseRef = useRef<Phase>('welcome');

  const [phase, setPhase] = useState<Phase>('welcome');
  const [framing, setFraming] = useState<Framing>(WIDE_FRAMING);
  // Locks CTAs / hides overlays while a camera move / jump cinematic is playing.
  const [animating, setAnimating] = useState(false);
  const [userName, setUserName] = useState('');
  const [sidekickName, setSidekickName] = useState('');
  const [colorId, setColorId] = useState<string>(SKIN_COLORS[0].id);
  const [notifIn, setNotifIn] = useState(false);
  const [chatMounted, setChatMounted] = useState(false);
  // The onboarding conversation id for the guided-habit chat (created lazily when
  // the chat phase mounts, via startOnboardingChat).
  const [chatConvId, setChatConvId] = useState<string | null>(null);

  // one-time hydrate: settings + skin (so the reveal wears the account's skin) +
  // resume state, then land the flow at the resumed phase.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      await hydrateSettings();
      await hydrateSkinFromMirror();
      const st = await loadOnboarding();
      if (cancelled) return;
      // signed out → auth first (regardless of any saved step); signed in →
      // resume the saved step (never 'auth' — already signed in), else welcome.
      const signedOut = useAuthStore.getState().status === 'signedOut';
      const saved = (PHASE_ORDER as string[]).includes(st.phase) ? (st.phase as Phase) : null;
      const initial: Phase = signedOut ? 'auth' : saved && saved !== 'auth' ? saved : 'welcome';
      initialPhaseRef.current = initial;
      setUserName(st.userName);
      setSidekickName(st.sidekickName);
      setColorId(currentColorId());
      setPhase(initial);
      setFraming(PHASES[initial].framing);
      setNotifIn(initial === 'notif' || initial === 'chat');
      setChatMounted(initial === 'chat');
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // force the evening look the moment the scene controller lands
  const onController = useCallback((c: SidekickController | null) => {
    controllerRef.current = c;
    c?.applySettings(eveningSettings());
  }, []);

  // every phase change lands here: persist the resume step + apply its framing.
  const goTo = (next: Phase, opts?: { keepFraming?: boolean }) => {
    setPhase(next);
    if (!opts?.keepFraming) setFraming(PHASES[next].framing);
    void saveStep(next);
  };

  // Leave for Home, but tear down OUR scene first so its GL context is released
  // before Home mounts its own scene. React Navigation mounts the incoming Home
  // screen BEFORE unmounting this one, so without this the two scenes (+ Home's
  // avatars) briefly exceed the browser's WebGL context cap and Home's character
  // — loaded after its synchronous grass/sky — loses the GPU race and never
  // appears (until a reload, which mounts Home's scene alone). setReady(false)
  // unmounts our SidekickCanvas → dispose() → forceContextLoss(); the short delay
  // lets that commit before we navigate.
  const goHome = () => {
    setReady(false);
    setTimeout(() => router.replace('/'), 80);
  };

  // auth phase → advance once signed in. A returning user who already completed
  // onboarding (signed out, then back in) goes straight Home; everyone else
  // starts the flow at welcome. applyAuthResult's queryClient.clear() mid-flow
  // is safe — phase lives in local state; the onboarding-complete query refetches.
  useEffect(() => {
    if (phase !== 'auth' || authStatus !== 'signedIn') return;
    let cancelled = false;
    (async () => {
      const st = await loadOnboarding();
      if (cancelled) return;
      if (st.complete) {
        await refreshOnboarding(queryClient);
        goHome();
      } else {
        goTo('welcome');
      }
    })();
    return () => {
      cancelled = true;
    };
    // goTo/goHome/queryClient are stable enough; re-run only on phase/auth transitions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, authStatus]);

  // 1 → 2: zoom the empty shot in toward where the sidekick will appear.
  const startNaming = () => {
    if (animating) return;
    setAnimating(true);
    setFraming(NAME_FRAMING);
    setTimeout(() => {
      goTo('askName');
      setAnimating(false);
    }, 700);
  };

  // 2 → 3: ease to the hero framing, build suspense, then he jumps into frame.
  const submitUserName = (name: string) => {
    if (animating) return;
    setUserName(name);
    void saveOnboardingField('userName', name);
    setAnimating(true);
    goTo('reveal'); // clears the input now; reveal copy waits for !animating
    controllerRef.current?.shake({ amp: 0.06, duration: 1.4, mode: 'build' });
    setTimeout(() => controllerRef.current?.jumpIn({ duration: 800 }), 1100);
    setTimeout(() => setAnimating(false), 2100);
  };

  // 3 → 4: customize his color (camera stays on the hero framing).
  const toCustomize = () => goTo('customize');
  const pickColor = (c: SkinColor) => {
    setColorId(c.id);
    const next = applySkin(c.id); // persists cel colors into shared settings
    controllerRef.current?.applySettings({ ...next, timeOfDay: 'evening' }); // live recolor
    saveSkinMirror({ body: c.body, shadow: c.shadow });
    // best-effort server sync; onboarding must not block on it
    setSkinColor(c.body, c.shadow).catch(() => {});
  };

  // 4 → 5: name him (hero framing, centered input).
  const toNameSidekick = () => goTo('nameSidekick');

  // 5 → 6: drop the notification banner in.
  const submitSidekickName = (name: string) => {
    setSidekickName(name);
    void saveOnboardingField('sidekickName', name);
    goTo('notif');
    // NOTE: slot for the real push-notification permission prompt.
    setTimeout(() => setNotifIn(true), 300);
  };

  // 6 → 7: tap the banner → he lifts the phone (holdingPhone) + chat opens.
  const openChat = () => {
    setChatMounted(true);
    goTo('chat');
  };

  // 7 → done: mark complete so the gate never re-triggers, then home (tearing
  // down our scene first — see goHome).
  const finish = () => {
    void (async () => {
      await markOnboardingComplete();
      await refreshOnboarding(queryClient);
      goHome();
    })();
  };

  const sender = sidekickName.trim() || 'Sidekick';

  // Create the onboarding conversation once the chat phase mounts (covers both
  // openChat and a cold resume that lands directly on 'chat'). No goal slugs — the
  // guided-habit flow is freeform (server prompt handles pain-point → habit →
  // cadence). Idempotent server-side per user.
  useEffect(() => {
    if (chatMounted && !chatConvId) {
      startOnboardingChat([])
        .then(({ conversationId }) => setChatConvId(conversationId))
        .catch(() => {});
    }
  }, [chatMounted, chatConvId]);

  return (
    <View style={styles.root}>
      {/* Locked evening stage — persists across every phase. Character parked
          below the frame until the reveal jump; holds the phone in chat. */}
      {ready ? (
        <SidekickCanvas
          style={StyleSheet.absoluteFillObject}
          framing={framing}
          holdingPhone={phase === 'chat'}
          entrance={!PHASES[initialPhaseRef.current].characterVisible}
          onController={onController}
        />
      ) : null}

      {/* 0. Auth — sign in over the empty stage. Skipped when already signed in
          (the advance effect moves past it the moment status is signedIn). */}
      {phase === 'auth' ? <OnboardingAuth /> : null}

      {/* 1. Welcome */}
      {phase === 'welcome' && !animating ? (
        <>
          <Animated.View
            entering={FadeInUp.duration(500)}
            style={[styles.topCopy, { top: insets.top + 48 }]}
            pointerEvents="none"
          >
            <Text style={styles.h1}>Welcome!</Text>
            <Text style={styles.sub}>Ready to meet your sidekick?</Text>
          </Animated.View>
          <View style={[styles.bottomBar, { paddingBottom: insets.bottom + 24 }]}>
            <PrimaryButton label="let's go" onPress={startNaming} disabled={animating} />
          </View>
        </>
      ) : null}

      {/* 2. What's your name? */}
      {phase === 'askName' && !animating ? (
        <NameEntry
          key="askName"
          title="what's your name?"
          placeholder="your name"
          cta="continue"
          onSubmit={submitUserName}
        />
      ) : null}

      {/* 3. Sidekick jumped in — "Hey {name}, meet your sidekick!" */}
      {phase === 'reveal' && !animating ? (
        <>
          <Animated.View
            entering={FadeInUp.duration(500)}
            style={[styles.topCopy, { top: insets.top + 24 }]}
            pointerEvents="none"
          >
            <Text style={styles.h1small}>Hey {userName || 'there'}, meet your sidekick!</Text>
          </Animated.View>
          <View style={[styles.bottomBar, { paddingBottom: insets.bottom + 24 }]}>
            <PrimaryButton label="continue" onPress={toCustomize} />
          </View>
        </>
      ) : null}

      {/* 4. Customize — pick a color */}
      {phase === 'customize' && !animating ? (
        <>
          <Animated.View
            entering={FadeInUp.duration(500)}
            style={[styles.topCopy, { top: insets.top + 24 }]}
            pointerEvents="none"
          >
            <Text style={styles.h1small}>Customize your sidekick</Text>
            <Text style={styles.sub}>pick a color</Text>
          </Animated.View>
          <View style={[styles.bottomBar, { paddingBottom: insets.bottom + 24 }]}>
            <View style={styles.swatchRow}>
              {SKIN_COLORS.map((c) => {
                const selected = colorId === c.id;
                return (
                  <Pressable
                    key={c.id}
                    onPress={() => pickColor(c)}
                    accessibilityLabel={c.id}
                    style={[
                      styles.swatch,
                      { backgroundColor: c.body },
                      selected ? styles.swatchSelected : styles.swatchUnselected,
                    ]}
                  />
                );
              })}
            </View>
            <PrimaryButton label="continue" onPress={toNameSidekick} />
          </View>
        </>
      ) : null}

      {/* 5. What's his name? */}
      {phase === 'nameSidekick' && !animating ? (
        <NameEntry
          key="nameSidekick"
          title="what's his name?"
          placeholder="name your sidekick"
          cta="continue"
          onSubmit={submitSidekickName}
          layout="top"
        />
      ) : null}

      {/* 6. Notification banner (drops down from the top) */}
      {phase === 'notif' ? (
        <NotificationBanner show={notifIn} sender={sender} topInset={insets.top} onTap={openChat} />
      ) : null}

      {/* 7. Chat — STUB. For now the sheet slides up with the holding-phone pose
          and a finish CTA.
          TO BUILD — a guided habit chat (shared with the goal screen's "+"):
            1. ask the user's name + age (reconcile with the earlier askName step —
               likely confirm the entered name and just add age).
            2. ask for ONE goal, phrased flexibly ("your goal / one thing you want
               to improve / one habit you want to build") — free-form answer.
            3. generative follow-up that turns the raw answer into something
               actionable on a daily or weekly basis (cadence).
            4. seed that as their FIRST goal → written to the goal screen.
          The goal screen then shows an empty "+" container below the goals that
          opens this SAME guided-habit flow (free-form + generative daily/weekly
          cadence options). Build the flow once; invoke it from both places.
          See the goals-freeform-onboarding-direction memory. */}
      {chatMounted ? (
        <Animated.View entering={SlideInUp.duration(420)} style={styles.chatSheet}>
          <View style={[styles.chatSheetInner, { paddingHorizontal: 0 }]}>
            <View style={styles.grabber} />
            {chatConvId ? (
              <GuidedHabitChat conversationId={chatConvId} onComplete={finish} />
            ) : (
              <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={styles.chatBody}>starting your chat…</Text>
              </View>
            )}
          </View>
        </Animated.View>
      ) : null}
    </View>
  );
}

// The selected skin id from the persisted settings (defaults to the first
// swatch), so a resumed session shows the color the user already picked.
function currentColorId(): string {
  const body = (loadSettings().celBodyColor ?? '').toLowerCase();
  return SKIN_COLORS.find((c) => c.body.toLowerCase() === body)?.id ?? SKIN_COLORS[0].id;
}

// A titled text field with its own CTA. `layout` picks the arrangement:
// - "center": title + input centered on screen (the "what's your name?" step,
//   no sidekick behind it).
// - "top": title pinned to the very top, input in a keyboard-avoiding block at
//   the bottom — so the mascot (framed in the band between them) stays visible
//   while typing and the keyboard doesn't cover the input (the "what's his
//   name?" step).
function NameEntry({
  title,
  placeholder,
  cta,
  onSubmit,
  layout = 'center',
}: {
  title: string;
  placeholder: string;
  cta: string;
  onSubmit: (value: string) => void;
  layout?: 'center' | 'top';
}) {
  const insets = useSafeAreaInsets();
  const [value, setValue] = useState('');
  const can = value.trim().length > 0;
  const submit = () => {
    if (can) onSubmit(value.trim());
  };
  const field = (
    <TextInput
      autoFocus
      value={value}
      onChangeText={setValue}
      onSubmitEditing={submit}
      placeholder={placeholder}
      placeholderTextColor="rgba(17,17,17,0.35)"
      maxLength={24}
      returnKeyType="done"
      style={styles.field}
    />
  );

  if (layout === 'top') {
    return (
      <Animated.View
        entering={FadeInUp.duration(450)}
        style={StyleSheet.absoluteFill}
        pointerEvents="box-none"
      >
        <View style={[styles.topCopy, { top: insets.top + 24 }]}>
          <Text style={styles.h1small}>{title}</Text>
        </View>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.nameBottomWrap}
        >
          <View style={[styles.nameCol, { paddingBottom: insets.bottom + 20 }]}>
            {field}
            <View style={{ height: 12 }} />
            <PrimaryButton label={cta} onPress={submit} disabled={!can} />
          </View>
        </KeyboardAvoidingView>
      </Animated.View>
    );
  }

  return (
    <Animated.View entering={FadeInUp.duration(450)} style={styles.centerFill}>
      <View style={styles.nameCol}>
        <Text style={styles.h1}>{title}</Text>
        {field}
        <View style={{ height: 12 }} />
        <PrimaryButton label={cta} onPress={submit} disabled={!can} />
      </View>
    </Animated.View>
  );
}

// iOS/iMessage-style notification that drops down from the top and persists.
function NotificationBanner({
  show,
  sender,
  topInset,
  onTap,
}: {
  show: boolean;
  sender: string;
  topInset: number;
  onTap: () => void;
}) {
  const t = useSharedValue(0);
  useEffect(() => {
    t.value = withTiming(show ? 1 : 0, { duration: 500 });
  }, [show, t]);
  const style = useAnimatedStyle(() => ({
    opacity: t.value,
    transform: [{ translateY: (1 - t.value) * -160 }],
  }));
  return (
    <View style={[styles.bannerWrap, { paddingTop: topInset + 8 }]} pointerEvents="box-none">
      <Animated.View style={style}>
        <Pressable onPress={onTap} style={styles.banner}>
          <SidekickAvatar size={40} style={styles.bannerAvatar} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <View style={styles.bannerHeader}>
              <Text style={styles.bannerSender} numberOfLines={1}>
                {sender}
              </Text>
              <Text style={styles.bannerNow}>now</Text>
            </View>
            <Text style={styles.bannerText} numberOfLines={2}>
              Your sidekick is trying to send you a message! turn on notifications so you can get it
            </Text>
          </View>
        </Pressable>
      </Animated.View>
    </View>
  );
}

function PrimaryButton({
  label,
  onPress,
  disabled,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.btn,
        disabled ? styles.btnDisabled : null,
        pressed && !disabled ? styles.btnPressed : null,
      ]}
    >
      <Text style={styles.btnText}>{label}</Text>
    </Pressable>
  );
}

const ACCENT = '#4F46F0';
// The app's system font (loaded in app/_layout.tsx). Onboarding text was falling
// back to the platform bold; use the rounded family everywhere for consistency.
const FONT = 'Diatype-Rounded';

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#fff', overflow: 'hidden' },
  topCopy: { position: 'absolute', left: 0, right: 0, paddingHorizontal: 32, alignItems: 'center' },
  h1: {
    fontFamily: FONT,
    fontSize: 44,
    fontWeight: '800',
    letterSpacing: -1.4,
    lineHeight: 46,
    textAlign: 'center',
    color: '#fff',
    textShadowColor: 'rgba(0,0,0,0.4)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 10,
  },
  h1small: {
    fontFamily: FONT,
    fontSize: 34,
    fontWeight: '800',
    letterSpacing: -1.1,
    lineHeight: 36,
    textAlign: 'center',
    color: '#fff',
    textShadowColor: 'rgba(0,0,0,0.4)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 10,
  },
  sub: {
    fontFamily: FONT,
    marginTop: 12,
    fontSize: 19,
    lineHeight: 24,
    textAlign: 'center',
    color: 'rgba(255,255,255,0.88)',
    textShadowColor: 'rgba(0,0,0,0.35)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 8,
  },
  bottomBar: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 28 },
  centerFill: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  nameBottomWrap: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 32, alignItems: 'center' },
  nameCol: { width: '100%', maxWidth: 420, alignItems: 'stretch' },
  field: {
    marginTop: 24,
    width: '100%',
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 20,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.92)',
    fontFamily: FONT,
    fontSize: 17,
    fontWeight: '500',
    color: '#111',
    textAlign: 'center',
  },
  swatchRow: { flexDirection: 'row', justifyContent: 'center', gap: 14, marginBottom: 20 },
  swatch: { width: 44, height: 44, borderRadius: 22 },
  swatchSelected: { borderWidth: 4, borderColor: '#fff' },
  swatchUnselected: { borderWidth: 2, borderColor: 'rgba(255,255,255,0.7)' },
  // Duolingo-style pill with a hard bottom shadow that collapses on press.
  btn: {
    width: '100%',
    maxWidth: 420,
    alignSelf: 'center',
    paddingVertical: 16,
    borderRadius: 999,
    backgroundColor: ACCENT,
    alignItems: 'center',
    shadowColor: '#372FC9',
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 1,
    shadowRadius: 0,
    elevation: 4,
  },
  btnPressed: { transform: [{ translateY: 3 }], shadowOffset: { width: 0, height: 2 } },
  btnDisabled: { opacity: 0.6 },
  btnText: { fontFamily: FONT, color: '#fff', fontSize: 17, fontWeight: '700' },
  bannerWrap: { position: 'absolute', left: 0, right: 0, top: 0, paddingHorizontal: 12, alignItems: 'center' },
  banner: {
    width: '100%',
    maxWidth: 420,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#fff',
    borderRadius: 22,
    paddingHorizontal: 14,
    paddingVertical: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.14,
    shadowRadius: 24,
    elevation: 8,
  },
  bannerAvatar: { width: 40, height: 40, borderRadius: 10 },
  bannerHeader: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 },
  bannerSender: { fontFamily: FONT, flex: 1, fontSize: 14, fontWeight: '600', color: '#111' },
  bannerNow: { fontFamily: FONT, fontSize: 12, color: 'rgba(17,17,17,0.4)' },
  bannerText: { fontFamily: FONT, fontSize: 14, lineHeight: 18, color: 'rgba(17,17,17,0.8)' },
  chatSheet: { position: 'absolute', left: 0, right: 0, bottom: 0, top: '20%' },
  chatSheetInner: {
    flex: 1,
    backgroundColor: '#fff',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 24,
    paddingTop: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -8 },
    shadowOpacity: 0.22,
    shadowRadius: 40,
    elevation: 12,
  },
  grabber: { alignSelf: 'center', width: 40, height: 5, borderRadius: 3, backgroundColor: '#e5e5e5', marginBottom: 20 },
  chatTitle: { fontFamily: FONT, fontSize: 24, fontWeight: '800', color: '#171717', textAlign: 'center' },
  chatBody: { fontFamily: FONT, marginTop: 12, fontSize: 16, lineHeight: 22, color: 'rgba(23,23,23,0.6)', textAlign: 'center' },
});
