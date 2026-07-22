import { Ionicons } from '@expo/vector-icons';
import { dayString } from '@sidekick/core';
import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Dimensions, Platform, StyleSheet, Text, TextInput, View } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import Animated, {
  Easing,
  FadeInUp,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { commitOnboardingResult, setSkinColor } from '../src/lib/api';
import { hapticNotif, hapticTap, playRevealHaptics } from '../src/lib/haptics';
import { Pressable } from '../src/components/Pressable';
import { OnboardingIntroChat, type OnboardingResult } from '../src/components/OnboardingIntroChat';
import {
  loadOnboarding,
  markOnboardingComplete,
  ONBOARDING_QUERY_KEY,
  saveOnboardingField,
  saveStep,
} from '../src/lib/onboarding';
import { Glass } from '../src/imessage/components/Glass';
import { OnboardingAuth } from '../src/components/OnboardingAuth';
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

type Phase =
  | 'auth'
  | 'welcome'
  | 'askName'
  | 'gender'
  | 'birthday'
  | 'reveal'
  | 'customize'
  | 'nameSidekick'
  | 'notif'
  | 'chat';

const PHASE_ORDER: Phase[] = [
  'auth',
  'welcome',
  'askName',
  'gender',
  'birthday',
  'reveal',
  'customize',
  'nameSidekick',
  'notif',
  'chat',
];

// Declarative entry state per phase: what the scene must look like when you land
// on a phase COLD (deep link / reload-resume), independent of whatever cinematic
// normally plays on the way in.
const PHASES: Record<Phase, { framing: Framing; characterVisible: boolean }> = {
  auth: { framing: WIDE_FRAMING, characterVisible: false },
  welcome: { framing: WIDE_FRAMING, characterVisible: false },
  askName: { framing: NAME_FRAMING, characterVisible: false },
  gender: { framing: NAME_FRAMING, characterVisible: false },
  birthday: { framing: NAME_FRAMING, characterVisible: false },
  reveal: { framing: HERO_FRAMING, characterVisible: true },
  customize: { framing: HERO_FRAMING, characterVisible: true },
  nameSidekick: { framing: NAMESIDEKICK_FRAMING, characterVisible: true },
  notif: { framing: HERO_FRAMING, characterVisible: true },
  chat: { framing: SLIVER_FRAMING, characterVisible: true },
};

// DEV-only onboarding skip controls — same gate as OnboardingAuth's dev login,
// so they're stripped from production builds.
const SHOW_DEV = process.env.NODE_ENV !== 'production';

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
  // he only glances UP at the notice a beat after it lands (see submitSidekickName),
  // so the look-up is gated on this rather than on the banner's own arrival.
  const [notifLookUp, setNotifLookUp] = useState(false);
  const [chatMounted, setChatMounted] = useState(false);
  // chat sheet slide-up (0 = fully below the screen, 1 = docked). Driven when the
  // chat phase mounts so the sheet rises from the bottom as the camera zooms out.
  const sheetProgress = useSharedValue(0);
  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: (1 - sheetProgress.value) * SHEET_TRAVEL }],
    opacity: sheetProgress.value < 0.01 ? 0 : 1,
  }));

  // one-time hydrate: settings + skin (so the reveal wears the account's skin) +
  // resume state, then land the flow at the resumed phase.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      await hydrateSettings();
      await hydrateSkinFromMirror();
      const st = await loadOnboarding();
      if (cancelled) return;
      const signedOut = useAuthStore.getState().status === 'signedOut';
      // Already finished AND signed in → Home accepts us; go there (never replay).
      // If signed OUT, do NOT bounce — Home would redirect right back here (its gate
      // requires signed-in), an infinite loop. Fall through to run the auth step.
      if (st.complete && !signedOut) {
        router.replace('/');
        return;
      }
      // signed out → auth first (regardless of any saved step); signed in →
      // resume the saved step (never 'auth' — already signed in), else welcome.
      const saved = (PHASE_ORDER as string[]).includes(st.phase) ? (st.phase as Phase) : null;
      const initial: Phase = signedOut ? 'auth' : saved && saved !== 'auth' ? saved : 'welcome';
      initialPhaseRef.current = initial;
      setUserName(st.userName);
      setSidekickName(st.sidekickName);
      setColorId(currentColorId());
      setPhase(initial);
      setFraming(PHASES[initial].framing);
      setNotifIn(initial === 'notif' || initial === 'chat');
      setNotifLookUp(initial === 'notif' || initial === 'chat');
      setChatMounted(initial === 'chat');
      if (initial === 'chat') sheetProgress.value = 1; // resume: sheet already docked
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

  // notif beat: a beat after the notice lands, the sidekick looks up at it (phone
  // still in hand) — and keeps looking up until "open chat" is tapped (which
  // clears it by leaving the notif phase).
  useEffect(() => {
    controllerRef.current?.setLookUp(phase === 'notif' && notifLookUp);
  }, [phase, notifLookUp]);

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
        queryClient.setQueryData(ONBOARDING_QUERY_KEY, st); // sync cache so Home's gate passes
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

  // 2 → gender: just capture the name (the reveal cinematic now fires after birthday).
  const submitUserName = (name: string) => {
    setUserName(name);
    void saveOnboardingField('userName', name);
    goTo('gender');
  };

  // gender → birthday
  const submitGender = (gender: string) => {
    void saveOnboardingField('gender', gender);
    goTo('birthday');
  };

  // birthday → reveal: ease to the hero framing, build suspense, then he jumps in.
  const submitBirthday = (birthday: string) => {
    if (animating) return;
    void saveOnboardingField('birthday', birthday);
    setAnimating(true);
    goTo('reveal');
    controllerRef.current?.shake({ amp: 0.06, duration: 1.4, mode: 'build' });
    playRevealHaptics(); // rumble builds with the shake, hard hit at touchdown
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

  // 5 → 6: the notif beat, choreographed in three: (1) he pulls out his phone
  // (holdingPhone turns on with the 'notif' phase, same pose as opening Messages),
  // (2) ~0.8s later the notification drops in with a firm haptic hit, (3) a beat
  // after that he glances up at it — phone still in hand.
  const submitSidekickName = (name: string) => {
    setSidekickName(name);
    void saveOnboardingField('sidekickName', name);
    goTo('notif'); // phone comes out here (see holdingPhone on the canvas)
    // NOTE: slot for the real push-notification permission prompt.
    setTimeout(() => {
      setNotifIn(true);
      hapticNotif(); // the message lands
    }, 850);
    setTimeout(() => setNotifLookUp(true), 1200); // then he looks up at it
  };

  // 6 → 7: tap the banner → he lifts the phone (holdingPhone) + chat opens.
  const openChat = () => {
    controllerRef.current?.setLookUp(false);
    // gentle, slow camera ease so the zoom-out has room to breathe as the sheet rises
    controllerRef.current?.setCamRate(0.028);
    setChatMounted(true);
    sheetProgress.value = withDelay(180, withTiming(1, { duration: 780, easing: Easing.out(Easing.cubic) }));
    goTo('chat');
  };

  // 7 → done: mark complete so the gate never re-triggers, then home (tearing
  // down our scene first — see goHome). `summary` is what the scripted intro chat
  // collected (reason / improve / action) — TODO: persist it as the first goal.
  const finish = (summary?: OnboardingResult) => {
    void (async () => {
      // One server completion write: profile + onboardingCompletedAt + identity
      // memory, plus the habit goal / talk pref. Never block the user on it — log
      // and continue home if it fails.
      const st = await loadOnboarding();
      try {
        await commitOnboardingResult({
          reason: summary?.reason ?? 'habits',
          profile: {
            name: (st.userName || userName).trim() || 'friend',
            gender: st.gender || undefined,
            birthday: st.birthday || undefined,
            sidekickName: (st.sidekickName || sidekickName).trim() || undefined,
            sidekickColor: (loadSettings().celBodyColor ?? '') || undefined,
          },
          habit: summary?.habit,
          talk: summary?.talk,
        });
      } catch (err) {
        // Do NOT mark complete locally on failure — that would permanently skip
        // onboarding on-device while the server has no profile/goals/memories. Let
        // the user retry (the flow stays put behind the alert).
        console.error('[onboarding] commitOnboardingResult failed', err);
        Alert.alert(
          'almost there',
          "couldn't finish setting up — check your connection and try again.",
          [{ text: 'try again', onPress: () => finish(summary) }],
        );
        return;
      }
      await markOnboardingComplete();
      // Push the completed state into the query cache synchronously so Home's
      // first-run gate sees complete=true immediately. An async invalidate would
      // let Home render the stale (incomplete) state and bounce straight back to
      // /onboarding, which resumes at 'chat' and replays the intro (the loop).
      const fresh = await loadOnboarding();
      queryClient.setQueryData(ONBOARDING_QUERY_KEY, fresh);
      goHome();
    })();
  };

  const sender = sidekickName.trim() || 'Sidekick';

  // DEV: skip the current part using its real advance handler, so camera moves /
  // reveal / notif cinematics still play. Tap repeatedly to step through each part.
  const devAdvance = () => {
    if (animating) return;
    switch (phase) {
      case 'auth':
        goTo('welcome');
        break;
      case 'welcome':
        startNaming();
        break;
      case 'askName':
        submitUserName(userName || 'Dev');
        break;
      case 'gender':
        submitGender('other');
        break;
      case 'birthday':
        submitBirthday('2000-01-01');
        break;
      case 'reveal':
        toCustomize();
        break;
      case 'customize':
        toNameSidekick();
        break;
      case 'nameSidekick':
        submitSidekickName(sidekickName || 'Mochi');
        break;
      case 'notif':
        openChat();
        break;
      case 'chat':
        finish();
        break;
    }
  };

  // DEV: step back one phase. Best-effort — restores the previous screen's beat
  // state (notif banner / chat sheet); the character may stay visible on the
  // pre-reveal steps since we don't replay its park cinematic in reverse.
  const devBack = () => {
    if (animating) return;
    const i = PHASE_ORDER.indexOf(phase);
    if (i <= 0) return;
    const prev = PHASE_ORDER[i - 1];
    if (phase === 'chat') {
      setChatMounted(false);
      sheetProgress.value = 0;
    }
    const atNotif = prev === 'notif';
    setNotifIn(atNotif); // show the banner again only if we're landing back on notif
    setNotifLookUp(atNotif);
    goTo(prev);
  };

  return (
    <View style={styles.root}>
      {/* Locked evening stage — persists across every phase. Character parked
          below the frame until the reveal jump; holds the phone in chat. */}
      {ready ? (
        <SidekickCanvas
          style={StyleSheet.absoluteFillObject}
          framing={framing}
          holdingPhone={phase === 'notif' || phase === 'chat'}
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
            <PrimaryButton label="Let's go" onPress={startNaming} disabled={animating} />
          </View>
        </>
      ) : null}

      {/* 2. What's your name? */}
      {phase === 'askName' && !animating ? (
        <NameEntry
          key="askName"
          title="What's your name?"
          placeholder="Your name"
          cta="continue"
          onSubmit={submitUserName}
        />
      ) : null}

      {/* 2b. Gender */}
      {phase === 'gender' && !animating ? <GenderStep onSubmit={submitGender} /> : null}

      {/* 2c. Birthday */}
      {phase === 'birthday' && !animating ? <BirthdayStep onSubmit={submitBirthday} /> : null}

      {/* 3. Sidekick jumped in — "Hey {name}, meet your sidekick!" */}
      {phase === 'reveal' && !animating ? (
        <>
          <Animated.View
            entering={FadeInUp.duration(500)}
            style={[styles.topCopy, { top: insets.top + 96 }]}
            pointerEvents="none"
          >
            <Text style={styles.h1small}>Hey {userName || 'there'}, meet your sidekick!</Text>
          </Animated.View>
          <View style={[styles.bottomBar, { paddingBottom: insets.bottom + 24 }]}>
            <PrimaryButton label="Continue" onPress={toCustomize} />
          </View>
        </>
      ) : null}

      {/* 4. Customize — pick a color */}
      {phase === 'customize' && !animating ? (
        <>
          <Animated.View
            entering={FadeInUp.duration(500)}
            style={[styles.topCopy, { top: insets.top + 96 }]}
            pointerEvents="none"
          >
            <Text style={styles.h1small}>Customize your sidekick</Text>
            <Text style={styles.sub}>Pick a color</Text>
          </Animated.View>
          <View style={[styles.bottomBar, { paddingBottom: insets.bottom + 24 }]}>
            <View style={styles.swatchRow}>
              {SKIN_COLORS.map((c) => {
                const selected = colorId === c.id;
                return (
                  <Pressable
                    key={c.id}
                    onPress={() => {
                      hapticTap();
                      pickColor(c);
                    }}
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
            <PrimaryButton label="Continue" onPress={toNameSidekick} />
          </View>
        </>
      ) : null}

      {/* 5. What's his name? */}
      {phase === 'nameSidekick' && !animating ? (
        <NameEntry
          key="nameSidekick"
          title="What's your sidekick's name?"
          placeholder="Name your sidekick"
          cta="continue"
          onSubmit={submitSidekickName}
          layout="top"
          suggestions={['Mochi', 'Luna', 'Coco', 'Peaches', 'Boba']}
        />
      ) : null}

      {/* 6. Notification banner (drops down from the top) */}
      {phase === 'notif' ? (
        <>
          <NotificationBanner show={notifIn} sender={sender} topInset={insets.top} onTap={openChat} />
          {/* after the notice drops, a big "open chat" CTA rises from the bottom
              and gently shakes to invite the tap (the Messages icon now lives in
              the notice itself). */}
          {notifIn ? (
            <View style={[styles.notifCta, { paddingBottom: insets.bottom + 22 }]} pointerEvents="box-none">
              <Animated.View entering={FadeInUp.duration(420).delay(650)} style={styles.notifCtaBtn}>
                <ShakeButton label="Open chat" onPress={openChat} />
              </Animated.View>
            </View>
          ) : null}
        </>
      ) : null}

      {/* 7. Chat — the scripted onboarding intro (client-side, WIP copy). Fades in
          in place as the camera dollies out (no slide-from-top), no grabber. */}
      {chatMounted ? (
        <Animated.View style={[styles.chatSheet, sheetStyle]}>
          <View style={styles.chatSheetInner}>
            <OnboardingIntroChat sidekickName={sidekickName} onComplete={finish} />
          </View>
        </Animated.View>
      ) : null}

      {/* DEV-only: skip through onboarding. Stripped in production (SHOW_DEV). */}
      {SHOW_DEV ? (
        <View style={styles.devBar} pointerEvents="box-none">
          <Pressable onPress={devBack} style={styles.devBtn}>
            <Text style={styles.devBtnText}>← back</Text>
          </Pressable>
          <Pressable onPress={devAdvance} style={styles.devBtn}>
            <Text style={styles.devBtnText}>skip: {phase} →</Text>
          </Pressable>
          <Pressable onPress={() => finish()} style={styles.devBtn}>
            <Text style={styles.devBtnText}>⏭ end</Text>
          </Pressable>
        </View>
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
  suggestions,
}: {
  title: string;
  placeholder: string;
  cta: string;
  onSubmit: (value: string) => void;
  layout?: 'center' | 'top';
  // Tappable name suggestions — lowers the cognitive load of inventing a name.
  suggestions?: string[];
}) {
  const insets = useSafeAreaInsets();
  const [value, setValue] = useState('');
  const can = value.trim().length > 0;
  const submit = () => {
    if (can) onSubmit(value.trim());
  };
  const chipRow =
    suggestions && suggestions.length > 0 ? (
      <View style={styles.chipRow}>
        {suggestions.map((s) => (
          <Pressable
            key={s}
            onPress={() => {
              hapticTap();
              setValue(s);
            }}
            style={styles.nameChip}
          >
            <Text style={styles.nameChipText}>{s}</Text>
          </Pressable>
        ))}
      </View>
    ) : null;
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
        <View style={[styles.topCopy, { top: insets.top + 96 }]}>
          <Text style={styles.h1small}>{title}</Text>
        </View>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.nameBottomWrap}
        >
          <View style={[styles.nameCol, { paddingBottom: insets.bottom + 20 }]}>
            {chipRow}
            {field}
            <View style={{ height: 12 }} />
            <PrimaryButton label={cta} onPress={submit} disabled={!can} />
          </View>
        </KeyboardAvoidingView>
      </Animated.View>
    );
  }

  return (
    <Animated.View entering={FadeInUp.duration(450)} style={StyleSheet.absoluteFill}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.centerFill}
      >
        <View style={styles.nameCol}>
          <Text style={styles.h1}>{title}</Text>
          {field}
          <View style={{ height: 12 }} />
          <PrimaryButton label={cta} onPress={submit} disabled={!can} />
        </View>
      </KeyboardAvoidingView>
    </Animated.View>
  );
}

// Gender step — tappable options, auto-advances on tap (low friction, no keyboard).
function GenderStep({ onSubmit }: { onSubmit: (gender: string) => void }) {
  return (
    <Animated.View entering={FadeInUp.duration(450)} style={styles.centerFill}>
      <View style={styles.nameCol}>
        <Text style={styles.h1small}>How would you describe yourself?</Text>
        <View style={{ height: 20 }} />
        {[
          { label: 'Female', value: 'female' },
          { label: 'Male', value: 'male' },
          { label: 'Other', value: 'other' },
        ].map((o) => (
          <Pressable
            key={o.value}
            onPress={() => {
              hapticTap();
              onSubmit(o.value);
            }}
            style={styles.optionCard}
          >
            <Text style={styles.optionText}>{o.label}</Text>
          </Pressable>
        ))}
      </View>
    </Animated.View>
  );
}

// Birthday step. On iOS/Android → the native date-picker spinner (feels native,
// no keyboard, no layout to break). On web (no native picker) → three numeric
// fields. Emits "YYYY-MM-DD". All hooks run unconditionally (Platform is constant),
// then we branch on platform in render.
function BirthdayStep({ onSubmit }: { onSubmit: (birthday: string) => void }) {
  const insets = useSafeAreaInsets();

  // native spinner default: ~20 years ago
  const [date, setDate] = useState<Date>(() => {
    const d = new Date();
    d.setFullYear(d.getFullYear() - 20);
    return d;
  });
  // web fallback fields
  const [month, setMonth] = useState('');
  const [day, setDay] = useState('');
  const [year, setYear] = useState('');

  if (Platform.OS !== 'web') {
    return (
      <Animated.View entering={FadeInUp.duration(450)} style={StyleSheet.absoluteFill} pointerEvents="box-none">
        <View style={[styles.topCopy, { top: insets.top + 96 }]}>
          <Text style={styles.h1small}>When's your birthday?</Text>
        </View>
        <View style={styles.centerFill} pointerEvents="box-none">
          <View style={styles.nameCol}>
            <Glass style={styles.dobPickerGlass}>
              <DateTimePicker
                value={date}
                mode="date"
                display="spinner"
                maximumDate={new Date()}
                onChange={(_: unknown, d?: Date) => {
                  if (d) setDate(d);
                }}
                textColor="#111"
              />
            </Glass>
            <View style={{ height: 16 }} />
            <PrimaryButton label="Continue" onPress={() => onSubmit(dayString(date))} />
          </View>
        </View>
      </Animated.View>
    );
  }

  const can =
    +month >= 1 &&
    +month <= 12 &&
    +day >= 1 &&
    +day <= 31 &&
    /^\d{4}$/.test(year) &&
    +year >= 1900 &&
    +year <= new Date().getFullYear();
  const submitWeb = () => {
    if (can) onSubmit(`${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`);
  };
  return (
    <Animated.View entering={FadeInUp.duration(450)} style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <View style={[styles.topCopy, { top: insets.top + 96 }]}>
        <Text style={styles.h1small}>When's your birthday?</Text>
      </View>
      <View style={[styles.nameBottomWrap, { paddingBottom: insets.bottom + 20 }]}>
        <View style={styles.nameCol}>
          <View style={styles.dobRow}>
            <TextInput
              value={month}
              onChangeText={(t) => setMonth(t.replace(/\D/g, ''))}
              placeholder="MM"
              placeholderTextColor="rgba(17,17,17,0.35)"
              keyboardType="number-pad"
              maxLength={2}
              style={styles.dobField}
            />
            <TextInput
              value={day}
              onChangeText={(t) => setDay(t.replace(/\D/g, ''))}
              placeholder="DD"
              placeholderTextColor="rgba(17,17,17,0.35)"
              keyboardType="number-pad"
              maxLength={2}
              style={styles.dobField}
            />
            <TextInput
              value={year}
              onChangeText={(t) => setYear(t.replace(/\D/g, ''))}
              placeholder="YYYY"
              placeholderTextColor="rgba(17,17,17,0.35)"
              keyboardType="number-pad"
              maxLength={4}
              style={[styles.dobField, styles.dobYear]}
            />
          </View>
          <View style={{ height: 12 }} />
          <PrimaryButton label="Continue" onPress={submitWeb} disabled={!can} />
        </View>
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
        <Pressable
          onPress={() => {
            hapticTap();
            onTap();
          }}
          style={styles.banner}
        >
          <MessagesAppIcon size={46} badge={false} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <View style={styles.bannerHeader}>
              <Text style={styles.bannerSender} numberOfLines={1}>
                {sender}
              </Text>
              <Text style={styles.bannerNow}>now</Text>
            </View>
            <Text style={styles.bannerText} numberOfLines={1}>
              hey let's chat
            </Text>
          </View>
        </Pressable>
      </Animated.View>
    </View>
  );
}

// A stand-in for the iOS Messages app icon (green tile + white speech bubble)
// with a red unread badge — the "you've got a message" cue in the notif beat.
function MessagesAppIcon({ size = 66, badge = true }: { size?: number; badge?: boolean }) {
  return (
    <View style={[styles.appIcon, { width: size, height: size, borderRadius: Math.round(size * 0.24) }]}>
      <Ionicons name="chatbubble" size={Math.round(size * 0.56)} color="#fff" />
      {badge ? (
        <View style={styles.appBadge}>
          <Text style={styles.appBadgeText}>1</Text>
        </View>
      ) : null}
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
  // Static style array (not the `({pressed}) => …` callback form): NativeWind's
  // css-interop drops the function form of `style` on native, which would leave
  // the button with no fill. Track pressed via state instead.
  const [pressed, setPressed] = useState(false);
  return (
    <Pressable
      onPress={() => {
        hapticTap();
        onPress();
      }}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      disabled={disabled}
      style={[
        styles.btn,
        disabled ? styles.btnDisabled : null,
        pressed && !disabled ? styles.btnPressed : null,
      ]}
    >
      <Text style={styles.btnText}>{label}</Text>
    </Pressable>
  );
}

// PrimaryButton with a subtle, repeating attention shake (small side-to-side +
// rotation), pulsing every ~1.4s — used on the notif beat's "open chat" CTA.
function ShakeButton({ label, onPress }: { label: string; onPress: () => void }) {
  const s = useSharedValue(0);
  useEffect(() => {
    s.value = withRepeat(
      withSequence(
        withDelay(900, withTiming(1, { duration: 80 })),
        withTiming(-1, { duration: 80 }),
        withTiming(1, { duration: 80 }),
        withTiming(-1, { duration: 80 }),
        withTiming(0, { duration: 80 }),
      ),
      -1,
    );
  }, [s]);
  const style = useAnimatedStyle(() => ({
    transform: [{ translateX: s.value * 4 }, { rotateZ: `${s.value * 1.6}deg` }],
  }));
  return (
    <Animated.View style={[styles.notifCtaBtn, style]}>
      <PrimaryButton label={label} onPress={onPress} />
    </Animated.View>
  );
}

// Native-only date picker: the module isn't web-safe, so we guard the require so
// it's never executed in the web bundle (birthday falls back to text fields there).
// eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-explicit-any
const DateTimePicker: any =
  Platform.OS === 'web' ? () => null : require('@react-native-community/datetimepicker').default;

const ACCENT = '#4F46F0';
// how far below the screen the chat sheet starts before sliding up
const SHEET_TRAVEL = Dimensions.get('window').height;
// The app's system font (loaded in app/_layout.tsx). Onboarding text was falling
// back to the platform bold; use the rounded family everywhere for consistency.
const FONT = 'Diatype-Rounded';
// iOS won't faux-bold a custom font, so weights are separate families.
const FONT_MEDIUM = 'Diatype-Rounded-Medium'; // 500–600
const FONT_BOLD = 'Diatype-Rounded-Bold'; // 700–800

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#fff', overflow: 'hidden' },
  devBar: { position: 'absolute', left: 12, bottom: 40, flexDirection: 'row', gap: 8, zIndex: 100 },
  devBtn: {
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  devBtnText: { fontFamily: 'monospace', fontSize: 11, fontWeight: '700', color: '#bef264' },
  topCopy: { position: 'absolute', left: 0, right: 0, paddingHorizontal: 32, alignItems: 'center' },
  h1: {
    fontFamily: FONT_BOLD,
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
    fontFamily: FONT_BOLD,
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
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 8,
    marginBottom: 4,
  },
  // Flat white cards/inputs with a hard (zero-blur) grey drop shadow — a raised,
  // solid look. Reused across the onboarding inputs + option cards + chips.
  nameChip: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 999,
    backgroundColor: '#fff',
    shadowColor: '#c4c4c4',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 1,
    shadowRadius: 0,
    elevation: 2,
  },
  nameChipText: { fontFamily: FONT_MEDIUM, fontSize: 15, fontWeight: '600', color: '#111' },
  optionCard: {
    width: '100%',
    paddingVertical: 16,
    borderRadius: 18,
    backgroundColor: '#fff',
    alignItems: 'center',
    marginBottom: 12,
    shadowColor: '#c4c4c4',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 1,
    shadowRadius: 0,
    elevation: 3,
  },
  optionText: { fontFamily: FONT_MEDIUM, fontSize: 17, fontWeight: '600', color: '#111' },
  dobRow: { flexDirection: 'row', gap: 10, marginTop: 24 },
  dobField: {
    flex: 1,
    minWidth: 0, // let flex items shrink (react-native-web won't otherwise → overflow)
    paddingHorizontal: 8,
    paddingTop: 12,
    paddingBottom: 20,
    borderRadius: 18,
    backgroundColor: '#fff',
    fontFamily: FONT_MEDIUM,
    fontSize: 20,
    fontWeight: '500',
    color: '#111',
    textAlign: 'center',
  },
  dobYear: { flex: 1.5 },
  dobPickerCard: {
    marginTop: 24,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.92)',
    overflow: 'hidden',
    paddingVertical: 4,
  },
  // liquid-glass fill for the birthday spinner. NO overflow:'hidden' — clipping a
  // UIGlassEffect view stops the glass from rendering (GlassView clips borderRadius natively).
  dobPickerGlass: { borderRadius: 20, paddingVertical: 6, paddingHorizontal: 8 },
  field: {
    marginTop: 24,
    width: '100%',
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 20,
    borderRadius: 18,
    backgroundColor: '#fff',
    fontFamily: FONT_MEDIUM,
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
  btnText: { fontFamily: FONT_BOLD, color: '#fff', fontSize: 17, fontWeight: '700' },
  bannerWrap: { position: 'absolute', left: 0, right: 0, top: 0, paddingHorizontal: 10, alignItems: 'stretch' },
  banner: {
    width: '100%',
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
  bannerHeader: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 },
  bannerSender: { fontFamily: FONT_BOLD, flex: 1, fontSize: 16, fontWeight: '700', color: '#111' },
  bannerNow: { fontFamily: FONT, fontSize: 12, color: 'rgba(17,17,17,0.4)' },
  bannerText: { fontFamily: FONT, fontSize: 14, lineHeight: 18, color: 'rgba(17,17,17,0.8)' },
  notifCta: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 28, alignItems: 'center' },
  notifCtaBtn: { width: '100%', alignItems: 'center' },
  // size + radius come from MessagesAppIcon (per-instance); only fill/shadow are shared
  appIcon: {
    backgroundColor: '#34C759',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.22,
    shadowRadius: 14,
    elevation: 8,
  },
  appBadge: {
    position: 'absolute',
    top: -6,
    right: -6,
    minWidth: 24,
    height: 24,
    borderRadius: 12,
    paddingHorizontal: 6,
    backgroundColor: '#FF3B30',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#fff',
  },
  appBadgeText: { fontFamily: FONT_BOLD, color: '#fff', fontSize: 13, fontWeight: '800' },
  chatSheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    top: '20%',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -8 },
    shadowOpacity: 0.22,
    shadowRadius: 40,
    elevation: 12,
  },
  // one rounded container: overflow-hidden so the messages clip to the rounded
  // top corners (no white strip / detached corner), shadow lives on the parent.
  chatSheetInner: {
    flex: 1,
    backgroundColor: '#fff',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    overflow: 'hidden',
  },
});
