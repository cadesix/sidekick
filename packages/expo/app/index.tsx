import { useQueryClient } from '@tanstack/react-query';
import { Profiler, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Redirect, router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Alert, AppState, Dimensions, Pressable, Text, View, type AppStateStatus } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
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
import { SessionChat, STAR_FACE_TUNING } from '../src/components/SessionChat';
import { StarChat } from '../src/components/StarChat';
import { StarChatButton } from '../src/components/StarChatButton';
import { useStarChat } from '../src/store/star-chat';
import { useStarFaceConfig } from '../src/store/starFaceConfig';
import { useSidekickContext, type Astral } from '../src/store/context';
import { SpeechBubble } from '../src/components/SpeechBubble';
import { HomeDock } from '../src/components/HomeDock';
import { BIOMES, biomeLookForTime, type BiomeId, type EnvironmentId } from '../src/three/biomes';
import { speak, useSpeech } from '../src/store/speech';
import { FACE_EXPRESSIONS, type FaceExpression } from '../src/three/face';
import { BOND_MAX, nextSession as coreNextSession } from '@sidekick/core';
import { SettingsSheet } from '../src/components/SettingsSheet';
import { ShopSheet } from '../src/components/ShopSheet';
import { SidekickCanvas } from '../src/components/SidekickCanvas';
import { WorldMap } from '../src/components/WorldMap';
import { homeFraming, type Framing, type SidekickController } from '../src/three/renderer';
import { DEFAULT_SETTINGS, hydrateSettings, loadSettings, refreshTimeOfDay, saveSettings, type SidekickSettings, type TimeOfDay } from '../src/three/settings';
import type { CosmeticsControls } from '../src/three/wardrobe';
import { useDeferredFlag } from '../src/lib/useDeferredFlag';
import { askGoalCheckin, claimDailyBox, fetchCapoff, fetchHabitAck, startHabitChat, type BoxContents } from '../src/lib/api';
import { patchBoxClaim, snapshotSessions, useSnapshot } from '../src/lib/state';
import { reconcileWardrobe } from '../src/lib/wardrobe-sync';
import { useCosmeticVersion } from '../src/store/cosmeticVersion';
import { hydrateSkinFromMirror, saveSkinMirror } from '../src/store/skin';
import { useOnboardingState } from '../src/lib/onboarding';
import { useAuthStore } from '../src/lib/auth-store';
import { perfFrame, perfMark } from '../src/lib/perf-telemetry';

// RN port of sidekick/src/home4.tsx: full-viewport 3D mascot with an iOS-style
// dock. Messages presents the chat as a native sheet over the lower ~75%
// (camera eases to CHAT_FRAMING, the mascot holds its phone in the band above),
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

const { height: SCREEN_H } = Dimensions.get('window');
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
  // chatOpen drives the camera/holdingPhone; chatProgress slides the drawer
  const [chatOpen, setChatOpen] = useState(false);
  const chatProgress = useSharedValue(0);
  // guided habit-add ("+" from Goals) presents in an IDENTICAL drawer to the main
  // chat — same camera/pose/slide — driven by this progress value.
  const habitProgress = useSharedValue(0);
  // mapOpen drives the camera pull-back; mapShown drives the map's circle
  // reveal, a beat later, so the camera starts flying out before the map grows.
  const [mapOpen, setMapOpen] = useState(false);
  const [mapShown, setMapShown] = useState(false);
  const [shopOpen, setShopOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
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
  // constants baked into renderer.ts, and a stale device config would silently
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
  // an island opened but not yet looked at — dot on the dock's map icon
  const unseenIsland = useSidekickContext((s) => s.unseenIsland);
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
  // raw scene controller for the Settings sheet's live look-dev
  const [controller, setController] = useState<SidekickController | null>(null);

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
  const openChat = useCallback(() => {
    setChatOpen(true); // camera starts easing while the drawer slides up
    chatProgress.value = withTiming(1, { duration: 380 });
  }, [chatProgress]);
  const closeChat = useCallback(() => {
    setChatOpen(false);
    chatProgress.value = withTiming(0, { duration: 340 });
    // As the user walks back to the 3D sidekick, have it get the last word: a
    // snarky one-liner capping off the conversation, over its head. The 500ms
    // beat lets the drawer clear and the camera ease back to HERO first.
    const conversationId = queryClient.getQueryData<{ id: string }>(['chat', 'main'])?.id;
    if (conversationId) {
      fetchCapoff(conversationId)
        .then(({ quip, expression }) => {
          if (quip) {
            setTimeout(() => speak(quip, 4500, expression), 500);
          }
        })
        .catch(() => {}); // silent — no bubble on failure
    }
  }, [chatProgress, queryClient]);

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
  const openShop = useCallback(() => setShopOpen(true), []);
  const closeShop = useCallback(() => setShopOpen(false), []);
  const openGoals = useCallback(() => setGoalsOpen(true), []);
  const closeGoals = useCallback(() => setGoalsOpen(false), []);
  const openAppearance = useCallback(() => setAppearanceOpen(true), []);
  const closeAppearance = useCallback(() => setAppearanceOpen(false), []);
  const closeSettings = useCallback(() => setSettingsOpen(false), []);
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
    void queryClient.invalidateQueries({ queryKey: ['goals', 'list'] });
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
            : chatOpen || settingsOpen || habitOpen
              ? CHAT_FRAMING
              : hero,
    [skyMode, cosmosPanned, mapOpen, shopOpen, appearanceOpen, chatOpen, settingsOpen, habitOpen, hero],
  );

  // The top-right cluster (closet avatar / streak / map pin) is hidden under any
  // full surface. We keep it mounted and toggle `display` instead of unmounting,
  // so the avatar's GL context survives (see the cluster JSX for why).
  const clusterHidden = mapShown || shopOpen || chatOpen || skyMode || habitOpen;

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

  // No opacity here: animating a parent's opacity permanently breaks descendant
  // UIGlassEffect views (expo/expo#41024) — the closed drawer is already fully
  // off-screen via the translate.
  const drawerStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: (1 - chatProgress.value) * (SCREEN_H - DRAWER_TOP) }],
  }));
  // identical to drawerStyle, for the guided habit-add drawer
  const habitDrawerStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: (1 - habitProgress.value) * (SCREEN_H - DRAWER_TOP) }],
  }));

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
      {/* Full-viewport 3D scene (mounted once saved look-dev state hydrates).
          Settings reuses the pulled-back chat framing so the meadow, sky and
          character stay visible above the panel while tuning. */}
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
          overheadActive={!(mapShown || shopOpen || chatOpen || settingsOpen || skyMode || habitOpen)}
          ground={ground}
          dailyBox={boxStage === 'ground' || boxStage === 'rewards' ? (snapshot?.dailyBox.tier ?? null) : null}
        />
      ) : null}

      {/* what the sidekick is saying, over its head (hidden while a full
          surface covers the scene). The bond score lives on the star now. */}
      {settings ? (
        <OverheadSpeech overhead={overhead} hidden={mapShown || shopOpen || chatOpen || settingsOpen || skyMode || habitOpen}>
          <SpeechBubble />
        </OverheadSpeech>
      ) : null}

      {/* the way into a star chat: a star beside the sidekick's head. Hidden
          once every session is done — nothing left to open — and until the
          snapshot lands (we don't know the ladder's position before then). */}
      {settings && snapshot && nextStarChat ? (
        <StarChatButton
          overhead={overhead}
          hidden={mapShown || shopOpen || chatOpen || settingsOpen || skyMode || habitOpen}
          onPress={() => setStarChatOpen(true)}
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
        hidden={clusterHidden}
        paused={appearanceOpen || clusterHidden}
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
          flexDirection: 'row',
          gap: 8,
          alignItems: 'center',
          opacity: clusterHidden ? 0 : 1,
        }}
        pointerEvents={clusterHidden ? 'none' : 'box-none'}
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
        {unseenIsland ? (
          <View
            pointerEvents="none"
            style={{ position: 'absolute', top: -2, right: -2, width: 15, height: 15, borderRadius: 8, backgroundColor: '#FF3B30', borderWidth: 2, borderColor: 'rgba(255,255,255,0.9)' }}
          />
        ) : null}
      </View>

      {/* iOS-style home dock — the sheets slide up OVER it; only the
          full-screen map reveal hides it */}
      <HomeDock
        hidden={mapShown || skyMode}
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
      {settings && !mapShown && !shopOpen && !chatOpen && !settingsOpen && !skyMode && !habitOpen ? (
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

      {/* Look-dev settings sheet — compact so the scene stays visible above it;
          every control tick applies to the live scene */}
      {settingsOpen ? (
        <Pressable
          onPress={() => setSettingsOpen(false)}
          accessibilityLabel="Close settings"
          style={{ position: 'absolute', top: 0, left: 0, right: 0, height: SCREEN_H * 0.5, zIndex: 20 }}
        />
      ) : null}
      {settings ? (
        <SettingsSheet
          open={settingsOpen}
          onClose={closeSettings}
          controller={controller}
          settings={settings}
          onSettingsChange={setSettings}
        />
      ) : null}

      {/* Chat drawer — slides over the lower ~75%, undimmed so the mascot
          (holding its phone) stays visible in the band above; tap that band
          to close */}
      {chatOpen ? (
        <Pressable
          onPress={closeChat}
          accessibilityLabel="Close chat"
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            height: DRAWER_TOP,
            zIndex: 30,
          }}
        />
      ) : null}
      <Animated.View
        style={[
          drawerStyle,
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
        <ChatScreen onClose={closeChat} onOpenGame={setActiveMatchId} />
      </Animated.View>

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
