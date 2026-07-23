import { Ionicons } from '@expo/vector-icons';
import { dayString } from '@sidekick/core';
import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useMemo, useState } from 'react';
import { Alert, Dimensions, Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import Animated, {
  Easing,
  FadeInUp,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { commitOnboardingResult, setSkinColor } from '../src/lib/api';
import { hapticNotif, hapticTap, playBuildToBoom } from '../src/lib/haptics';
import { devArmHomeIntro } from '../src/lib/onboarding';
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
import { OverheadSpeech } from '../src/components/OverheadSpeech';
import { SpeechBubble } from '../src/components/SpeechBubble';
import { speak } from '../src/store/speech';
import { streamDurationMs, StreamedText } from '../src/components/chat-stream';
import Svg, { Path } from 'react-native-svg';
import { FAUX_KB_HEIGHT, FAUX_KB_VISIBLE, FauxKeyboard } from '../src/components/FauxKeyboard';

// bottom inset for a keyboard-input step: real keyboards are handled by
// KeyboardAvoidingView; the dev-web faux deck needs its space reserved manually
const kbBottomInset = (insetBottom: number) => (FAUX_KB_VISIBLE ? FAUX_KB_HEIGHT : insetBottom) + 20;
import { SidekickCanvas } from '../src/components/SidekickCanvas';
import { useAuthStore } from '../src/lib/auth-store';
import { PHONE_BODY_YAW, type Framing, type SidekickController } from '../src/three/renderer';
import { hydrateSettings, loadSettings } from '../src/three/settings';
import { applySkin, hydrateSkinFromMirror, saveSkinMirror, SKIN_COLORS, type SkinColor } from '../src/store/skin';

// Onboarding: a locked 3D stage (evening meadow) played as a scripted,
// screen-by-screen flow. The camera eases toward the current `framing`; the
// character's jump-in entrance, camera shakes, and live recolor come through
// the SidekickController. Faithful RN port of the deleted web onboarding.tsx.
//
//  0. auth      — sign in, camera up at the evening sky; skipped if signed in
//  1. hey       — shaking "Hey!" dead-centre over the sky, "Get Started"
//  2. birthday  — "before we get started, what's your birthday?" (in the sky)
//  … (customize / celebrate / nameSidekick as below)
//  4. lookDown  — streamed "your head is in the clouds… look down here!" + CTA
//  5. hereLeft  — camera panned down-then-LEFT; "I'M OVER HERE!" on the right
//  6. hereRight — camera whips RIGHT; "NO OVER HERE!" on the left
//  7. meetTitle — camera trembles + haptics grow to a boom (no text card)
//  8. reveal    — he JUMPS in, bubble: "THERE YOU ARE!"
//  9. customize — bubble "hm, how should i look?" + color swatches
// 10. celebrate — hands-up hops in the shiny new color
// 11. textIntro — bubble "let me text u so we can talk!"
// 12. notif     — he studies his phone, an iMessage-style banner drops in
// 13. chat      — sheet slides up, he holds the phone → finish → Home's intro

// Auth/welcome: pointed UP at the evening sky — cloud band composed across the
// frame, horizon out of shot. Tune-by-eye.
const SKY_FRAMING: Framing = { pos: [0, 1.4, 8], target: [0, 8.5, -10], fov: 48 };
// Name/birthday: same sky, a subtle push-in so the steps feel like progress.
const SKY_NAME_FRAMING: Framing = { pos: [0, 1.5, 7.4], target: [0, 8.2, -9], fov: 44 };
// Post pan-down: zoomed in toward where the sidekick will land (still empty).
const NAME_FRAMING: Framing = { pos: [0, 1.2, 7.2], target: [0, 0.5, 0], fov: 39 };
// The over-here gag: the camera looks the WRONG way twice — hard pans left then
// right across the empty meadow. Tune-by-eye.
const LOOK_LEFT_FRAMING: Framing = { pos: [0, 1.2, 7.2], target: [-4.5, 0.7, -1], fov: 42 };
const LOOK_RIGHT_FRAMING: Framing = { pos: [0, 1.2, 7.2], target: [4.5, 0.7, -1], fov: 42 };
// Hero: full-body, centered (matches home's hero shot).
const HERO_FRAMING: Framing = { pos: [0, 0.66, 4.2], target: [0, 0.56, 0], fov: 41.1 };
// Naming the sidekick: the keyboard rises and the input sits low, so pull the
// camera back and aim down — the mascot shrinks into the upper band and stays
// visible above the input while typing. Tune-by-eye.
const NAMESIDEKICK_FRAMING: Framing = { pos: [0, 1.15, 7.5], target: [0, -0.2, 0], fov: 42 };
// after he's named, the camera pushes IN a bit for "now what's YOUR name?"
const ASKNAME_FRAMING: Framing = { pos: [0, 1.05, 6.5], target: [0, -0.05, 0], fov: 40 };
// Notif beat: the phone pose yaws his body (part of the authored hold armature
// — see renderer's PHONE_POSE). Rather than un-yaw HIM (which wrecks the
// hands), the camera orbits onto his facing, so he reads dead-straight at the
// lens, head down at the phone. DERIVED from the exported yaw + the hero
// distance, so retuning either can't silently desync this shot.
const NOTIF_FRAMING: Framing = {
  pos: [4.2 * Math.sin(PHONE_BODY_YAW), 0.66, 4.2 * Math.cos(PHONE_BODY_YAW)],
  target: [0, 0.56, 0],
  fov: 41.1,
};
// Chat: the sheet covers ~80%, so the camera pulls way back and aims low — the
// whole standing character composes into the top sliver.
const SLIVER_FRAMING: Framing = { pos: [0, 1.6, 13], target: [0, -2.0, 0], fov: 30 };

type Phase =
  | 'auth'
  | 'hey'
  | 'askName'
  | 'birthday'
  | 'lookDown'
  | 'hereLeft'
  | 'hereRight'
  | 'meetTitle'
  | 'reveal'
  | 'customize'
  | 'celebrate'
  | 'nameSidekick'
  | 'textIntro'
  | 'notif'
  | 'chat';

const PHASE_ORDER: Phase[] = [
  'auth',
  'hey',
  'birthday',
  'lookDown',
  'hereLeft',
  'hereRight',
  'meetTitle',
  'reveal',
  'customize',
  'celebrate',
  'nameSidekick',
  'askName',
  'textIntro',
  'notif',
  'chat',
];

// Declarative entry state per phase: what the scene must look like when you land
// on a phase COLD (deep link / reload-resume), independent of whatever cinematic
// normally plays on the way in.
const PHASES: Record<Phase, { framing: Framing; characterVisible: boolean }> = {
  auth: { framing: SKY_FRAMING, characterVisible: false },
  hey: { framing: SKY_FRAMING, characterVisible: false },
  birthday: { framing: SKY_NAME_FRAMING, characterVisible: false },
  lookDown: { framing: SKY_NAME_FRAMING, characterVisible: false },
  hereLeft: { framing: LOOK_LEFT_FRAMING, characterVisible: false },
  hereRight: { framing: LOOK_RIGHT_FRAMING, characterVisible: false },
  meetTitle: { framing: HERO_FRAMING, characterVisible: false },
  reveal: { framing: HERO_FRAMING, characterVisible: true },
  customize: { framing: HERO_FRAMING, characterVisible: true },
  celebrate: { framing: HERO_FRAMING, characterVisible: true },
  nameSidekick: { framing: NAMESIDEKICK_FRAMING, characterVisible: true },
  askName: { framing: ASKNAME_FRAMING, characterVisible: true },
  textIntro: { framing: HERO_FRAMING, characterVisible: true },
  notif: { framing: NOTIF_FRAMING, characterVisible: true },
  chat: { framing: SLIVER_FRAMING, characterVisible: true },
};

// DEV-only onboarding skip controls — same gate as OnboardingAuth's dev login,
// so they're stripped from production builds.
const SHOW_DEV = process.env.NODE_ENV !== 'production';

// Sidekick name ideas — the entry UI renders them as a horizontally scrolling
// chip rail (a wrap row would eat the whole screen).
const SIDEKICK_NAME_IDEAS = [
  'lulu', 'pebble', 'sprout', 'gloop', 'wisp', 'arnold',
  'gummy', 'sage', 'linda', 'wiggle', 'glitch', 'obama',
];

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
  // effect below moves to 'hey' once sign-in flips this to 'signedIn'.
  const authStatus = useAuthStore((s) => s.status);

  // resolved once hydrate + resume complete; the scene mounts only after, so the
  // renderer reads the account skin and the resumed phase's entrance state.
  const [ready, setReady] = useState(false);
  const initialPhaseRef = useRef<Phase>('hey');

  const [phase, setPhase] = useState<Phase>('hey');
  const [framing, setFraming] = useState<Framing>(SKY_FRAMING);
  // head-tracked overlay target for the speech bubbles (canvas writes per frame)
  const overheadX = useSharedValue(0);
  const overheadY = useSharedValue(0);
  const overheadVisible = useSharedValue(0);
  const overhead = useMemo(
    () => ({ x: overheadX, y: overheadY, visible: overheadVisible }),
    [overheadX, overheadY, overheadVisible],
  );
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
      // resume the saved step (never 'auth' — already signed in), else hey.
      const saved = (PHASE_ORDER as string[]).includes(st.phase) ? (st.phase as Phase) : null;
      const initial: Phase = signedOut ? 'auth' : saved && saved !== 'auth' ? saved : 'hey';
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
  // starts the flow at hey. applyAuthResult's queryClient.clear() mid-flow
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
        goTo('hey');
      }
    })();
    return () => {
      cancelled = true;
    };
    // goTo/goHome/queryClient are stable enough; re-run only on phase/auth transitions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, authStatus]);


  // name captured LAST (after the sidekick names himself) → the text segue.
  const submitUserName = (name: string) => {
    setUserName(name);
    void saveOnboardingField('userName', name);
    goTo('textIntro');
    speak('let me text u so we can talk!', 2400, 'happy');
    setTimeout(() => notifBeat(), 2600);
  };

  // birthday → lookDown: still in the sky — the pan waits for the CTA.
  const submitBirthday = (birthday: string) => {
    if (animating) return;
    void saveOnboardingField('birthday', birthday);
    goTo('lookDown');
  };

  // lookDown CTA → the two-beat sweep: PAN DOWN to the ground, then whip LEFT
  // into the first over-here gag. UI hides while the camera travels.
  const lookDown = () => {
    if (animating) return;
    setAnimating(true);
    setFraming(NAME_FRAMING); // down…
    setTimeout(() => goTo('hereLeft'), 1700); // …sit a beat… then left
    setTimeout(() => setAnimating(false), 2400);
  };

  // hereLeft → hereRight: whip pan the other way.
  const overHere = () => {
    if (animating) return;
    setAnimating(true);
    goTo('hereRight');
    setTimeout(() => setAnimating(false), 700);
  };

  // hereRight → meetTitle → reveal: settle centre, camera trembles + haptics
  // rumble under the title, then he JUMPS in with a bubble.
  const startMeet = () => {
    if (animating) return;
    goTo('meetTitle'); // camera settles to the middle (HERO framing)
    // BURSTY anticipation: a shake burst, a beat, a bigger burst, a beat —
    // each burst stronger — with a haptic hit per burst. Then the pop: a
    // massive shake + jumpIn stomp.
    const bursts = [
      { at: 200, amp: 0.03 },
      { at: 850, amp: 0.05 },
      { at: 1550, amp: 0.08 },
      { at: 2300, amp: 0.12 },
    ];
    for (const b of bursts) {
      setTimeout(() => {
        controllerRef.current?.shake({ amp: b.amp, duration: 0.4, mode: 'impact' });
        hapticNotif(); // a firm hit per burst
      }, b.at);
    }
    const POP = 3100; // after the last anticipation burst
    playBuildToBoom(POP, POP);
    setTimeout(() => {
      setAnimating(true);
      goTo('reveal');
      controllerRef.current?.shake({ amp: 0.24, duration: 0.6, mode: 'impact' }); // massive
      controllerRef.current?.jumpIn({ duration: 800 }); // he pops out + stomps
    }, POP);
    setTimeout(() => {
      setAnimating(false);
      speak('THERE YOU ARE!', 3200, 'excited');
    }, POP + 1000);
  };

  // reveal → customize: he wonders about his look (bubble), swatches below.
  const toCustomize = () => {
    goTo('customize');
    controllerRef.current?.setInspect(true); // head down, sweeping his own body
    setTimeout(() => speak('hm, how should i look?', 4200, 'surprised'), 400);
  };
  const pickColor = (c: SkinColor) => {
    setColorId(c.id);
    const next = applySkin(c.id); // persists cel colors into shared settings
    controllerRef.current?.applySettings({ ...next, timeOfDay: 'evening' }); // live recolor
    saveSkinMirror({ body: c.body, shadow: c.shadow });
    // best-effort server sync; onboarding must not block on it
    setSkinColor(c.body, c.shadow).catch(() => {});
  };

  // customize → celebrate → textIntro: two hands-up hops in the new color,
  // then the segue line before the phone comes out.
  const celebrate = () => {
    controllerRef.current?.setInspect(false);
    goTo('celebrate');
    controllerRef.current?.hop(750); // ONE triumphant hop in the new color
    setTimeout(() => goTo('nameSidekick'), 1500);
  };

  // sidekick named → now ask the USER's name.
  const submitSidekickName = (name: string) => {
    setSidekickName(name);
    void saveOnboardingField('sidekickName', name);
    goTo('askName');
  };

  // textIntro → notif, choreographed in three: (1) he pulls out his phone
  // (holdingPhone turns on with the 'notif' phase, same pose as opening
  // Messages), (2) ~2.2s later the notification drops in with a firm haptic
  // hit, (3) a beat after that he glances up at it — phone still in hand.
  const notifBeat = () => {
    goTo('notif'); // phone comes out here (see holdingPhone on the canvas)
    // NOTE: slot for the real push-notification permission prompt.
    setTimeout(() => {
      setNotifIn(true);
      hapticNotif(); // the message lands
    }, 2200);
    setTimeout(() => setNotifLookUp(true), 2600); // then he looks up at it
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
        goTo('hey');
        break;
      case 'hey':
        goTo('birthday');
        break;
      case 'birthday':
        submitBirthday('2000-01-01');
        break;
      case 'lookDown':
        lookDown();
        break;
      case 'hereLeft':
        overHere();
        break;
      case 'hereRight':
        startMeet();
        break;
      case 'meetTitle':
        break; // auto-advances into reveal
      case 'reveal':
        toCustomize();
        break;
      case 'customize':
        celebrate();
        break;
      case 'celebrate':
      case 'textIntro':
        break; // auto-advance
      case 'nameSidekick':
        submitSidekickName(sidekickName || 'Mochi');
        break;
      case 'askName':
        submitUserName(userName || 'Dev');
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
          overhead={overhead}
          overheadActive={PHASES[phase].characterVisible && phase !== 'chat'}
        />
      ) : null}

      {/* head-tracked speech bubble (THERE YOU ARE! / how should i look? /
          let me text u) — same overlay Home uses */}
      <OverheadSpeech overhead={overhead} hidden={!PHASES[phase].characterVisible || phase === 'chat'}>
        <SpeechBubble />
      </OverheadSpeech>

      {/* 0. Auth — sign in over the empty stage. Skipped when already signed in
          (the advance effect moves past it the moment status is signedIn). */}
      {phase === 'auth' ? <OnboardingAuth /> : null}

      {/* 1. Hey! — dead-centre, shaking, over the sky */}
      {phase === 'hey' && !animating ? (
        <>
          <View style={styles.centerCopy} pointerEvents="none">
            <HeyTitle />
          </View>
          <View style={[styles.bottomBar, { paddingBottom: insets.bottom + 24 }]}>
            <PrimaryButton label="Get Started" onPress={() => goTo('birthday')} disabled={animating} />
          </View>
        </>
      ) : null}

      {/* now YOUR name — after he's named himself, character standing above */}
      {phase === 'askName' && !animating ? (
        <NameEntry
          key="askName"
          title="now what's YOUR name?"
          header={<Text style={styles.h1small}>now what's <Text style={styles.emph}>YOUR</Text> name?</Text>}
          placeholder="Your name"
          cta="continue"
          onSubmit={submitUserName}
          layout="top"
        />
      ) : null}

      {/* DEV (web): dummy keyboard under every keyboard-input step, so layouts
          are judged with the space the real keyboard will take on device */}
      {(phase === 'askName' || phase === 'birthday' || phase === 'nameSidekick') && !animating ? (
        <FauxKeyboard />
      ) : null}

      {/* 2b. Birthday */}
      {phase === 'birthday' && !animating ? (
        <BirthdayStep title="before we get started, what's your birthday?" onSubmit={submitBirthday} />
      ) : null}

      {/* 4. lookDown — still in the sky */}
      {phase === 'lookDown' && !animating ? (
        <>
          <LookDownCopy topInset={insets.top} />
          <View style={[styles.bottomBar, { paddingBottom: insets.bottom + 24 }]}>
            <PrimaryButton label="look down" onPress={lookDown} />
          </View>
        </>
      ) : null}

      {/* 5/6. the over-here gag — full-screen tap advances */}
      {phase === 'hereLeft' && !animating ? (
        <Pressable style={StyleSheet.absoluteFill} onPress={overHere}>
          <Animated.View entering={FadeInUp.duration(350)} style={[styles.sideCopy, styles.sideRight]} pointerEvents="none">
            <SubtleShake intensity={2.2} speed={1.5}>
              <Text style={styles.overHere}>i'm over here</Text>
            </SubtleShake>
          </Animated.View>
          {/* a curved lead-in from the right edge, pointing at the copy */}
          <Animated.View entering={FadeInUp.duration(350)} style={styles.edgePointerRight} pointerEvents="none">
            <Svg width={120} height={90} viewBox="0 0 120 90">
              <Path d="M118 12 Q 40 12 22 62" stroke="#fff" strokeWidth={5} strokeLinecap="round" fill="none" opacity={0.9} />
              <Path d="M22 62 l 16 -6 M22 62 l 5 -16" stroke="#fff" strokeWidth={5} strokeLinecap="round" fill="none" opacity={0.9} />
            </Svg>
          </Animated.View>
          <Text style={[styles.tapHint, { bottom: insets.bottom + 28 }]}>tap to continue</Text>
        </Pressable>
      ) : null}
      {phase === 'hereRight' && !animating ? (
        <Pressable style={StyleSheet.absoluteFill} onPress={startMeet}>
          {/* the camera lands first; the line pops a beat later */}
          <Animated.View entering={FadeInUp.duration(350).delay(550)} style={[styles.sideCopy, styles.sideLeft]} pointerEvents="none">
            <SubtleShake intensity={2.2} speed={1.5}>
              <Text style={styles.overHere}>no, over here</Text>
            </SubtleShake>
          </Animated.View>
          {/* mirrored curve from the left edge */}
          <Animated.View entering={FadeInUp.duration(350).delay(550)} style={styles.edgePointerLeft} pointerEvents="none">
            <Svg width={120} height={90} viewBox="0 0 120 90">
              <Path d="M2 12 Q 80 12 98 62" stroke="#fff" strokeWidth={5} strokeLinecap="round" fill="none" opacity={0.9} />
              <Path d="M98 62 l -16 -6 M98 62 l -5 -16" stroke="#fff" strokeWidth={5} strokeLinecap="round" fill="none" opacity={0.9} />
            </Svg>
          </Animated.View>
          <Text style={[styles.tapHint, { bottom: insets.bottom + 28 }]}>tap to continue</Text>
        </Pressable>
      ) : null}

      {/* 10b. name him — he stands above the input in his new color */}
      {phase === 'nameSidekick' && !animating ? (
        <NameEntry
          key="nameSidekick"
          title="what's my name?"
          header={<Text style={styles.h1small}>what's my name?</Text>}
          placeholder="Name your sidekick"
          cta="continue"
          onSubmit={submitSidekickName}
          layout="top"
          suggestions={SIDEKICK_NAME_IDEAS}
        />
      ) : null}

      {/* 7/8. the build-up: NO title card — just the camera trembling harder and
          harder while the haptics grow to the boom (see startMeet). The empty
          meadow shakes; then he pops out. */}

      {/* 3. Sidekick jumped in — "Hey {name}, meet your sidekick!" */}
      {phase === 'reveal' && !animating ? (
        <View style={[styles.bottomBar, { paddingBottom: insets.bottom + 24 }]}>
          <PrimaryButton label="Continue" onPress={toCustomize} />
        </View>
      ) : null}

      {/* 4. Customize — pick a color */}
      {phase === 'customize' && !animating ? (
        <>
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
            <PrimaryButton label="Continue" onPress={celebrate} />
          </View>
        </>
      ) : null}

      {/* 6. Notification banner (drops down from the top) */}
      {phase === 'notif' ? (
        <>
          <NotificationBanner show={notifIn} sender={sender} message={`hey ${userName || 'there'}, check your msgs so we can text!`} topInset={insets.top} onTap={openChat} />
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
          <Pressable
            onPress={() => {
              void (async () => {
                await devArmHomeIntro();
                const st = await loadOnboarding();
                queryClient.setQueryData(ONBOARDING_QUERY_KEY, st);
                goHome();
              })();
            }}
            style={styles.devBtn}
          >
            <Text style={styles.devBtnText}>✦ home intro</Text>
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
// (Sits above NameEntry only for proximity to its use sites — unrelated to
// the input component below.)
// A barely-there idle wiggle for a CTA that wants to be pressed — ±1.2° of
// rotation with a touch of sway, slow loop, never big enough to read as broken.
function SubtleShake({
  children,
  intensity = 1,
  speed = 1,
}: {
  children: React.ReactNode;
  // multipliers over the base ±1.2° / 1px sway — the "Hey!" and over-here
  // titles crank these
  intensity?: number;
  speed?: number;
}) {
  const t = useSharedValue(0);
  useEffect(() => {
    t.value = withRepeat(
      withTiming(1, { duration: 1400 / speed, easing: Easing.inOut(Easing.quad) }),
      -1,
      true,
    );
  }, [t, speed]);
  const style = useAnimatedStyle(() => ({
    transform: [
      { rotate: `${Math.sin(t.value * Math.PI * 2) * 1.2 * intensity}deg` },
      { translateX: Math.sin(t.value * Math.PI * 4) * intensity },
    ],
  }));
  return <Animated.View style={style}>{children}</Animated.View>;
}

// "Hey!" springs in from small, shakes hard, and carries a little curved
// underline — a swoosh hinting the voice is coming from somewhere below.
function HeyTitle() {
  const sc = useSharedValue(0.3);
  useEffect(() => {
    sc.value = withSpring(1, { damping: 9, stiffness: 150, mass: 0.7 });
  }, [sc]);
  const style = useAnimatedStyle(() => ({ transform: [{ scale: sc.value }] }));
  return (
    <Animated.View style={[style, { alignItems: 'center' }]}>
      <SubtleShake intensity={2.6} speed={1.7}>
        <Text style={styles.h1Hero}>Hey!</Text>
      </SubtleShake>
      {/* a quarter-circle pointer: starts flat under the word, bends 90° and
          ends aiming straight down — "the voice came from down there" */}
      <Svg width={104} height={84} viewBox="0 0 104 84" style={{ marginTop: 10, marginLeft: 44, transform: [{ rotate: '180deg' }] }}>
        <Path d="M14 10 Q 88 10 88 78" stroke="#fff" strokeWidth={5} strokeLinecap="round" fill="none" opacity={0.9} />
      </Svg>
    </Animated.View>
  );
}

// Streams `lines` one after another (each fully types out, a beat, then the
// next begins) — the sequential, slower cadence the sky copy wants.
// Screen 3's stacked copy: the clouds line HUGE and slightly tilted, riding
// high; "look down here!" smaller, a beat later, a bit lower. Both carry a
// hard (zero-blur) drop shadow nudged down the y-axis.
function LookDownCopy({ topInset }: { topInset: number }) {
  // just "look down here!" now (the clouds line was removed), held at a fixed
  // spot so it doesn't drift as it streams.
  return (
    <View style={{ position: 'absolute', top: topInset + 360, left: 0, right: 0, alignItems: 'center' }} pointerEvents="none">
      <SubtleShake intensity={1.8} speed={1.4}>
        <StreamedText text="look down here!" style={styles.lookDownLine} cps={20} reserve />
      </SubtleShake>
    </View>
  );
}

function StreamedLines({
  lines,
  style,
  cps = 20,
  gapMs = 500,
}: {
  lines: string[];
  style?: import('react-native').TextStyle;
  cps?: number;
  gapMs?: number;
}) {
  const [visible, setVisible] = useState(1);
  useEffect(() => {
    if (visible >= lines.length) return;
    const id = setTimeout(() => setVisible((v) => v + 1), streamDurationMs(lines[visible - 1], cps) + gapMs);
    return () => clearTimeout(id);
  }, [visible, lines, cps, gapMs]);
  return (
    <View>
      {lines.slice(0, visible).map((l, i) => (
        <View key={i} style={i ? { marginTop: 8 } : null}>
          <StreamedText text={l} style={style} cps={cps} />
        </View>
      ))}
    </View>
  );
}

function NameEntry({
  title,
  header,
  placeholder,
  cta,
  onSubmit,
  layout = 'center',
  suggestions,
  revealDelayMs = 0,
}: {
  title: string;
  // richer replacement for the plain title (multi-line / streamed copy);
  // `title` still labels the step for accessibility fallbacks
  header?: React.ReactNode;
  placeholder: string;
  cta: string;
  onSubmit: (value: string) => void;
  layout?: 'center' | 'top';
  // Tappable name suggestions — lowers the cognitive load of inventing a name.
  suggestions?: string[];
  // hold the input + CTA back (e.g. until the streamed header lands), then fade in
  revealDelayMs?: number;
}) {
  const insets = useSafeAreaInsets();
  const [value, setValue] = useState('');
  const [inputShown, setInputShown] = useState(revealDelayMs === 0);
  useEffect(() => {
    if (inputShown) return;
    const t = setTimeout(() => setInputShown(true), revealDelayMs);
    return () => clearTimeout(t);
  }, [inputShown, revealDelayMs]);
  const can = value.trim().length > 0;
  const submit = () => {
    if (can) onSubmit(value.trim());
  };
  const chipRow =
    suggestions && suggestions.length > 0 ? (
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.chipRail}
        contentContainerStyle={styles.chipRailContent}
      >
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
      </ScrollView>
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
        <View style={[styles.topCopy, { top: insets.top + 56 }]}>
          {header ?? <Text style={styles.h1small}>{title}</Text>}
        </View>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.nameBottomWrap}
        >
          <View style={[styles.nameCol, { paddingBottom: kbBottomInset(insets.bottom) }]}>
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
        style={[styles.centerFill, FAUX_KB_VISIBLE ? { paddingBottom: FAUX_KB_HEIGHT } : null]}
      >
        <View style={styles.nameCol}>
          {header ?? <Text style={styles.h1}>{title}</Text>}
          {inputShown ? (
            <Animated.View entering={FadeInUp.duration(420)}>
              {field}
              <View style={{ height: 12 }} />
              <PrimaryButton label={cta} onPress={submit} disabled={!can} />
            </Animated.View>
          ) : null}
        </View>
      </KeyboardAvoidingView>
    </Animated.View>
  );
}

// Birthday step. On iOS/Android → the native date-picker spinner (feels native,
// no keyboard, no layout to break). On web (no native picker) → three numeric
// fields. Emits "YYYY-MM-DD". All hooks run unconditionally (Platform is constant),
// then we branch on platform in render.
function BirthdayStep({ title, onSubmit }: { title?: string; onSubmit: (birthday: string) => void }) {
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
          <Text style={styles.h1small}>{title ?? "When's your birthday?"}</Text>
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

  // Real-calendar validation: construct the date and require a round-trip
  // (rejects 02/31 etc., which Date silently rolls over) and no future dates.
  const asDate = new Date(+year, +month - 1, +day);
  const can =
    /^\d{4}$/.test(year) &&
    +year >= 1900 &&
    asDate.getFullYear() === +year &&
    asDate.getMonth() === +month - 1 &&
    asDate.getDate() === +day &&
    asDate.getTime() <= Date.now();
  const submitWeb = () => {
    if (can) onSubmit(`${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`);
  };
  return (
    <Animated.View entering={FadeInUp.duration(450)} style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <View style={[styles.topCopy, { top: insets.top + 96 }]}>
        <Text style={styles.h1small}>{title ?? "When's your birthday?"}</Text>
      </View>
      <View style={[styles.nameBottomWrap, { paddingBottom: kbBottomInset(insets.bottom) }]}>
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
  message,
  topInset,
  onTap,
}: {
  show: boolean;
  sender: string;
  message: string;
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
              {message}
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
  // the one-word hero title: bigger and heavier than h1, dead-centre of screen
  h1Hero: {
    fontFamily: FONT_BOLD,
    fontSize: 58,
    letterSpacing: -2,
    lineHeight: 60,
    textAlign: 'center',
    color: '#fff',
  },
  centerCopy: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  // the over-here gag: copy hugs one side while the camera looks the other way
  sideCopy: { position: 'absolute', top: 0, bottom: 0, width: '42%', justifyContent: 'center' },
  sideRight: { right: 40 },
  sideLeft: { left: 40 },
  // curved edge pointers aiming at the over-here copy
  edgePointerRight: { position: 'absolute', top: '50%', right: 0, marginTop: -20 },
  edgePointerLeft: { position: 'absolute', top: '50%', left: 0, marginTop: -20 },
  // screen 3: the clouds line at ~2× h1small, tilted, hard y-offset shadow
  cloudsBig: {
    fontFamily: FONT_BOLD,
    fontSize: 64,
    lineHeight: 68,
    letterSpacing: -2,
    textAlign: 'center',
    color: '#fff',
    textShadowColor: 'rgba(0,0,0,0.35)',
    textShadowOffset: { width: 0, height: 4 },
    textShadowRadius: 0,
  },
  lookDownLine: {
    fontFamily: FONT_BOLD,
    fontSize: 30,
    lineHeight: 36,
    textAlign: 'center',
    color: '#fff',
    textShadowColor: 'rgba(0,0,0,0.35)',
    textShadowOffset: { width: 0, height: 3 },
    textShadowRadius: 0,
  },
  // streamed two-line ask copy — smaller than h1small so it wraps to two lines
  h2stream: {
    fontFamily: FONT_BOLD,
    fontSize: 26,
    lineHeight: 32,
    letterSpacing: -0.6,
    textAlign: 'center',
    color: '#fff',
    marginBottom: 18,
  },
  tapHint: {
    position: 'absolute',
    left: 0,
    right: 0,
    textAlign: 'center',
    fontFamily: FONT_MEDIUM,
    fontSize: 17,
    color: '#fff',
  },
  h1: {
    fontFamily: FONT_BOLD,
    fontSize: 44,
    fontWeight: '800',
    letterSpacing: -1.4,
    lineHeight: 46,
    textAlign: 'center',
    color: '#fff',
  },
  emph: { color: '#F2C94C' },
  overHere: { fontFamily: FONT_BOLD, fontSize: 30, letterSpacing: -0.6, color: '#fff' },
  h1small: {
    fontFamily: FONT_BOLD,
    fontSize: 34,
    fontWeight: '800',
    letterSpacing: -1.1,
    lineHeight: 36,
    textAlign: 'center',
    color: '#fff',
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
  // full screen width (breaks out of nameCol's 32px gutter) so chips scroll off
  // both edges uncut; the first chip's left aligns to the input's left edge
  chipRail: {
    alignSelf: 'stretch',
    flexGrow: 0,
    marginHorizontal: -32,
    marginBottom: -6,
    overflow: 'visible',
  },
  chipRailContent: {
    gap: 8,
    paddingLeft: 32, // = the input's left gutter
    paddingRight: 24,
    paddingVertical: 6, // room for the chip drop shadow, uncut
  },
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
  // Flat white cards/inputs with a hard (zero-blur) grey drop shadow — a raised,
  // solid look. Reused across the onboarding inputs + chips.
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
