import { useEffect, useState } from 'react';
import { Dimensions, Pressable, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CHAT_SHEET_DETENT, ChatScreen } from '~/imessage';
import { AppearanceSheet } from '../src/components/AppearanceSheet';
import { BondBadge } from '../src/components/BondBadge';
import { BoxRewardsModal, GroundBox, StreakSplash } from '../src/components/DailyBox';
import { DevPanel } from '../src/components/DevPanel';
import { GoalsSheet } from '../src/components/GoalsSheet';
import { StreakModal } from '../src/components/StreakModal';
import { SessionChat } from '../src/components/SessionChat';
import { SidekickAvatar } from '../src/components/SidekickAvatar';
import { SpeechBubble } from '../src/components/SpeechBubble';
import { StreakPill } from '../src/components/StreakPill';
import { HomeDock } from '../src/components/HomeDock';
import { AREA_BIOME, type EnvironmentId } from '../src/three/biomes';
import { useDailyBox } from '../src/store/dailyBox';
import { speak } from '../src/store/speech';
import { useStreak } from '../src/store/streak';
import { boxTier, type BoxReward } from '@sidekick/core';
import { SettingsSheet } from '../src/components/SettingsSheet';
import { ShopSheet } from '../src/components/ShopSheet';
import { SidekickCanvas } from '../src/components/SidekickCanvas';
import { WorldMap } from '../src/components/WorldMap';
import type { Framing, SidekickController } from '../src/three/renderer';
import { hydrateSettings, loadSettings, type SidekickSettings } from '../src/three/settings';
import type { CosmeticsControls } from '../src/three/wardrobe';

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

const CHAT_FRAMING: Framing = {
  pos: [0, 1.2, 6.0],
  target: [0, -0.75, 0],
  fov: 30,
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
  // daily-box flow: streak splash → ground chest → rewards modal → done
  const [boxStage, setBoxStage] = useState<'init' | 'streak' | 'ground' | 'rewards' | 'done'>('init');
  const [boxReward, setBoxReward] = useState<BoxReward | null>(null);
  const [goalsOpen, setGoalsOpen] = useState(false);
  const [streakModalOpen, setStreakModalOpen] = useState(false);
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  // imperative handle the canvas publishes once cosmetics are ready; the Shop
  // uses it to dress the live character
  const [controls, setControls] = useState<CosmeticsControls | null>(null);
  // raw scene controller for the Settings sheet's live look-dev
  const [controller, setController] = useState<SidekickController | null>(null);
  // saved look-dev state must hydrate BEFORE the GL scene builds from it
  const [settings, setSettings] = useState<SidekickSettings | null>(null);
  useEffect(() => {
    hydrateSettings().then(() => setSettings(loadSettings()));
  }, []);
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

  // count today's streak once the store has hydrated (idempotent per local day)
  const streakHydrated = useStreak((s) => s.hydrated);
  const streakCount = useStreak((s) => s.count);
  const dailyBoxHydrated = useDailyBox((s) => s.hydrated);
  useEffect(() => {
    if (streakHydrated) useStreak.getState().touch();
  }, [streakHydrated]);
  // once streak + box have hydrated, open the daily flow if today's box is unclaimed
  useEffect(() => {
    if (boxStage === 'init' && streakHydrated && dailyBoxHydrated) {
      setBoxStage(useDailyBox.getState().hasBox() ? 'streak' : 'done');
    }
  }, [boxStage, streakHydrated, dailyBoxHydrated]);

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
            mapOpen
              ? MAP_FRAMING
              : shopOpen || appearanceOpen
                ? SHOP_FRAMING
                : chatOpen || settingsOpen
                  ? CHAT_FRAMING
                  : HERO_FRAMING
          }
          holdingPhone={chatOpen}
          studio={shopOpen || appearanceOpen}
          environment={environment}
          onControls={setControls}
          onController={setController}
          overhead={overhead}
          ground={ground}
          dailyBox={boxStage === 'ground' || boxStage === 'rewards' ? boxTier(streakCount) : null}
        />
      ) : null}

      {/* bond score floating over the character's head (hidden while a full
          surface covers the scene) */}
      {settings ? (
        <BondBadge overhead={overhead} hidden={mapShown || shopOpen || chatOpen || settingsOpen}>
          <SpeechBubble />
        </BondBadge>
      ) : null}

      {/* top-right cluster: appearance + goals + streak (hidden under surfaces) */}
      {!mapShown && !shopOpen && !chatOpen ? (
        <View
          style={{ position: 'absolute', top: insets.top + 8, right: 16, zIndex: 25, flexDirection: 'row', gap: 8, alignItems: 'center' }}
          pointerEvents="box-none"
        >
          <Pressable
            onPress={() => setAppearanceOpen(true)}
            accessibilityLabel="Appearance"
            style={{ height: 40, width: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.92)', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}
          >
            {/* the live head avatar IS the closet button (mirrors web home5).
                Freeze it while the Closet is open so its GL context isn't
                competing with the sheet's image load + studio crossfade. */}
            <SidekickAvatar size={40} style={{ transform: [{ scale: 1.1 }] }} paused={appearanceOpen} />
          </Pressable>
          <StreakPill onPress={() => setStreakModalOpen(true)} />
        </View>
      ) : null}

      {/* iOS-style home dock — the sheets slide up OVER it; only the
          full-screen map reveal hides it */}
      <HomeDock
        hidden={mapShown}
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

      {/* Guided session — full overlay; on completion travel to its island */}
      {sessionId ? (
        <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 60 }}>
          <SessionChat
            sessionId={sessionId}
            onClose={() => setSessionId(null)}
            onDone={() => {
              const biome = AREA_BIOME[sessionId];
              setSessionId(null);
              if (biome) travelTo(biome);
            }}
          />
        </View>
      ) : null}

      {/* Daily-box flow (home only): streak splash → ground chest → rewards */}
      {settings && !mapShown && !shopOpen && !chatOpen && !settingsOpen && !sessionId ? (
        <>
          {boxStage === 'streak' ? (
            <StreakSplash streak={streakCount} onDone={() => setBoxStage('ground')} />
          ) : null}
          {boxStage === 'ground' ? (
            <View style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, zIndex: 30 }} pointerEvents="box-none">
              <GroundBox
                ground={ground}
                onTap={() => controller?.popDailyBox()}
                onOpened={() => {
                  const db = useDailyBox.getState();
                  setBoxReward(db.claim(streakCount) ?? db.preview(streakCount));
                  setBoxStage('rewards');
                }}
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
      <DevPanel />
    </View>
  );
}
