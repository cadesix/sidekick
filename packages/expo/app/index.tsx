import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Alert, AppState, Dimensions, Pressable, View, type AppStateStatus } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CHAT_SHEET_DETENT, ChatScreen } from '~/imessage';
import { AppearanceSheet } from '../src/components/AppearanceSheet';
import { OverheadSpeech } from '../src/components/OverheadSpeech';
import { BoxRewardsModal, GroundBox, StreakSplash } from '../src/components/DailyBox';
import { DevPanel } from '../src/components/DevPanel';
import { GoalsSheet } from '../src/components/GoalsSheet';
import { StreakModal } from '../src/components/StreakModal';
import { SessionChat, STAR_FACE_TUNING } from '../src/components/SessionChat';
import { StarChat } from '../src/components/StarChat';
import { StarChatButton } from '../src/components/StarChatButton';
import { useStarChat } from '../src/store/star-chat';
import { useStarFaceConfig } from '../src/store/starFaceConfig';
import { useSidekickContext, type Astral } from '../src/store/context';
import { SidekickAvatar } from '../src/components/SidekickAvatar';
import { SpeechBubble } from '../src/components/SpeechBubble';
import { StreakPill } from '../src/components/StreakPill';
import { HomeDock } from '../src/components/HomeDock';
import { type EnvironmentId } from '../src/three/biomes';
import { speak } from '../src/store/speech';
import { BOND_MAX, nextSession as coreNextSession } from '@sidekick/core';
import { SettingsSheet } from '../src/components/SettingsSheet';
import { ShopSheet } from '../src/components/ShopSheet';
import { SidekickCanvas } from '../src/components/SidekickCanvas';
import { WorldMap } from '../src/components/WorldMap';
import type { Framing, SidekickController } from '../src/three/renderer';
import { hydrateSettings, loadSettings, refreshTimeOfDay, saveSettings, type SidekickSettings } from '../src/three/settings';
import type { CosmeticsControls } from '../src/three/wardrobe';
import { useDeferredFlag } from '../src/lib/useDeferredFlag';
import { claimDailyBox, type BoxContents } from '../src/lib/api';
import { patchBoxClaim, snapshotSessions, useSnapshot } from '../src/lib/state';
import { reconcileWardrobe } from '../src/lib/wardrobe-sync';
import { useCosmeticVersion } from '../src/store/cosmeticVersion';
import { hydrateSkinFromMirror, saveSkinMirror } from '../src/store/skin';

// RN port of sidekick/src/home4.tsx: full-viewport 3D mascot with an iOS-style
// dock. Messages presents the chat as a native sheet over the lower ~75%
// (camera eases to CHAT_FRAMING, the mascot holds its phone in the band above),
// Shop swaps the meadow for a studio and opens the wardrobe sheet, Map rockets
// the camera up while the world map circle-reveals over it.

const HERO_FRAMING: Framing = {
  pos: [0, 0.66, 4.2],
  target: [0, 0.56, 0],
  fov: 41.1,
};

// The chat sheet covers ~82% of the screen (CHAT_SHEET_DETENT), so the mascot
// gets only the thin band at the top. It has to be small: at the old fov 30 / z 6
// the mascot filled ~half the view and overflowed the band. Wider fov + more
// distance shrinks it, and the low target aims down so the head rides near the
// top of frame (= the visible band) rather than centre. Tune-by-eye values.
const CHAT_FRAMING: Framing = {
  pos: [0, 1.4, 7.6],
  target: [0, -1.2, 0],
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

export default function Home() {
  // chatOpen drives the camera/holdingPhone; chatProgress slides the drawer
  const [chatOpen, setChatOpen] = useState(false);
  const chatProgress = useSharedValue(0);
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
  const [streakModalOpen, setStreakModalOpen] = useState(false);
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  // imperative handle the canvas publishes once cosmetics are ready; the Shop
  // uses it to dress the live character
  const [controls, setControls] = useState<CosmeticsControls | null>(null);
  // raw scene controller for the Settings sheet's live look-dev
  const [controller, setController] = useState<SidekickController | null>(null);
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
  // travel to a biome: swap the 3D world, close the map, and drop an arrival
  // line (bubble after the map reveal shrinks so it pops over the visible
  // character) — mirrors home5.tsx onTravel.
  const travelTo = (biome: EnvironmentId) => {
    setEnvironment(biome);
    closeMap();
    const line = TRAVEL_LINES[biome];
    if (line) {
      setTimeout(() => speak(line), 650);
    }
  };
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
  const overhead = { x: overheadX, y: overheadY, visible: overheadVisible };

  // ground-anchor projection for the daily loot chest (canvas writes the chest's
  // on-screen base every frame; GroundBox pins its tap target/FX over it)
  const groundX = useSharedValue(0);
  const groundY = useSharedValue(0);
  const groundVisible = useSharedValue(0);
  const ground = { x: groundX, y: groundY, visible: groundVisible };

  const openChat = () => {
    setChatOpen(true); // camera starts easing while the drawer slides up
    chatProgress.value = withTiming(1, { duration: 380 });
  };
  const closeChat = () => {
    setChatOpen(false);
    chatProgress.value = withTiming(0, { duration: 340 });
  };

  const openMap = () => {
    setMapOpen(true); // camera rockets up + back immediately
    setTimeout(() => setMapShown(true), 60); // circle mask starts expanding almost right away
  };
  const closeMap = () => {
    setMapShown(false); // map scales back out…
    setMapOpen(false); // …while the camera flies back to the meadow
    // they've had their look — retire the unlock notification
    useSidekickContext.getState().clearUnseenIsland();
  };

  // No opacity here: animating a parent's opacity permanently breaks descendant
  // UIGlassEffect views (expo/expo#41024) — the closed drawer is already fully
  // off-screen via the translate.
  const drawerStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: (1 - chatProgress.value) * (SCREEN_H - DRAWER_TOP) }],
  }));

  return (
    <View className="flex-1 bg-white">
      {/* Full-viewport 3D scene (mounted once saved look-dev state hydrates).
          Settings reuses the pulled-back chat framing so the meadow, sky and
          character stay visible above the panel while tuning. */}
      {settings ? (
        <SidekickCanvas
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
          framing={
            skyMode
              ? cosmosPanned
                ? COSMOS_FRAMING // pan up to the sky (after the home beat)
                : HERO_FRAMING // land on home first
              : mapOpen
                ? MAP_FRAMING
                : shopOpen || appearanceOpen
                  ? SHOP_FRAMING
                  : chatOpen || settingsOpen
                    ? CHAT_FRAMING
                    : HERO_FRAMING
          }
          holdingPhone={chatOpen}
          studio={shopOpen || appearanceOpen}
          cosmos={cosmosPanned}
          starFace={starFace}
          environment={environment}
          onControls={setControls}
          onController={setController}
          overhead={overhead}
          ground={ground}
          dailyBox={boxStage === 'ground' || boxStage === 'rewards' ? (snapshot?.dailyBox.tier ?? null) : null}
        />
      ) : null}

      {/* what the sidekick is saying, over its head (hidden while a full
          surface covers the scene). The bond score lives on the star now. */}
      {settings ? (
        <OverheadSpeech overhead={overhead} hidden={mapShown || shopOpen || chatOpen || settingsOpen || skyMode}>
          <SpeechBubble />
        </OverheadSpeech>
      ) : null}

      {/* the way into a star chat: a star beside the sidekick's head. Hidden
          once every session is done — nothing left to open — and until the
          snapshot lands (we don't know the ladder's position before then). */}
      {settings && snapshot && nextStarChat ? (
        <StarChatButton
          overhead={overhead}
          hidden={mapShown || shopOpen || chatOpen || settingsOpen || skyMode}
          onPress={() => setStarChatOpen(true)}
        />
      ) : null}

      {/* top-right cluster: appearance + goals + streak (hidden under surfaces) */}
      {!mapShown && !shopOpen && !chatOpen && !skyMode ? (
        <View
          style={{ position: 'absolute', top: insets.top + 8, right: 16, zIndex: 25, flexDirection: 'row', gap: 8, alignItems: 'center' }}
          pointerEvents="box-none"
        >
          <Pressable
            onPress={() => setAppearanceOpen(true)}
            accessibilityLabel="Appearance"
            style={{ height: 52, width: 52, borderRadius: 26, backgroundColor: 'rgba(255,255,255,0.92)', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}
          >
            {/* the live head avatar IS the closet button (mirrors web home5).
                Freeze it while the Closet is open so its GL context isn't
                competing with the sheet's image load + studio crossfade. */}
            <SidekickAvatar size={52} style={{ transform: [{ scale: 1.1 }] }} paused={appearanceOpen} />
          </Pressable>
          <StreakPill onPress={() => setStreakModalOpen(true)} />
          <Pressable
            onPress={() => router.push('/settings')}
            accessibilityLabel="Settings"
            style={{ height: 52, width: 52, borderRadius: 26, backgroundColor: 'rgba(255,255,255,0.92)', alignItems: 'center', justifyContent: 'center' }}
          >
            <Ionicons name="settings-outline" size={26} color="#404040" />
          </Pressable>
        </View>
      ) : null}

      {/* iOS-style home dock — the sheets slide up OVER it; only the
          full-screen map reveal hides it */}
      <HomeDock
        hidden={mapShown || skyMode}
        mapDot={!!unseenIsland}
        onMessages={openChat}
        onShop={() => setShopOpen(true)}
        onMap={openMap}
        onGoals={() => setGoalsOpen(true)}
      />

      {/* Full-screen world map — scales in from centre while the camera pulls
          away behind it */}
      <WorldMap
        open={mapShown}
        onClose={closeMap}
        onChat={() => {
          closeMap();
          openChat();
        }}
        onTravel={travelTo}
        onStartSession={(id) => {
          closeMap();
          setSessionId(id);
        }}
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
              setTimeout(() => speak(line, 6000), 2600);
              // if the bond isn't full yet, nudge them to keep going — a beat
              // after the astral line so it reads as a second thought
              if ((snapshot?.bond ?? 0) < BOND_MAX) {
                setTimeout(() => speak("let's complete our bond ✦", 5000), 9200);
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
              setTimeout(() => speak(line, 6000), 2600);
              // if there's more of the reading left, invite them back whenever
              if (coreNextSession(sessions)) {
                setTimeout(() => speak('we can do your next astral chat whenever you\'re ready ✦', 5000), 9200);
              }
            }}
          />
        </View>
      ) : null}


      {/* Daily-box flow (home only): streak splash → ground chest → rewards */}
      {settings && !mapShown && !shopOpen && !chatOpen && !settingsOpen && !skyMode ? (
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
      <ShopSheet open={shopOpen} onClose={() => setShopOpen(false)} controls={controls} />

      {/* goals, streak ladder, appearance/closet */}
      <GoalsSheet
        open={goalsOpen}
        onClose={() => setGoalsOpen(false)}
        onTalk={() => {
          setGoalsOpen(false);
          openChat();
        }}
      />
      <StreakModal open={streakModalOpen} onClose={() => setStreakModalOpen(false)} />
      {settings ? (
        <AppearanceSheet
          open={appearanceOpen}
          onClose={() => setAppearanceOpen(false)}
          controls={controls}
          onSkinChange={(next) => {
            setSettings(next);
            controller?.applySettings(next);
          }}
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
          onClose={() => setSettingsOpen(false)}
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
        <ChatScreen onClose={closeChat} />
      </Animated.View>

      {/* DEV state controls (top-left chip → panel); renders nothing in prod */}
      <DevPanel
        onJumpToReveal={() => {
          useStarChat.getState().devSeedArtifact();
          setStarChatOpen(true);
        }}
      />
    </View>
  );
}
