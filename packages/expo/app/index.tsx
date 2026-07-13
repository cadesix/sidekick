import { useEffect, useState } from 'react';
import { Dimensions, Pressable, View } from 'react-native';

import { HomeDock } from '../src/components/HomeDock';
import { SettingsSheet } from '../src/components/SettingsSheet';
import { ShopSheet } from '../src/components/ShopSheet';
import { SidekickCanvas } from '../src/components/SidekickCanvas';
import { WorldMap } from '../src/components/WorldMap';
import { ChatSheet } from '../src/features/chat/ChatSheet';
import { AuthGate } from '../src/lib/auth';
import type { Framing, SidekickController } from '../src/three/renderer';
import { hydrateSettings, loadSettings, type SidekickSettings } from '../src/three/settings';
import type { CosmeticsControls } from '../src/three/wardrobe';

// RN port of sidekick/src/home4.tsx: full-viewport 3D mascot with an iOS-style
// dock. Messages opens the full chat sheet (camera eases to CHAT_FRAMING, the
// mascot holds its phone under the sheet's header art), Shop swaps the meadow
// for a studio and opens the wardrobe sheet, Map rockets the camera up while
// the world map circle-reveals over it.

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

export default function Home() {
  const [chatOpen, setChatOpen] = useState(false);
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

  const openMap = () => {
    setMapOpen(true); // camera rockets up + back immediately
    setTimeout(() => setMapShown(true), 60); // circle mask starts expanding almost right away
  };
  const closeMap = () => {
    setMapShown(false); // map scales back out…
    setMapOpen(false); // …while the camera flies back to the meadow
  };

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
                : chatOpen || settingsOpen
                  ? CHAT_FRAMING
                  : HERO_FRAMING
          }
          holdingPhone={chatOpen}
          studio={shopOpen}
          onControls={setControls}
          onController={setController}
        />
      ) : null}

      {/* iOS-style home dock — the sheets slide up OVER it; only the
          full-screen map reveal hides it */}
      <HomeDock
        hidden={mapShown}
        onMessages={() => setChatOpen(true)}
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
          setChatOpen(true);
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

      {/* Chat sheet — full-screen, self-animating; AuthGate owns the register/
          retry states so an unreachable server never blocks the 3D home */}
      {chatOpen ? (
        <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 40 }}>
          <AuthGate>
            <ChatSheet onClose={() => setChatOpen(false)} />
          </AuthGate>
        </View>
      ) : null}
    </View>
  );
}
