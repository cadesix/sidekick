import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { Dimensions, Pressable, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { Chat } from '../src/components/Chat';
import { HomeDock } from '../src/components/HomeDock';
import { SettingsSheet } from '../src/components/SettingsSheet';
import { ShopSheet } from '../src/components/ShopSheet';
import { SidekickCanvas } from '../src/components/SidekickCanvas';
import { WorldMap } from '../src/components/WorldMap';
import type { Framing, SidekickController } from '../src/three/renderer';
import { hydrateSettings, loadSettings, type SidekickSettings } from '../src/three/settings';
import type { CosmeticsControls } from '../src/three/wardrobe';
import { useChat } from '../src/store/chat';

// RN port of sidekick/src/home4.tsx: full-viewport 3D mascot with an iOS-style
// dock. Messages slides the chat drawer up over the lower ~55% (camera eases to
// CHAT_FRAMING, mascot holds its phone), Shop swaps the meadow for a studio and
// opens the wardrobe sheet, Map rockets the camera up while the world map
// circle-reveals over it.

const HERO_FRAMING: Framing = {
  pos: [0, 0.66, 4.2],
  target: [0, 0.56, 0],
  fov: 41.1,
};

const CHAT_FRAMING: Framing = {
  pos: [0, 1.0, 7.7],
  target: [0, -0.55, 0],
  fov: 31,
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

const { height: SCREEN_H } = Dimensions.get('window');
const DRAWER_TOP = SCREEN_H * 0.45; // drawer covers the lower 55%

export default function Home() {
  const [open, setOpen] = useState(false);
  // mapOpen drives the camera pull-back; mapShown drives the map's circle
  // reveal, a beat later, so the camera starts flying out before the map grows.
  const [mapOpen, setMapOpen] = useState(false);
  const [mapShown, setMapShown] = useState(false);
  const [shopOpen, setShopOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
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
  const loading = useChat((s) => s.loading);

  // 0 = closed (drawer off-screen), 1 = open
  const progress = useSharedValue(0);

  const openDrawer = () => {
    setOpen(true);
    progress.value = withTiming(1, { duration: 380 });
  };
  const closeDrawer = () => {
    setOpen(false);
    progress.value = withTiming(0, { duration: 340 });
  };

  const openMap = () => {
    setMapOpen(true); // camera rockets up + back immediately
    setTimeout(() => setMapShown(true), 60); // circle mask starts expanding almost right away
  };
  const closeMap = () => {
    setMapShown(false); // map scales back out…
    setMapOpen(false); // …while the camera flies back to the meadow
  };

  const drawerStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: (1 - progress.value) * (SCREEN_H - DRAWER_TOP) }],
    opacity: progress.value < 0.02 ? 0 : 1,
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
              : shopOpen
                ? SHOP_FRAMING
                : open || settingsOpen
                  ? CHAT_FRAMING
                  : HERO_FRAMING
          }
          holdingPhone={open}
          talking={loading}
          studio={shopOpen}
          onControls={setControls}
          onController={setController}
        />
      ) : null}

      {/* Tap the character band above the drawer to close */}
      {open ? (
        <Pressable
          onPress={closeDrawer}
          style={{ position: 'absolute', top: 0, left: 0, right: 0, height: DRAWER_TOP }}
        />
      ) : null}

      {/* iOS-style home dock — the sheets slide up OVER it; only the
          full-screen map reveal hides it */}
      <HomeDock
        hidden={mapShown}
        onMessages={openDrawer}
        onShop={() => setShopOpen(true)}
        onMap={openMap}
        onSettings={() => setSettingsOpen(true)}
      />

      {/* Full-screen world map — scales in from centre while the camera pulls
          away behind it */}
      <WorldMap
        open={mapShown}
        onClose={closeMap}
        onChat={() => {
          closeMap();
          openDrawer();
        }}
      />

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

      {/* Chat drawer */}
      <Animated.View
        style={[
          drawerStyle,
          { position: 'absolute', left: 0, right: 0, top: DRAWER_TOP, bottom: 0, zIndex: 40 },
        ]}
        pointerEvents={open ? 'auto' : 'none'}
      >
        {/* keyboard avoidance lives inside Chat (animated padding driven by
            keyboard frame events — KAV can't measure inside this translated
            absolute drawer) */}
        <Pressable
          onPress={closeDrawer}
          className="absolute top-2.5 right-3 z-20 w-9 h-9 rounded-full bg-white/85 items-center justify-center"
        >
          <Ionicons name="chevron-down" size={20} color="rgba(17,17,17,0.6)" />
        </Pressable>
        <Chat transparentTop />
      </Animated.View>
    </View>
  );
}
