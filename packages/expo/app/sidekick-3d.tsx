import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GuiColor, GuiFolder, GuiPanel, GuiSelect, GuiSlider, GuiToggle } from '../src/components/gui-panel';
import { SidekickCanvas } from '../src/components/SidekickCanvas';
import type { Framing, SidekickController } from '../src/three/renderer';
import {
  hydrateSettings,
  loadSettings,
  resetSettings,
  saveSettings,
  TIMES,
  type ScenePreset,
  type SidekickSettings,
  type TimeOfDay,
} from '../src/three/settings';
import {
  type CosmeticsControls,
  SHOP_COLORS,
  SLOT_LABEL,
  WARDROBE_SLOTS,
  type Wardrobe,
} from '../src/three/wardrobe';
import type { Manifest } from '../src/three/cosmetics-manifest';

// Full look-dev editor — the RN rebuild of the web's /sidekick-3d lil-gui page.
// Two dark panels dock to the screen edges over the live scene: the main
// "Sidekick 3D" config panel on the RIGHT (folders for camera / scene / grass /
// character / lighting / bloom / pose) and an "Equipment" panel on the LEFT,
// exactly as the web editor placed them. Edits apply to the live scene every
// tick and persist (debounced) to the same AsyncStorage keys the app reads.

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

// Editor camera: frame the character between the two edge panels. fov is a live
// setting (the FOV slider drives it through this framing).
function editFraming(fov: number): Framing {
  return { pos: [0, 0.72, 6.2], target: [0, -0.05, 0], fov };
}

const TIME_OPTS = TIMES.map((t) => ({ id: t, name: t }));

export default function SidekickLookEditor() {
  const insets = useSafeAreaInsets();
  const [controller, setController] = useState<SidekickController | null>(null);
  const [settings, setSettings] = useState<SidekickSettings | null>(null);
  const [cosmetics, setCosmetics] = useState<CosmeticsControls | null>(null);
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [wardrobe, setWardrobe] = useState<Wardrobe | null>(null);

  // saved look-dev state must hydrate BEFORE the GL scene builds from it
  useEffect(() => {
    hydrateSettings().then(() => setSettings(loadSettings()));
  }, []);

  // once cosmetics load, snapshot the manifest + worn state for the left panel
  useEffect(() => {
    if (!cosmetics) return;
    setManifest(cosmetics.manifest());
    setWardrobe(cosmetics.getState());
  }, [cosmetics]);

  // debounce settings persistence; the live scene updates every tick regardless
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const apply = (next: SidekickSettings) => {
    setSettings(next);
    controller?.applySettings(clone(next));
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => saveSettings(next), 400);
  };

  const s = settings;
  const sc = s ? s.scenes[s.timeOfDay] : null;

  const setTop = <K extends keyof SidekickSettings>(k: K, v: SidekickSettings[K]) => {
    if (!s) return;
    const next = clone(s);
    next[k] = v;
    apply(next);
  };
  const setScene = <K extends keyof ScenePreset>(k: K, v: ScenePreset[K]) => {
    if (!s) return;
    const next = clone(s);
    next.scenes[next.timeOfDay][k] = v;
    apply(next);
  };

  // equipment mutations go straight through the cosmetics handle (they persist
  // the wardrobe + dress the live character), then we re-read worn state
  const syncWorn = () => cosmetics && setWardrobe(cosmetics.getState());
  const toggleSlot = (slot: (typeof WARDROBE_SLOTS)[number], on: boolean) => {
    if (!cosmetics) return;
    if (on) {
      const first = manifest?.[slot]?.variants[0]?.id;
      if (first) cosmetics.equipVariant(slot, first);
    } else {
      cosmetics.remove(slot);
    }
    syncWorn();
  };

  return (
    <View className="flex-1 bg-black">
      {/* live scene fills the screen; the two panels float over its edges */}
      {s ? (
        <SidekickCanvas
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
          framing={editFraming(s.fov)}
          onController={setController}
          onControls={setCosmetics}
        />
      ) : null}

      {/* top-center floating controls (the panels own the corners) */}
      <View
        style={{ position: 'absolute', top: insets.top + 8, left: 0, right: 0, alignItems: 'center', zIndex: 60 }}
        pointerEvents="box-none"
      >
        <View className="flex-row items-center" style={{ gap: 8 }}>
          <Pressable
            onPress={() => router.back()}
            accessibilityLabel="Back"
            className="h-9 px-3 rounded-full bg-black/45 items-center justify-center flex-row"
            style={{ gap: 3 }}
          >
            <Ionicons name="chevron-back" size={16} color="#fff" />
            <Text className="text-[13px] font-semibold text-white">Done</Text>
          </Pressable>
          <Pressable
            onPress={() => {
              const next = resetSettings();
              setSettings(next);
              controller?.applySettings(clone(next));
            }}
            className="h-9 px-3 rounded-full bg-black/45 items-center justify-center"
          >
            <Text className="text-[13px] font-semibold text-white">Reset</Text>
          </Pressable>
        </View>
      </View>

      {/* RIGHT — main config, mirrors the web "Sidekick 3D" panel */}
      {s && sc ? (
        <GuiPanel side="right" title="Sidekick 3D">
          <GuiFolder title="Camera" defaultOpen>
            <GuiSlider label="fov" value={s.fov} min={15} max={70} onChange={(v) => setTop('fov', v)} />
          </GuiFolder>

          <GuiFolder title="Time of Day" defaultOpen>
            <GuiSelect label="scene" value={s.timeOfDay} options={TIME_OPTS} onChange={(id) => setTop('timeOfDay', id as TimeOfDay)} />
            <GuiColor label="sky top" value={sc.skyTop} onChange={(v) => setScene('skyTop', v)} />
            <GuiColor label="sky mid" value={sc.skyMid} onChange={(v) => setScene('skyMid', v)} />
            <GuiColor label="sky horizon" value={sc.skyHorizon} onChange={(v) => setScene('skyHorizon', v)} />
            <GuiColor label="fog color" value={sc.fog} onChange={(v) => setScene('fog', v)} />
            <GuiSlider label="fog near" value={sc.fogNear} min={0} max={40} onChange={(v) => setScene('fogNear', v)} />
            <GuiSlider label="fog far" value={sc.fogFar} min={5} max={120} onChange={(v) => setScene('fogFar', v)} />
            <GuiColor label="grass hill" value={sc.grassHill} onChange={(v) => setScene('grassHill', v)} />
            <GuiColor label="grass base" value={sc.grassBase} onChange={(v) => setScene('grassBase', v)} />
            <GuiColor label="grass tip" value={sc.grassTip} onChange={(v) => setScene('grassTip', v)} />
            <GuiColor label="rock color" value={sc.rock} onChange={(v) => setScene('rock', v)} />
            <GuiColor label="char tint" value={sc.charTint} onChange={(v) => setScene('charTint', v)} />
            <GuiColor label="shade color" value={sc.shadeColor} onChange={(v) => setScene('shadeColor', v)} />
          </GuiFolder>

          <GuiFolder title="Environment">
            <GuiSlider label="grass height" value={s.grassHeight} min={0.3} max={2.5} onChange={(v) => setTop('grassHeight', v)} />
            <GuiSlider label="grass clumping" value={s.grassClumping} min={0} max={1} onChange={(v) => setTop('grassClumping', v)} />
          </GuiFolder>

          <GuiFolder title="Face">
            <GuiSlider label="face size" value={s.faceZoom} min={0.8} max={1.5} onChange={(v) => setTop('faceZoom', v)} />
            <GuiSlider label="face height" value={s.faceHeight} min={-0.5} max={0.6} onChange={(v) => setTop('faceHeight', v)} />
          </GuiFolder>

          <GuiFolder title="Cel Shading">
            <GuiColor label="body color" value={s.celBodyColor} onChange={(v) => setTop('celBodyColor', v)} />
            <GuiColor label="shadow color" value={s.celShadowColor} onChange={(v) => setTop('celShadowColor', v)} />
            <GuiSlider label="softness" value={s.celSoftness} min={0} max={1} onChange={(v) => setTop('celSoftness', v)} />
            <GuiSlider label="shadow amount" value={s.celShadowAmt} min={0} max={1} onChange={(v) => setTop('celShadowAmt', v)} />
            <GuiToggle label="outline" value={s.outline} onChange={(v) => setTop('outline', v)} />
            <GuiSlider label="outline width" value={s.outlineWidth} min={0} max={0.02} onChange={(v) => setTop('outlineWidth', v)} />
            <GuiColor label="outline color" value={s.outlineColor} onChange={(v) => setTop('outlineColor', v)} />
          </GuiFolder>

          <GuiFolder title="Lighting">
            <GuiColor label="key color" value={sc.keyColor} onChange={(v) => setScene('keyColor', v)} />
            <GuiSlider label="key intensity" value={sc.keyIntensity} min={0} max={4} onChange={(v) => setScene('keyIntensity', v)} />
            <GuiColor label="fill color" value={sc.fillColor} onChange={(v) => setScene('fillColor', v)} />
            <GuiSlider label="fill intensity" value={sc.fillIntensity} min={0} max={3} onChange={(v) => setScene('fillIntensity', v)} />
            <GuiColor label="rim color" value={sc.rimColor} onChange={(v) => setScene('rimColor', v)} />
            <GuiSlider label="rim intensity" value={sc.rimIntensity} min={0} max={4} onChange={(v) => setScene('rimIntensity', v)} />
            <GuiColor label="hemi sky" value={sc.hemiSky} onChange={(v) => setScene('hemiSky', v)} />
            <GuiColor label="hemi ground" value={sc.hemiGround} onChange={(v) => setScene('hemiGround', v)} />
            <GuiSlider label="hemi intensity" value={sc.hemiIntensity} min={0} max={2} onChange={(v) => setScene('hemiIntensity', v)} />
            <GuiSlider label="exposure" value={sc.exposure} min={0.3} max={2.5} onChange={(v) => setScene('exposure', v)} />
          </GuiFolder>

          <GuiFolder title="Bloom">
            <GuiToggle label="enabled" value={s.bloomEnabled} onChange={(v) => setTop('bloomEnabled', v)} />
            <GuiSlider label="strength" value={s.bloomStrength} min={0} max={1.5} onChange={(v) => setTop('bloomStrength', v)} />
            <GuiSlider label="radius" value={s.bloomRadius} min={0} max={1} onChange={(v) => setTop('bloomRadius', v)} />
            <GuiSlider label="threshold" value={s.bloomThreshold} min={0} max={1} onChange={(v) => setTop('bloomThreshold', v)} />
          </GuiFolder>

          <GuiFolder title="Pose">
            <GuiSlider label="arm drop" value={s.poseArmDown} min={0} max={1.6} onChange={(v) => setTop('poseArmDown', v)} />
            <GuiSlider label="palm roll" value={s.poseArmTwist} min={-3.2} max={3.2} onChange={(v) => setTop('poseArmTwist', v)} />
            <GuiSlider label="roll split" value={s.poseRollSplit} min={0} max={1} onChange={(v) => setTop('poseRollSplit', v)} />
            <GuiSlider label="arms forward" value={s.poseArmForward} min={-0.8} max={0.8} onChange={(v) => setTop('poseArmForward', v)} />
            <GuiSlider label="elbow bend" value={s.poseForeBend} min={-1} max={1} onChange={(v) => setTop('poseForeBend', v)} />
          </GuiFolder>
        </GuiPanel>
      ) : null}

      {/* LEFT — equipment, mirrors the web "Equipment" panel */}
      {manifest && wardrobe ? (
        <GuiPanel side="left" title="Equipment">
          {WARDROBE_SLOTS.map((slot) => {
            const def = manifest[slot];
            if (!def) return null;
            const st = wardrobe[slot];
            const worn = !!st?.equipped;
            const activeVariant = worn && !st?.color ? st?.variantId : undefined;
            return (
              <GuiFolder key={slot} title={SLOT_LABEL[slot]} defaultOpen={slot === 'shirt'}>
                <GuiToggle label="equip" value={worn} onChange={(v) => toggleSlot(slot, v)} />
                <GuiSelect
                  label="variant"
                  value={activeVariant ?? ''}
                  options={def.variants}
                  onChange={(id) => {
                    cosmetics?.equipVariant(slot, id);
                    syncWorn();
                  }}
                />
                <SwatchRow
                  active={worn ? st?.color : undefined}
                  onPick={(c) => {
                    cosmetics?.setColor(slot, c);
                    syncWorn();
                  }}
                />
              </GuiFolder>
            );
          })}
        </GuiPanel>
      ) : null}
    </View>
  );
}

// dark color-swatch grid (the solid-color override offered per slot)
function SwatchRow({ active, onPick }: { active?: string; onPick: (c: string) => void }) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 5, paddingHorizontal: 8, paddingVertical: 4 }}>
      {SHOP_COLORS.map((c) => {
        const on = active?.toLowerCase() === c.toLowerCase();
        return (
          <Pressable
            key={c}
            onPress={() => onPick(c)}
            accessibilityLabel={c}
            style={{
              width: 18,
              height: 18,
              borderRadius: 3,
              backgroundColor: c,
              borderWidth: on ? 2 : 1,
              borderColor: on ? '#2cc9ff' : '#000',
            }}
          />
        );
      })}
    </View>
  );
}
