import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Profiler, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Redirect, router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Alert, AppState, Dimensions, Pressable, Text, View, type AppStateStatus } from 'react-native';
import Animated, { Easing, interpolate, useAnimatedStyle, useSharedValue, withSpring, withTiming, type SharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CHAT_SHEET_DETENT, ChatScreen } from '~/imessage';
import { Glass, glassTint } from '~/imessage/components/Glass';
import { AppearanceSheet } from '../src/components/AppearanceSheet';
import { OverheadSpeech } from '../src/components/OverheadSpeech';
import { BoxRewardsModal, GroundBox, StreakSplash } from '../src/components/DailyBox';
import { DevPanel } from '../src/components/DevPanel';
import { GameOverlay } from '../src/components/GameOverlay';
import { GoalsSheet } from '../src/components/GoalsSheet';
import { GuidedHabitChat } from '../src/components/GuidedHabitChat';
import { ClosetButton } from '../src/components/ClosetButton';
import { NewsDot } from '../src/components/NewsDot';
import { SessionChat } from '../src/components/SessionChat';
import { STAR_FACE_TUNING } from '../src/components/StarFaceTuner';
import { StarChat } from '../src/components/StarChat';
import { StarChatButton } from '../src/components/StarChatButton';
import { useStarChat } from '../src/store/star-chat';
import { useStarFaceConfig } from '../src/store/starFaceConfig';
import { useSidekickContext, type Astral } from '../src/store/context';
import { SpeechBubble } from '../src/components/SpeechBubble';
import { HomeDock, MESSAGES_BUBBLE_PATH, MESSAGES_GRADIENT, type TileOrigin } from '../src/components/HomeDock';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Path } from 'react-native-svg';
import { BIOMES, biomeLookForTime, type BiomeId, type EnvironmentId } from '../src/three/biomes';
import { speak, useSpeech } from '../src/store/speech';
import { FACE_EXPRESSIONS, type FaceExpression } from '../src/three/face';
import { BOND_MAX, localDay, nextSession as coreNextSession } from '@sidekick/core';
import { ShopSheet } from '../src/components/ShopSheet';
import { SidekickCanvas } from '../src/components/SidekickCanvas';
import { WorldMap } from '../src/components/WorldMap';
import { homeFraming, type Framing, type SidekickController } from '../src/three/renderer';
import { DEFAULT_SETTINGS, hydrateSettings, loadSettings, refreshTimeOfDay, saveSettings, type SidekickSettings, type TimeOfDay } from '../src/three/settings';
import type { CosmeticsControls } from '../src/three/wardrobe';
import { useDeferredFlag } from '../src/lib/useDeferredFlag';
import { askGoalCheckin, claimDailyBox, fetchCapoff, fetchGoals, fetchHabitAck, goalDoneToday, startHabitChat, type BoxContents } from '../src/lib/api';
import { mainConversation } from '../src/imessage/server';
import { CHAT_MAIN_KEY, chatTranscriptKey, fetchMainTranscript } from '~/imessage/useSidekickChat';
import { GOALS_QUERY_KEY } from '../src/components/GoalsSheet';
import { useDockBadges } from '../src/store/dockBadges';
import { useChatUiMode } from '../src/store/devPrefs';
import { patchBoxClaim, snapshotSessions, useSnapshot } from '../src/lib/state';
import { reconcileWardrobe } from '../src/lib/wardrobe-sync';
import { useCosmeticVersion } from '../src/store/cosmeticVersion';
import { hydrateSkinFromMirror, saveSkinMirror } from '../src/store/skin';
import { markHomeIntroDone, ONBOARDING_QUERY_KEY, type OnboardingState, useOnboardingState } from '../src/lib/onboarding';
import { useAuthStore } from '../src/lib/auth-store';
import { perfFrame, perfMark } from '../src/lib/perf-telemetry';

// RN port of sidekick/src/home4.tsx: full-viewport 3D mascot with an iOS-style
// dock. Messages is a full-screen takeover that zooms out of its dock tile,
// Shop swaps the meadow for a studio and opens the wardrobe sheet, Map rockets
// the camera up while the world map circle-reveals over it.

// Derived from the same homeFraming + defaults the live home uses, so there's one
// source of truth (was a hand-kept literal). Only used as the pre-hydration fallback.
const HERO_FRAMING: Framing = homeFraming(DEFAULT_SETTINGS.fov, DEFAULT_SETTINGS.camDist, DEFAULT_SETTINGS.camHeight);

// The chat sheet covers ~82% of the screen (CHAT_SHEET_DETENT), so the mascot
// gets only the thin band at the top. It has to be small: at the old fov 30 / z 6
// the mascot filled ~half the view and overflowed the band. Wider fov + more
// distance shrinks it, and the low target aims down so the head rides near the
// top of frame (= the visible band) rather than centre. Tune-by-eye values.
const CHAT_FRAMING: Framing = {
  pos: [0, 1.8, 7.6],
  target: [0, -2.25, 0],
  fov: 46,
};

// Chat UI v3 ("sky"): the camera pans UP so the character sits at the BOTTOM
// of the frame on his phone, and the chat floats in the sky above him.
// Tune-by-eye values.
const SKY_CHAT_FRAMING: Framing = {
  pos: [0, 1.3, 6.9],
  target: [0, 3.3, -3.5],
  fov: 50,
};

// Opening the map: the camera rapidly rockets up + back (pull away from the
// meadow) while the world map scales in over it from the centre.
const MAP_FRAMING: Framing = {
  pos: [0, 5.2, 9.5],
  target: [0, 0.1, 0],
  fov: 54,
};

// Shop open: the meadow is swapped for a clean studio, so the character stands
// on the studio floor with a contact shadow. Frame the whole body (head to
// shoes) in the band above the sheet.
const SHOP_FRAMING: Framing = {
  pos: [0, 0.5, 7.8],
  target: [0, -0.2, 0],
  fov: 26,
};

// Guided session: the camera tilts UP off the character to face the night sky
// (which crossfades in via `cosmos`), so the character slides out of frame below
// and the chat floats over the stars.
const COSMOS_FRAMING: Framing = {
  pos: [0, 1.1, 6],
  target: [0, 8.5, -9],
  fov: 52,
};

// The line the sidekick says over its head when a star chat lands. It names the
// card's archetype — a high-level read drawn from everything they've shared —
// rather than a generic "done!", so the payoff is visibly about THEM. Falls back
// to a trait, then to something honest, when the extraction gave us nothing.
function astralNews(astral: Astral | null): string {
  if (astral?.archetype) return `astral card updated ✦ i've got you as "${astral.archetype}" now`;
  // Defensive, not a live path: the server never persists a card without an
  // archetype, so the line above always wins. But the snapshot's astral parses
  // a jsonb column with `catch(null)`, so a corrupt or reshaped blob lands here
  // rather than showing an empty line.
  if (astral?.traits?.length) return `astral card updated ✦ you're more ${astral.traits[0]} than i realised`;
  return 'astral card updated ✦ i feel like i know you a bit better now';
}

// arrival line spoken/pushed when travelling to each world (verbatim from home5)
const TRAVEL_LINES: Record<EnvironmentId, string> = {
  meadow: 'ahh home sweet meadow 🌼',
  snow: "brrr it's FREEZING up here ❄️ worth it for the view though",
  forest: 'ooh it smells so good here 🌲 pine trees hit different',
  blossom: 'petals everywhere!! 🌸 this might be my favorite spot',
  desert: "oh it's HOT here 🥵 like, really hot",
  tropical: 'beach day!!! 🌴 you can literally hear the waves',
  volcano: 'uhh is that lava?? 🌋 this is fine. we’re fine.',
};

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');

// The fullscreen launch morph's per-edge curves, as NAMED standard easings
// (hoisted: building them inside the worklet would allocate per frame).
// back(1.7) ≈ the old 1 + 2.7b³ + 1.7b² overshoot polynomial.
const EASE_TOP = Easing.out(Easing.back(1.7));
const EASE_BOTTOM = Easing.in(Easing.cubic);
const EASE_SIDES = Easing.out(Easing.quad);

// slide-up-from-below used by every drawer-ish chat surface (0 = off-screen
// by `distance`, 1 = in place)
function useSlideUp(progress: SharedValue<number>, distance: number) {
  return useAnimatedStyle(() => ({
    transform: [{ translateY: (1 - progress.value) * distance }],
  }));
}
// The chat drawer covers the lower 75%; the mascot lives in the band above.
const DRAWER_TOP = SCREEN_H * (1 - CHAT_SHEET_DETENT);

// DEV: on-screen frame-rate probe (top-center). Confirms the running bundle and
// shows whether the JS thread is dropping frames during camera moves. Hidden for
// now — flip back to `process.env.NODE_ENV !== 'production'` to re-enable (also
// re-arms the frame-stats telemetry, which is gated on this same flag).
const SHOW_FPS = false;

type FpsStat = {
  fps: number;
  worstMs: number;
  worstJsMs: number;
  calls: number;
  tris: number;
  geometries: number;
  textures: number;
  programs: number;
  skipped: number;
  idle: number;
};
// The overlay is a LEAF that owns its own 2x/sec state, fed through this module
// singleton — so the render-loop's stats callback NEVER re-renders Home. (A root
// setState twice a second was itself a ~100ms commit each time — an observer
// effect that polluted the very frame-timing it was measuring.)
let pushFps: ((s: FpsStat) => void) | null = null;
const emitFps = (s: FpsStat) => {
  pushFps?.(s); // on-screen overlay (isolated leaf)
  perfFrame(s); // off-device telemetry sink
};

// DEV: measure Home's actual React commit cost. `actualDuration` is the time to
// render the Home subtree for a commit — this is what the map-toggle re-render
// costs (~100ms on device / ~7ms on web). Log the non-trivial ones to telemetry
// so we can see which commits are expensive and correlate with map:close:call.
function onHomeRender(
  id: string,
  phase: 'mount' | 'update' | 'nested-update',
  actualDuration: number,
) {
  if (actualDuration > 3) perfMark('render', { id, phase, ms: Math.round(actualDuration) });
}

function FpsOverlay({ top }: { top: number }) {
  const [s, setS] = useState<FpsStat | null>(null);
  useEffect(() => {
    pushFps = setS;
    return () => {
      if (pushFps === setS) pushFps = null;
    };
  }, []);
  if (!s) return null;
  return (
    <View
      pointerEvents="none"
      style={{ position: 'absolute', top, left: 0, right: 0, alignItems: 'center', zIndex: 60 }}
    >
      <View style={{ backgroundColor: 'rgba(0,0,0,0.62)', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 }}>
        <Text
          style={{
            fontFamily: 'monospace',
            fontSize: 12,
            fontWeight: '700',
            color: s.fps >= 50 ? '#bef264' : s.fps >= 30 ? '#fbbf24' : '#f87171',
          }}
        >
          {s.fps.toFixed(0)} fps · {s.worstMs.toFixed(0)}ms · js {s.worstJsMs.toFixed(0)}ms · {s.calls} calls ·{' '}
          {(s.tris / 1000).toFixed(0)}k tris · geo {s.geometries} · tex {s.textures} · prog {s.programs}
        </Text>
      </View>
    </View>
  );
}

// Relative luminance (Rec. 709) of a #rrggbb color, 0 = black … 1 = white.
function hexLuminance(hex: string): number {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export default function Home() {
  // First-run gate: a signed-in account that hasn't finished onboarding is sent
  // to the 3D onboarding flow. The query reads AsyncStorage, so we hold (render
  // nothing) until it resolves rather than flash Home before redirecting. The
  // redirect itself lives just before the return so every hook still runs.
  const onboarding = useOnboardingState();
  const authStatus = useAuthStore((s) => s.status);
  // which Messages presentation is live (devPrefs owns the prod pin — see
  // useChatUiMode: DEV builds follow the DevPanel switch, prod ships one mode)
  const chatUi = useChatUiMode();
  // chatOpen drives the camera/holdingPhone; chatProgress runs the open animation
  const [chatOpen, setChatOpen] = useState(false);
  const chatProgress = useSharedValue(0);
  // the dock tile the chat grows out of (window coords; see openChat)
  const chatOrigin = useSharedValue({ x: SCREEN_W / 2 - 30, y: SCREEN_H - 140, w: 60, h: 60 });
  // guided habit-add ("+" from Goals) presents in the classic chat drawer
  // (same camera/pose/slide as the 'sheet' presentation), driven by this value.
  const habitProgress = useSharedValue(0);
  // mapOpen drives the camera pull-back; mapShown drives the map's circle
  // reveal, a beat later, so the camera starts flying out before the map grows.
  const [mapOpen, setMapOpen] = useState(false);
  const [mapShown, setMapShown] = useState(false);
  const [shopOpen, setShopOpen] = useState(false);
  // world environment (map travel) + the active guided session (if any)
  const [environment, setEnvironment] = useState<EnvironmentId>('meadow');
  const [sessionId, setSessionId] = useState<string | null>(null);
  // the continuous Star Chat (the progressive-onboarding personality reading).
  // Shares the guided-session sky choreography below via `skyMode`; the legacy
  // per-island SessionChat path (map taps) still uses sessionId.
  const [starChatOpen, setStarChatOpen] = useState(false);
  // an open mini-game match (plan 21): the turn player mounts over everything
  const [activeMatchId, setActiveMatchId] = useState<string | null>(null);
  const skyMode = !!sessionId || starChatOpen;
  // TEMPORARY: live star-face look-dev, driven by the sliders in SessionChat.
  // Only pushed while tuning — otherwise the persisted config would override the
  // constants baked into three/star-face.ts, and a stale device config would silently
  // win over the code.
  const starFaceCfg = useStarFaceConfig();
  const starFace = STAR_FACE_TUNING ? starFaceCfg : undefined;
  // Server-driven progression (plan 20): session progress, bond and the astral
  // card all live on the one snapshot, patched by sessions.complete.
  const snapshot = useSnapshot().data;
  // the next unfinished star chat — drives the star beside the head. Derived
  // from the snapshot's sessions slice, so it re-evaluates the moment one
  // completes (the completion response patches the cache).
  const sessions = snapshotSessions(snapshot);
  // an island opened but not yet looked at — dot on the top-right map pin
  const unseenIsland = useSidekickContext((s) => s.unseenIsland);
  // dock notification badges (dockBadges store): each clears when its surface is
  // looked at. Goals shares GoalsSheet's cached query and Messages shares the
  // always-mounted ChatScreen's transcript query (same keys) — neither adds a
  // fetch. The chat queries are gated on a signed-in, onboarded session — Home
  // redirects those cases, but hooks fire before the redirect and shouldn't send
  // tokenless requests (three consecutive 401s trip api.ts's revoked-session
  // handler).
  const sessionReady = authStatus === 'signedIn' && onboarding.data?.complete === true;
  const { goalsSeenDate, shopSeenDate, msgsSeenAt, hydrated: badgesHydrated } = useDockBadges();
  const goalsList = useQuery({ queryKey: GOALS_QUERY_KEY, queryFn: fetchGoals, enabled: sessionReady });
  const chatMain = useQuery({
    queryKey: CHAT_MAIN_KEY,
    queryFn: mainConversation,
    staleTime: Number.POSITIVE_INFINITY,
    enabled: sessionReady,
  });
  const transcript = useQuery({
    queryKey: chatTranscriptKey(chatMain.data?.id),
    queryFn: () => fetchMainTranscript(chatMain.data?.id ?? ''),
    enabled: sessionReady && chatMain.data?.id !== undefined,
  });
  // Memoized: these run on every Home re-render otherwise, and the dots wait for
  // the store to rehydrate — pre-hydration nulls would flash them.
  const { goalsDot, shopDot, unread } = useMemo(() => {
    const today = localDay(Date.now());
    let newMsgs = 0;
    if (msgsSeenAt !== null) {
      for (const m of transcript.data?.messages ?? []) {
        if (m.role === 'them' && m.createdAt > msgsSeenAt) newMsgs++;
      }
    }
    return {
      goalsDot:
        badgesHydrated &&
        goalsSeenDate !== today &&
        (goalsList.data?.goals.some((g) => !goalDoneToday(g)) ?? false),
      shopDot: badgesHydrated && shopSeenDate !== today, // restocks at local midnight
      unread: newMsgs,
    };
  }, [badgesHydrated, goalsSeenDate, shopSeenDate, msgsSeenAt, goalsList.data, transcript.data]);
  const nextStarChat = coreNextSession(sessions);
  // guided-session constellation reveal: how many nodes are lit (the night sky
  // draws it as beats complete)

  // Session entry choreography (cinematic, staged): land on HOME with the
  // sidekick (~1.1s), then `cosmosPanned` → pan up + night crossfade + head
  // look-up, then `chatReady` → the interface fades in once we're in the sky.
  // Both flip false immediately when the session ends (useDeferredFlag offDelay 0).
  const cosmosPanned = useDeferredFlag(skyMode, { onDelay: 1100 });
  const chatReady = useDeferredFlag(skyMode, { onDelay: 2900 });
  // daily-box flow: streak splash → ground chest → rewards modal → done
  const [boxStage, setBoxStage] = useState<'init' | 'streak' | 'ground' | 'rewards' | 'done'>('init');
  const [boxReward, setBoxReward] = useState<BoxContents | null>(null);
  const [goalsOpen, setGoalsOpen] = useState(false);
  // guided habit-add ("+" from Goals): the conversation id while the full-screen
  // Messages sheet is open, else null.
  const [habitConvId, setHabitConvId] = useState<string | null>(null);
  const habitOpen = habitConvId !== null;
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  // imperative handle the canvas publishes once cosmetics are ready; the Shop
  // uses it to dress the live character
  const [controls, setControls] = useState<CosmeticsControls | null>(null);
  // raw scene controller (applySettings, face pulses, daily-box pop)
  const [controller, setController] = useState<SidekickController | null>(null);
  const controllerRef = useRef<SidekickController | null>(null);
  controllerRef.current = controller;

  // Overhead bubble → face. When a line pops over his head, pulse the matching
  // expression for the bubble's duration. The server picks the emotion for
  // LLM-generated lines (capoff, habit ack); static lines pass one in. Bridged
  // off the speech store's nonce so ANY speak() with an expression drives it.
  const speechNonce = useSpeech((s) => s.nonce);
  const lastFaceNonce = useRef(0);
  useEffect(() => {
    const st = useSpeech.getState();
    if (st.nonce === 0 || st.nonce === lastFaceNonce.current || !controller) return;
    lastFaceNonce.current = st.nonce;
    const expr = st.expression;
    if (expr && (FACE_EXPRESSIONS as readonly string[]).includes(expr)) {
      controller.pulseFace(expr as FaceExpression, Math.max(1.6, st.ms / 1000));
    }
  }, [speechNonce, controller]);
  // saved look-dev state must hydrate BEFORE the GL scene builds from it; the
  // mirrored server skin then overwrites its cel colors (plan 20 decision 10)
  const [settings, setSettings] = useState<SidekickSettings | null>(null);
  useEffect(() => {
    hydrateSettings()
      .then(() => hydrateSkinFromMirror())
      .then(() => setSettings(loadSettings()));
  }, []);
  // ---- post-onboarding guided intro (spec screens 15–19) ----------------
  // Fresh from onboarding, Home opens BARE (no dock/pin/closet/star). He looks
  // up and explains the bond score, the score counts 0→N on the star pill, then
  // the star appears with a prompt. Tapping the star consumes the intro.
  const introPending = onboarding.data?.homeIntro === true;
  const [introStep, setIntroStep] = useState<'bond' | 'star' | null>(null);
  const [introBond, setIntroBond] = useState(0);
  // reset on the RISING edge too, so a re-arm (dev replay, or a second launch
  // that re-completes) always restarts from the top instead of resuming at a
  // stale step. `armed` then gates the driver so it fires exactly once per arm.
  const wasPending = useRef(false);
  const introFired = useRef(false); // guards the one-shot driver below
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    // (diagnostics removed — the intro is confirmed working)
    if (introPending && !wasPending.current) {
      setIntroStep(null);
      setIntroBond(0);
      introFired.current = false;
      setArmed(true);
    }
    if (!introPending) setArmed(false);
    wasPending.current = introPending;
  }, [introPending]);
  useEffect(() => {
    // Gate on armed + settings + a FIRED-ONCE ref. Crucially NOT on `introStep`
    // — this effect SETS introStep, so depending on it would re-run the effect
    // and its cleanup would cancel the very timers we just scheduled (they'd
    // never fire; the sequence would freeze at 'line'). Also not on `snapshot`
    // (a fresh account's can lag; count-up defaults the target to 10) or
    // `controller` (the canvas can lose the WebGL-context race arriving from
    // onboarding — only the head-tilt needs it, via a live ref).
    if (!armed || !settings || introFired.current) return;
    introFired.current = true;
    // the star pill + percent pop up right away (introStep 'bond' both shows the
    // star and runs the 0→N count-up); he looks UP at it, then names it, then
    // prompts the tap.
    setIntroStep('bond');
    const timers = [
      setTimeout(() => controllerRef.current?.setLookUp(true), 450), // glance up at the star
      setTimeout(() => speak("that's our bond score", 3200, 'happy'), 1400),
      setTimeout(() => controllerRef.current?.setLookUp(false), 4000), // …then back down
      setTimeout(() => {
        setIntroStep('star');
        speak('tap the star to open our star chat! ✦', 6000, 'excited');
      }, 4600),
    ];
    // reset the head on teardown too (re-arm / unmount), so it can never stick up
    return () => {
      timers.forEach(clearTimeout);
      controllerRef.current?.setLookUp(false);
    };
  }, [armed, settings]);
  // the 0→N count-up (screen 17); each tick re-fires the pill's pop
  useEffect(() => {
    if (introStep !== 'bond' && introStep !== 'star') return;
    const target = Math.max(snapshot?.bond ?? 10, 10);
    if (introBond >= target) return;
    const t = setTimeout(() => setIntroBond((b) => Math.min(target, b + 1)), 90);
    return () => clearTimeout(t);
  }, [introStep, introBond, snapshot]);
  // Profile's astral CTA can't render the star chat (it lives over the 3D
  // scene) — it raises this flag and dismisses; we consume it once the scene
  // is ready and open the chat.
  const starChatRequested = useStarChat((s) => s.openRequested);
  useEffect(() => {
    if (starChatRequested && settings) {
      useStarChat.getState().clearOpenRequest();
      // same gate as the star button: only open when a session remains — the
      // raiser (Profile) checks too, but the consumer must not trust it
      if (coreNextSession(snapshotSessions(snapshot))) setStarChatOpen(true);
    }
  }, [starChatRequested, settings, snapshot]);
  // The scene time-of-day tracks the real clock. hydrate sets it at launch; this
  // catches a session left open across a boundary (dusk → night) when the app
  // comes back to the foreground, and re-applies the matching preset live.
  useEffect(() => {
    const onChange = (next: AppStateStatus) => {
      if (next !== 'active') return;
      if (refreshTimeOfDay()) {
        setSettings((prev) => {
          if (!prev) return prev;
          const updated = { ...prev, timeOfDay: loadSettings().timeOfDay };
          controller?.applySettings(updated);
          return updated;
        });
      }
    };
    const sub = AppState.addEventListener('change', onChange);
    return () => sub.remove();
  }, [controller]);

  // Server-driven cosmetics (plan 20 decision 10): when the snapshot lands —
  // cold start, foreground refetch, or a mutation patch — the server's equipped
  // set + skin overwrite the live scene and the boot mirrors. After a local
  // equip/skin change the cache was patched to match the scene, so this
  // re-applies a no-op; it only visibly acts on genuinely newer server state
  // (another device, a rejected mutation's refetch).
  useEffect(() => {
    if (!snapshot) return;
    let changed = false;
    if (controls) {
      changed = reconcileWardrobe(controls, snapshot.inventory);
    }
    if (snapshot.skin) {
      saveSkinMirror(snapshot.skin);
      const current = loadSettings();
      if (
        current.celBodyColor.toLowerCase() !== snapshot.skin.body.toLowerCase() ||
        current.celShadowColor.toLowerCase() !== snapshot.skin.shadow.toLowerCase()
      ) {
        const next = {
          ...current,
          celBodyColor: snapshot.skin.body,
          celShadowColor: snapshot.skin.shadow,
        };
        saveSettings(next);
        setSettings(next);
        controller?.applySettings(next);
        changed = true;
      }
    }
    if (changed) useCosmeticVersion.getState().bump();
  }, [snapshot, controls, controller]);
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  // star tapped during the guided intro — consume it (never replays)
  const finishIntro = useCallback(() => {
    controllerRef.current?.setLookUp(false); // never leave the head stuck up
    // Consume the intro in-session IMMEDIATELY by patching the query cache — the
    // authoritative source for `introPending` this session. Then persist durably
    // in the background. (Don't invalidate/refetch afterward: a failed persist
    // would re-read homeIntro:true and resurrect the intro mid-dismiss. Worst
    // case a failed write replays it on a future cold start — acceptable.)
    queryClient.setQueryData<OnboardingState>(ONBOARDING_QUERY_KEY, (prev) =>
      prev ? { ...prev, homeIntro: false } : prev,
    );
    void markHomeIntroDone().catch(() => {});
  }, [queryClient]);

  // Streak + daily box are server state (plan 20 phase 2): the streak count and
  // the box's claimable/tier come from the snapshot; the touch itself fires from
  // useForegroundSync. Latch the daily flow once, when the snapshot first lands
  // (state-during-render, the effect-free way to react to data arrival): an
  // unclaimed box opens with the streak splash, otherwise the flow is done.
  const streakCount = snapshot?.streak.count ?? 0;
  if (boxStage === 'init' && snapshot) {
    setBoxStage(snapshot.dailyBox.claimable ? 'streak' : 'done');
  }

  // head-tracked overlay position (bond badge / speech bubble); the canvas
  // writes these every frame from the head-bone projection
  const overheadX = useSharedValue(0);
  const overheadY = useSharedValue(0);
  const overheadVisible = useSharedValue(0);
  // stable object (shared values never change identity) so the memoized canvas
  // + overlays don't see a new `overhead` prop on every Home re-render
  const overhead = useMemo(
    () => ({ x: overheadX, y: overheadY, visible: overheadVisible }),
    [overheadX, overheadY, overheadVisible],
  );

  // ground-anchor projection for the daily loot chest (canvas writes the chest's
  // on-screen base every frame; GroundBox pins its tap target/FX over it)
  const groundX = useSharedValue(0);
  const groundY = useSharedValue(0);
  const groundVisible = useSharedValue(0);
  const ground = useMemo(
    () => ({ x: groundX, y: groundY, visible: groundVisible }),
    [groundX, groundY, groundVisible],
  );

  // Handlers are stabilized with useCallback so the memoized surfaces below
  // (WorldMap/ShopSheet/HomeDock/…) don't re-render when an unrelated surface
  // toggles — a full re-render of those heavy trees on the JS thread was stalling
  // the 3D render loop and stuttering the camera ease.
  // Stamp "everything currently known is seen" from SERVER timestamps (the
  // shared transcript cache). Client Date.now() is only the last-ditch fallback:
  // a device clock ahead of the server would otherwise stamp the future and
  // swallow real unread arrivals.
  const stampMsgsSeen = useCallback(() => {
    const cid = queryClient.getQueryData<{ id: string }>(CHAT_MAIN_KEY)?.id;
    const msgs = queryClient.getQueryData<{ messages: { createdAt: number }[] }>(
      chatTranscriptKey(cid),
    )?.messages;
    let newest = 0;
    if (msgs) for (const m of msgs) newest = Math.max(newest, m.createdAt);
    useDockBadges.getState().markMsgsSeen(newest > 0 ? newest : Date.now());
  }, [queryClient]);
  const openChat = useCallback((origin?: TileOrigin) => {
    setChatOpen(true);
    if (chatUi === 'fullscreen') {
      // zoom out of the pressed dock tile, iOS-app-launch style; entries without
      // a tile (goal check-ins, the map) grow from the dock's neighborhood
      chatOrigin.value = {
        x: origin?.x ?? SCREEN_W / 2 - 30,
        y: origin?.y ?? SCREEN_H - 140,
        w: origin?.width ?? 60,
        h: origin?.height ?? 60,
      };
      // a spring drives the whole flight: quick, lively through the middle,
      // decelerating into a settle at the end (curves below shape the geometry)
      chatProgress.value = withSpring(1, { damping: 16, stiffness: 170, mass: 0.75 });
    } else {
      chatProgress.value = withTiming(1, { duration: 400, easing: Easing.out(Easing.cubic) });
    }
    stampMsgsSeen(); // they're looking at the chat — what exists now is seen
  }, [chatProgress, chatOrigin, chatUi, stampMsgsSeen]);
  const closeChat = useCallback(() => {
    setChatOpen(false);
    chatProgress.value = withTiming(0, { duration: 340, easing: Easing.linear });
    stampMsgsSeen(); // include everything received while the chat was up
    // As the user walks back to the 3D sidekick, have it get the last word: a
    // snarky one-liner capping off the conversation, over its head. The 500ms
    // beat lets the drawer clear and the camera ease back to HERO first.
    const conversationId = queryClient.getQueryData<{ id: string }>(CHAT_MAIN_KEY)?.id;
    if (conversationId) {
      fetchCapoff(conversationId)
        .then(({ quip, expression }) => {
          if (quip) {
            setTimeout(() => speak(quip, 4500, expression), 500);
          }
        })
        .catch(() => {}); // silent — no bubble on failure
    }
  }, [chatProgress, queryClient, stampMsgsSeen]);

  const openMap = useCallback(() => {
    perfMark('map:open:call');
    setMapOpen(true); // camera rockets up + back immediately
    setTimeout(() => setMapShown(true), 60); // circle mask starts expanding almost right away
  }, []);
  const closeMap = useCallback(() => {
    perfMark('map:close:call');
    setMapShown(false); // map scales back out…
    setMapOpen(false); // …while the camera flies back to the meadow
    // they've had their look — retire the unlock notification
    useSidekickContext.getState().clearUnseenIsland();
  }, []);

  // travel to a biome: swap the 3D world, close the map, and drop an arrival
  // line (bubble after the map reveal shrinks so it pops over the visible
  // character) — mirrors home5.tsx onTravel.
  const travelTo = useCallback(
    (biome: EnvironmentId) => {
      setEnvironment(biome);
      closeMap();
      const line = TRAVEL_LINES[biome];
      if (line) {
        // arrivals are upbeat; home is more content
        setTimeout(() => speak(line, undefined, biome === 'meadow' ? 'happy' : 'excited'), 650);
      }
    },
    [closeMap],
  );

  // Named, stable versions of the small inline arrows the memoized surfaces get.
  const openProfile = useCallback(() => router.push('/profile'), []);
  const openShop = useCallback(() => {
    setShopOpen(true);
    useDockBadges.getState().markShopSeen(); // today's restock: looked at
  }, []);
  const closeShop = useCallback(() => setShopOpen(false), []);
  const openGoals = useCallback(() => {
    setGoalsOpen(true);
    useDockBadges.getState().markGoalsSeen(); // today's goals: looked at
  }, []);
  const closeGoals = useCallback(() => setGoalsOpen(false), []);
  const openAppearance = useCallback(() => setAppearanceOpen(true), []);
  const closeAppearance = useCallback(() => setAppearanceOpen(false), []);
  // Tap a goal → open the main chat onto a "did you [action] today?" question the
  // sidekick just dropped in; the user's reply is logged by the chat's always-on
  // log_checkin tool. Open the drawer right away (snappy); revalidate the
  // transcript when the insert lands so the question is there as it slides up.
  const goalCheckin = useCallback(
    (goalId: string) => {
      setGoalsOpen(false);
      openChat();
      askGoalCheckin(goalId)
        .then(({ conversationId }) => {
          void queryClient.invalidateQueries({
            queryKey: ['chat', 'transcript', conversationId],
          });
        })
        .catch(() => {});
    },
    [openChat, queryClient],
  );
  // "Add a Habit or Goal": close Goals, start a fresh guided-habit conversation,
  // and open it full-screen in the Messages sheet.
  const openAddHabit = useCallback(() => {
    setGoalsOpen(false);
    startHabitChat()
      .then(({ conversationId }) => {
        setHabitConvId(conversationId); // camera → CHAT_FRAMING + phone (via habitOpen)
        habitProgress.value = withTiming(1, { duration: 380 }); // drawer slides up
      })
      .catch(() => {});
  }, [habitProgress]);
  // slide the drawer down, then unmount a beat later so the camera eases back home.
  const abortAddHabit = useCallback(() => {
    habitProgress.value = withTiming(0, { duration: 340 });
    setTimeout(() => setHabitConvId(null), 340);
  }, [habitProgress]);
  // habit set → close the drawer (land home), refresh goals, and have the sidekick
  // pop a personalized ack over his head once the camera has settled.
  const finishAddHabit = useCallback(() => {
    const cid = habitConvId;
    habitProgress.value = withTiming(0, { duration: 340 });
    setTimeout(() => setHabitConvId(null), 340);
    void queryClient.invalidateQueries({ queryKey: GOALS_QUERY_KEY });
    if (cid) {
      fetchHabitAck(cid)
        .then(({ line, expression }) => {
          if (line) setTimeout(() => speak(line, 6000, expression), 900);
        })
        .catch(() => {});
    }
  }, [habitConvId, habitProgress, queryClient]);
  const mapToChat = useCallback(() => {
    closeMap();
    openChat();
  }, [closeMap, openChat]);
  const startSessionFromMap = useCallback(
    (id: string) => {
      closeMap();
      setSessionId(id);
    },
    [closeMap],
  );
  const onSkinChange = useCallback(
    (next: SidekickSettings) => {
      setSettings(next);
      controller?.applySettings(next);
    },
    [controller],
  );

  // DEV: live time-of-day override (day/evening/night). Swaps the scene preset on
  // the live controller. Not persisted meaningfully — loadSettings/refreshTimeOfDay
  // force timeOfDay back to the wall clock — so this is a look toggle, reset on reload.
  const setTimeOfDay = useCallback(
    (tod: TimeOfDay) => {
      if (!settings) return;
      const next = { ...settings, timeOfDay: tod };
      setSettings(next);
      controller?.applySettings(next);
    },
    [settings, controller],
  );

  // The home ("hero") shot is derived from the look-dev camera settings (fov /
  // distance / height) so /sidekick-3d previews the EXACT same camera. Falls back
  // to the literal HERO_FRAMING until settings hydrate.
  const hero = useMemo<Framing>(
    () => (settings ? homeFraming(settings.fov, settings.camDist, settings.camHeight) : HERO_FRAMING),
    [settings?.fov, settings?.camDist, settings?.camHeight],
  );

  // The active camera framing per surface. Memoized so the canvas gets a stable
  // prop (a new object literal every render would defeat its memo and re-fire the
  // setFraming effect each time).
  const framing = useMemo<Framing>(
    () =>
      skyMode
        ? cosmosPanned
          ? COSMOS_FRAMING // pan up to the sky (after the home beat)
          : hero // land on home first
        : mapOpen
          ? MAP_FRAMING
          : shopOpen || appearanceOpen
            ? SHOP_FRAMING
            : chatOpen
              ? chatUi === 'sky'
                ? SKY_CHAT_FRAMING
                : CHAT_FRAMING
              : habitOpen
                ? CHAT_FRAMING
                : hero,
    [skyMode, cosmosPanned, mapOpen, shopOpen, appearanceOpen, chatOpen, chatUi, habitOpen, hero],
  );

  // Anything covered by a full surface — ONE predicate for every head-tracked /
  // corner overlay (map pin, closet avatar, speech bubble, star pill, daily box,
  // the renderer's overhead projection). The pin + closet stay MOUNTED and hide
  // via opacity — the closet button owns a GL context (see ClosetButton).
  const covered = mapShown || shopOpen || chatOpen || skyMode || habitOpen;

  // DEV: mark when a map open/close toggle actually commits, so the telemetry can
  // measure React commit latency (map:close:call → this) against the frame stalls.
  useEffect(() => {
    perfMark('map:state-commit', { mapOpen, mapShown });
  }, [mapOpen, mapShown]);

  // The top-right glass cluster floats over the sky. When that sky is dark, both
  // the glass material and its content adapt: the fill uses a DARK material (so it
  // reads as translucent glass over dark, not a white panel) and the icon/text
  // flip to white. Over a light sky it's the inverse. Keyed off the top-of-sky
  // colour — both time-of-day driven: the meadow reads its scene preset, a biome
  // reads its preset run through biomeLookForTime (same as the renderer), so at
  // evening/night the tint tracks the darkened sky instead of the day base.
  const tod = settings?.timeOfDay ?? 'day';
  // Memoized: the biome branch runs biomeLookForTime (builds a whole preset) — no
  // need to redo it on every unrelated Home re-render, only when env/tod/scene change.
  const topSky = useMemo(
    () =>
      environment === 'meadow'
        ? settings
          ? settings.scenes[tod]?.skyTop ?? '#3ea1cc'
          : '#3ea1cc'
        : BIOMES[environment as BiomeId]
          ? biomeLookForTime(BIOMES[environment as BiomeId].preset, tod).skyTop
          : '#3ea1cc',
    [environment, tod, settings],
  );
  const darkBackdrop = hexLuminance(topSky) < 0.4;

  // (hoisted so the worklet doesn't rebuild the easing closures per frame)
  // iOS-app-launch morph. The container starts as the EXACT tile rect (per-axis
  // scale, so at p=0 it IS the square icon) and each edge runs its own curve:
  //  - the top edge races ahead with a back-out overshoot — the rect visibly
  //    STRETCHES upward out of the dock, top corners reaching the screen first
  //  - the bottom edge trails on an ease-in, leaving the dock last
  //  - a perspective rotateX tips the bottom AWAY mid-flight so the rect reads
  //    as a reverse pyramid — wide top edge, narrow bottom edge — settling flat
  // Open is driven by a spring (see openChat), close by a linear timing;
  // the geometric character lives in these per-edge curves either way.
  const chatZoomStyle = useAnimatedStyle(() => {
    const p = chatProgress.value;
    const o = chatOrigin.value;
    // top: compressed into the first ~60% of the flight with a hard back-out —
    // it FLIES up and fills its corners early, overshooting ~10% then settling
    const pTop = EASE_TOP(Math.min(1, p / 0.6));
    // bottom: gravity-pinned early, then arrives by ~92% — close enough behind
    // the top that the landing reads as one settle, not two separate hits
    const pBot = EASE_BOTTOM(Math.min(1, p / 0.92));
    // sides: quick ease-out, resolved by ~70% so the width leads the bottom
    const pX = EASE_SIDES(Math.min(1, p / 0.7));
    const top = o.y * (1 - pTop);
    const bottom = (o.y + o.h) * (1 - pBot) + SCREEN_H * pBot;
    const left = o.x * (1 - pX);
    const right = (o.x + o.w) * (1 - pX) + SCREEN_W * pX;
    return {
      transform: [
        { perspective: 650 },
        { translateX: (left + right) / 2 - SCREEN_W / 2 },
        // fully closed = parked OFF-SCREEN inside the transform (transform-only:
        // a layout prop like marginTop would re-run Yoga on the whole chat tree
        // every frame; and never an opacity write — Glass descendants die if an
        // ancestor's opacity animates, expo/expo#41024)
        { translateY: (top + bottom) / 2 - SCREEN_H / 2 + (p > 0.005 ? 0 : SCREEN_H * 4) },
        // NEGATIVE rotateX tips the BOTTOM away: the bottom edge renders
        // narrower than the top (reverse pyramid). The tilt snaps in over the
        // first quarter, then the flatten TRACKS the bottom's arrival — so the
        // final motion reads as the bottom corners rotating FORWARD in depth
        // to touch the screen edges, not sliding down to them
        { rotateX: `${-20 * Math.min(1, Math.max(0, p) / 0.25) * (1 - pBot)}deg` },
        { scaleX: Math.max(0.001, (right - left) / SCREEN_W) },
        { scaleY: Math.max(0.001, (bottom - top) / SCREEN_H) },
      ],
      // tile corners while small, square once full screen
      borderRadius: 44 * Math.max(0, 1 - p),
    };
  });
  // v1 sheet slides over the lower ~82%; v3 sky slides the full height over the
  // scene. Slides, never fades: the wrappers hold Glass descendants, and
  // animating an ancestor's opacity permanently kills UIGlassEffect views
  // (expo/expo#41024 — same reason HomeDock slides instead of fading).
  const chatSheetStyle = useSlideUp(chatProgress, SCREEN_H - DRAWER_TOP);
  const chatSkyStyle = useSlideUp(chatProgress, SCREEN_H);
  // The icon clone rides ON TOP of the chat inside the morphing rect and fades
  // away in a BLINK (~2 frames) — one stretched half-icon/half-app frame, then
  // it's the screen. (Fading the OVERLAY, never the chat content, keeps
  // UIGlassEffect descendants alive — expo/expo#41024.)
  const chatIconFadeStyle = useAnimatedStyle(() => ({
    opacity: interpolate(chatProgress.value, [0, 0.3, 0.38, 1], [1, 1, 0, 0]),
  }));
  const habitDrawerStyle = useSlideUp(habitProgress, SCREEN_H - DRAWER_TOP);

  // Front-door gate (see the query at the top). Placed after every hook so the
  // hook order is stable across renders; a one-frame blank while it resolves.
  // Signed out OR not-yet-onboarded → the 3D onboarding (auth happens there in
  // phase 0). Home renders only for a signed-in, onboarded user.
  if (onboarding.isPending) return <View className="flex-1 bg-white" />;
  if (authStatus === 'signedOut' || !onboarding.data?.complete) {
    return <Redirect href="/onboarding" />;
  }

  return (
    <Profiler id="home" onRender={onHomeRender}>
    <View className="flex-1 bg-white">
      {/* Full-viewport 3D scene (mounted once saved look-dev state hydrates) */}
      {settings ? (
        <SidekickCanvas
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
          framing={framing}
          holdingPhone={chatOpen || habitOpen}
          studio={shopOpen || appearanceOpen}
          cosmos={cosmosPanned}
          starFace={starFace}
          environment={environment}
          onControls={setControls}
          onController={setController}
          onFrameStats={SHOW_FPS ? emitFps : undefined}
          overhead={overhead}
          overheadActive={!covered}
          ground={ground}
          dailyBox={boxStage === 'ground' || boxStage === 'rewards' ? (snapshot?.dailyBox.tier ?? null) : null}
        />
      ) : null}

      {/* what the sidekick is saying, over its head (hidden while a full
          surface covers the scene). The bond score lives on the star now. */}
      {settings ? (
        <OverheadSpeech overhead={overhead} hidden={covered}>
          <SpeechBubble />
        </OverheadSpeech>
      ) : null}

      {/* the way into a star chat: a star beside the sidekick's head. Hidden
          once every session is done — nothing left to open — and until the
          snapshot lands (we don't know the ladder's position before then).
          EXCEPTION: during the guided intro the pill drives itself off
          `introBond` (the 0→N count-up), NOT the snapshot — so it must render
          even before server data arrives, else the intro has no star to show
          and, since tapping it is the only way to consume the intro, it'd be
          stuck forever on a device whose API is slow/unreachable. */}
      {(introPending ? !!settings : settings && snapshot && nextStarChat) ? (
        <StarChatButton
          overhead={overhead}
          hidden={covered || (introPending && introStep !== 'bond' && introStep !== 'star')}
          bondOverride={introPending ? introBond : undefined}
          onPress={() => {
            if (introPending) finishIntro(); // star tapped — intro consumed
            setStarChatOpen(true);
          }}
          darkBg={darkBackdrop}
        />
      ) : null}

      {/* the closet/inventory entry: the live head avatar floating beside the
          sidekick's head (the star pill hangs above-left, this balances right).
          Always mounted — it owns a GL context (see ClosetButton for the iOS
          teardown caveat); hidden via opacity, frozen while covered or while
          the Closet itself is open. */}
      <ClosetButton
        overhead={overhead}
        hidden={covered || introPending}
        paused={appearanceOpen || covered}
        onPress={openAppearance}
      />

      {/* top-right: the map pin, alone now (streak lives in Profile, the closet
          floats by the head). Hidden under any full surface. */}
      <View
        style={{
          position: 'absolute',
          top: insets.top + 8,
          right: 16,
          zIndex: 25,
          opacity: covered || introPending ? 0 : 1,
        }}
        pointerEvents={covered || introPending ? 'none' : 'box-none'}
      >
        {/* Frosted glass — no `overflow:'hidden'` (it kills the glass effect); the
            round shape comes from borderRadius, which Glass clips natively. The
            material tint tracks the backdrop so the fill isn't a fixed white panel.
            The map's entry point: a small pin. Carries the unseen-island dot. */}
        <Glass
          isInteractive
          tint={glassTint(darkBackdrop)}
          style={{ height: 52, width: 52, borderRadius: 26 }}
        >
          <Pressable
            onPress={openMap}
            accessibilityLabel="Map"
            style={{ height: 52, width: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center' }}
          >
            <Ionicons name="location-outline" size={26} color={darkBackdrop ? '#fff' : '#404040'} />
          </Pressable>
        </Glass>
        {/* a new island is open and hasn't been looked at yet */}
        {unseenIsland ? <NewsDot style={{ top: -2, right: -2 }} /> : null}
      </View>

      {/* Persistent star-chat CTA (spec 19): until the FIRST star chat lands a
          card, a pill above the dock keeps the path visible. Hidden while the
          guided intro runs (the star prompt owns that moment) and under any
          full surface. */}
      {settings && snapshot && !snapshot.astral && nextStarChat && !covered && !introPending && !starChatOpen ? (
        <Pressable
          onPress={() => setStarChatOpen(true)}
          style={{
            position: 'absolute',
            bottom: Math.max(insets.bottom, 16) + 104,
            alignSelf: 'center',
            zIndex: 29,
            backgroundColor: 'rgba(22,14,44,0.92)',
            borderColor: 'rgba(201,188,255,0.35)',
            borderWidth: 1,
            borderRadius: 999,
            paddingHorizontal: 16,
            paddingVertical: 9,
          }}
        >
          <Text style={{ fontFamily: 'Diatype-Rounded-Medium', fontSize: 13, color: '#E7E0FF' }}>
            complete a star chat to unlock your personality read ✦
          </Text>
        </Pressable>
      ) : null}

      {/* iOS-style home dock — the sheets slide up OVER it; only the
          full-screen map reveal hides it */}
      <HomeDock
        hidden={mapShown || skyMode || introPending || (chatUi !== 'sheet' && chatOpen)}
        unread={unread}
        shopDot={shopDot}
        goalsDot={goalsDot}
        onMessages={openChat}
        onShop={openShop}
        onGoals={openGoals}
        onProfile={openProfile}
      />

      {/* Full-screen world map — scales in from centre while the camera pulls
          away behind it */}
      <WorldMap
        open={mapShown}
        onClose={closeMap}
        onChat={mapToChat}
        onTravel={travelTo}
        onStartSession={startSessionFromMap}
      />

      {/* Guided session — the interface only mounts once the pan up to the sky
          has settled (chatReady), so the transition is pure scene: home → pan up
          → THEN the chat fades in */}
      {sessionId && chatReady ? (
        <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 60 }}>
          <SessionChat
            sessionId={sessionId}
            onClose={() => {
              setSessionId(null);
            }}
            onDone={() => {
              // Back to the meadow — no travel, no unlock modal. The news finds
              // them at home instead: a dot on the map icon, and the sidekick
              // saying what changed. Delayed until the sky has panned back down,
              // or the line lands while the chat is still on screen. The card
              // comes off the snapshot, patched by the completion response.
              setSessionId(null);
              const line = astralNews(snapshot?.astral ?? null);
              setTimeout(() => speak(line, 6000, 'excited'), 2600);
              // if the bond isn't full yet, nudge them to keep going — a beat
              // after the astral line so it reads as a second thought
              if ((snapshot?.bond ?? 0) < BOND_MAX) {
                setTimeout(() => speak("let's complete our bond ✦", 5000, 'excited'), 9200);
              }
            }}
          />
        </View>
      ) : null}

      {/* Star Chat — the continuous personality reading. Same sky choreography as
          a guided session (pan up → chat fades in once chatReady). */}
      {starChatOpen && chatReady ? (
        <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 60 }}>
          <StarChat
            onDone={(updated) => {
              setStarChatOpen(false);
              // only react if a chapter actually landed — a quick open-then-leave
              // shouldn't have the sidekick claim the card updated.
              if (!updated) return;
              const line = astralNews(snapshot?.astral ?? null);
              setTimeout(() => speak(line, 6000, 'excited'), 2600);
              // if there's more of the reading left, invite them back whenever
              if (coreNextSession(sessions)) {
                setTimeout(() => speak('we can do your next astral chat whenever you\'re ready ✦', 5000, 'happy'), 9200);
              }
            }}
          />
        </View>
      ) : null}


      {/* Daily-box flow (home only): streak splash → ground chest → rewards */}
      {settings && !covered && !introPending ? (
        <>
          {boxStage === 'streak' ? (
            <StreakSplash streak={streakCount} onDone={() => setBoxStage('ground')} />
          ) : null}
          {boxStage === 'ground' ? (
            <View style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, zIndex: 30 }} pointerEvents="box-none">
              <GroundBox
                ground={ground}
                onTap={async () => {
                  // claim first; the chest only pops on the server's word. The
                  // response carries the exact granted contents (a same-day
                  // replay returns the identical persisted box), and its
                  // coins/streak patch the snapshot.
                  try {
                    const claim = await claimDailyBox();
                    patchBoxClaim(queryClient, claim);
                    setBoxReward(claim.box);
                    controller?.popDailyBox();
                    return true;
                  } catch (error) {
                    const message =
                      error instanceof Error && error.message
                        ? error.message
                        : 'something went wrong — try again';
                    Alert.alert("Couldn't open the box", message);
                    return false;
                  }
                }}
                onOpened={() => setBoxStage('rewards')}
              />
            </View>
          ) : null}
          {boxStage === 'rewards' && boxReward ? (
            <BoxRewardsModal reward={boxReward} onCollect={() => setBoxStage('done')} />
          ) : null}
        </>
      ) : null}

      {/* Shop sheet — covers the lower half; tap the character band above to
          close */}
      {shopOpen ? (
        <Pressable
          onPress={() => setShopOpen(false)}
          accessibilityLabel="Close shop"
          style={{ position: 'absolute', top: 0, left: 0, right: 0, height: SCREEN_H * 0.48, zIndex: 20 }}
        />
      ) : null}
      <ShopSheet open={shopOpen} onClose={closeShop} controls={controls} />

      {/* goals, streak ladder, appearance/closet */}
      <GoalsSheet open={goalsOpen} onClose={closeGoals} onCheckin={goalCheckin} onAddHabit={openAddHabit} />

      {/* guided habit-add — presented in a drawer IDENTICAL to the main chat
          (same slide/pose/framing, no title); tap the band above to close */}
      {habitOpen ? (
        <Pressable
          onPress={abortAddHabit}
          accessibilityLabel="Close add habit"
          style={{ position: 'absolute', top: 0, left: 0, right: 0, height: DRAWER_TOP, zIndex: 30 }}
        />
      ) : null}
      {habitConvId ? (
        <Animated.View
          style={[
            habitDrawerStyle,
            {
              position: 'absolute',
              left: 0,
              right: 0,
              top: DRAWER_TOP,
              height: SCREEN_H - DRAWER_TOP,
              zIndex: 40,
              shadowColor: '#000',
              shadowOpacity: 0.12,
              shadowRadius: 24,
              shadowOffset: { width: 0, height: -8 },
            },
          ]}
        >
          {/* same white, rounded, grabbered panel as the main chat */}
          <View style={{ flex: 1, backgroundColor: '#fff', borderTopLeftRadius: 28, borderTopRightRadius: 28, overflow: 'hidden' }}>
            <View style={{ alignItems: 'center', paddingTop: 8, paddingBottom: 2 }}>
              <View style={{ width: 36, height: 5, borderRadius: 3, backgroundColor: 'rgba(60,60,67,0.3)' }} />
            </View>
            <GuidedHabitChat conversationId={habitConvId} onComplete={finishAddHabit} />
          </View>
        </Animated.View>
      ) : null}
      {settings ? (
        <AppearanceSheet
          open={appearanceOpen}
          onClose={closeAppearance}
          controls={controls}
          onSkinChange={onSkinChange}
        />
      ) : null}

      {/* Messages — three DEV-selectable presentations (DevPanel → Chat UI):
          v1 'sheet': the original slide-up drawer, character peeking above it
          v2 'fullscreen': takeover zooming out of the dock tile (icon morph)
          v3 'sky': camera pans up (SKY_CHAT_FRAMING), the chat floats above
          the character; the header's X closes it */}
      {(() => {
        // one ChatScreen instance shared by whichever wrapper is live
        const chatScreen = <ChatScreen floating={chatUi === 'sky'} onClose={closeChat} onOpenGame={setActiveMatchId} />;
        return chatUi === 'sheet' ? (
        <>
          {chatOpen ? (
            <Pressable
              onPress={closeChat}
              accessibilityLabel="Close chat"
              style={{ position: 'absolute', top: 0, left: 0, right: 0, height: DRAWER_TOP, zIndex: 30 }}
            />
          ) : null}
          <Animated.View
            style={[
              chatSheetStyle,
              {
                position: 'absolute',
                left: 0,
                right: 0,
                top: DRAWER_TOP,
                height: SCREEN_H - DRAWER_TOP,
                zIndex: 40,
                shadowColor: '#000',
                shadowOpacity: 0.12,
                shadowRadius: 24,
                shadowOffset: { width: 0, height: -8 },
              },
            ]}
            pointerEvents={chatOpen ? 'auto' : 'none'}
          >
            {chatScreen}
          </Animated.View>
        </>
      ) : chatUi === 'sky' ? (
        /* no panel at all: the transcript + input bar float straight over the
           environment (ChatScreen `floating`); the dock fades out beneath and
           the input bar takes its place at the bottom */
        <Animated.View
          style={[
            chatSkyStyle,
            { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 40 },
          ]}
          pointerEvents={chatOpen ? 'auto' : 'none'}
        >
          {/* NO top safe-area pad here: the floating transcript runs to the very
              top of the device so messages scroll up and overflow past the
              dynamic island instead of being clipped under it. ChatScreen insets
              its own close button. */}
          <View style={{ flex: 1 }}>
            {chatScreen}
          </View>
        </Animated.View>
      ) : (
        <Animated.View
          style={[
            chatZoomStyle,
            {
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              zIndex: 40,
              overflow: 'hidden',
              backgroundColor: '#fff',
            },
          ]}
          pointerEvents={chatOpen ? 'auto' : 'none'}
        >
          <View style={{ flex: 1, paddingTop: insets.top }}>
            {chatScreen}
          </View>
          {/* the launching app icon: stretches with the rect, fades into the app */}
          <Animated.View
            pointerEvents="none"
            style={[chatIconFadeStyle, { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }]}
          >
            <LinearGradient colors={MESSAGES_GRADIENT} style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
              <Svg viewBox="0 0 24 24" width="62%" height="62%" preserveAspectRatio="none">
                <Path fill="#fff" d={MESSAGES_BUBBLE_PATH} />
              </Svg>
            </LinearGradient>
          </Animated.View>
        </Animated.View>
      );
      })()}

      {/* Game overlay (plan 21) — the full-screen turn player, over the chat
          drawer; a turn card tap or the picker sheet opens it */}
      {activeMatchId ? (
        <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 70 }}>
          <GameOverlay matchId={activeMatchId} onClose={() => setActiveMatchId(null)} />
        </View>
      ) : null}

      {/* DEV frame-rate probe (top-center), isolated leaf so it never re-renders
          Home. fps = avg over ~0.5s; worst = slowest single frame; js = time
          inside the render loop; calls/tris = scene GL draw calls + triangles. */}
      {SHOW_FPS ? <FpsOverlay top={insets.top + 6} /> : null}

      {/* DEV state controls (top-left chip → panel); renders nothing in prod */}
      <DevPanel
        timeOfDay={settings?.timeOfDay}
        onSetTimeOfDay={setTimeOfDay}
        onJumpToReveal={() => {
          useStarChat.getState().devSeedArtifact();
          setStarChatOpen(true);
        }}
      />
    </View>
    </Profiler>
  );
}
