import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GuiColor, GuiFolder, GuiSelect, GuiSlider, GuiToggle } from '../src/components/gui-panel';
import { SidekickCanvas } from '../src/components/SidekickCanvas';
import { homeFraming, type SidekickController } from '../src/three/renderer';
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

// Full look-dev editor. The scene renders inside a fixed iPhone-aspect (9:16)
// viewport so what you tune is framed exactly as the app shows it; ALL config
// lives in a scrolling panel to the SIDE of the viewport (no controls over the
// scene). Edits apply to the live scene every tick and persist (debounced) to the
// same AsyncStorage keys the app reads. Folders group each area of the look.

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const C = { bg: '#1a1a1a', header: '#111', text: '#ebebeb' };

const TIME_OPTS = TIMES.map((t) => ({ id: t, name: t }));

export default function SidekickLookEditor() {
  const insets = useSafeAreaInsets();
  const { width: winW, height: winH } = useWindowDimensions();
  const [controller, setController] = useState<SidekickController | null>(null);
  const [settings, setSettings] = useState<SidekickSettings | null>(null);
  const [cosmetics, setCosmetics] = useState<CosmeticsControls | null>(null);
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [wardrobe, setWardrobe] = useState<Wardrobe | null>(null);

  // saved look-dev state must hydrate BEFORE the GL scene builds from it
  useEffect(() => {
    hydrateSettings().then(() => setSettings(loadSettings()));
  }, []);

  // once cosmetics load, snapshot the manifest + worn state for the equipment area
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

  // config panel to the side; the viewport is a real iPhone resolution (Chrome
  // DevTools "iPhone 12/13/14" = 390×844 CSS px), shown 1:1 when it fits and
  // scaled down proportionally (same aspect) when the window is smaller.
  const PANEL_W = winW < 720 ? Math.round(winW * 0.46) : 340;
  const DEVICE_W = 390;
  const DEVICE_H = 844;
  const availW = Math.max(120, winW - PANEL_W - 32);
  const availH = Math.max(120, winH - insets.top - insets.bottom - 24);
  const vpScale = Math.min(1, availW / DEVICE_W, availH / DEVICE_H);
  const vpW = Math.round(DEVICE_W * vpScale);
  const vpH = Math.round(DEVICE_H * vpScale);

  return (
    <View style={{ flex: 1, backgroundColor: '#0b0b0d', flexDirection: 'row', paddingTop: insets.top }}>
      {/* iPhone-aspect (9:16) viewport, centred in the space left of the panel */}
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <View
          style={{
            width: vpW,
            height: vpH,
            borderRadius: 16,
            overflow: 'hidden',
            borderWidth: 1,
            borderColor: '#2a2a2e',
            backgroundColor: '#000',
          }}
        >
          {s ? (
            <SidekickCanvas
              style={{ width: vpW, height: vpH }}
              framing={homeFraming(s.fov, s.camDist ?? 4.2, s.camHeight ?? 0)}
              onController={setController}
              onControls={setCosmetics}
            />
          ) : null}
        </View>
      </View>

      {/* ALL config, on the side, outside the viewport */}
      <View style={{ width: PANEL_W, backgroundColor: C.bg, borderLeftWidth: 1, borderLeftColor: '#000' }}>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
            paddingHorizontal: 10,
            paddingVertical: 8,
            backgroundColor: C.header,
          }}
        >
          <Pressable onPress={() => router.back()} accessibilityLabel="Done" style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
            <Ionicons name="chevron-back" size={16} color="#fff" />
            <Text style={{ color: '#fff', fontSize: 13, fontWeight: '700' }}>Done</Text>
          </Pressable>
          <Text style={{ color: C.text, fontSize: 12, fontWeight: '700' }}>Sidekick 3D</Text>
          <View style={{ flex: 1 }} />
          <Pressable
            onPress={() => {
              const next = resetSettings();
              setSettings(next);
              controller?.applySettings(clone(next));
            }}
            style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, backgroundColor: '#333' }}
          >
            <Text style={{ color: '#fff', fontSize: 12, fontWeight: '700' }}>Reset defaults</Text>
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 28 }} showsVerticalScrollIndicator={false}>
          {s && sc ? (
            <>
              <GuiFolder title="Camera" defaultOpen>
                <GuiSlider label="fov" value={s.fov} min={15} max={70} onChange={(v) => setTop('fov', v)} />
                <GuiSlider label="distance" value={s.camDist ?? 4.2} min={2} max={12} onChange={(v) => setTop('camDist', v)} />
                <GuiSlider label="height" value={s.camHeight ?? 0} min={-1.5} max={1.5} onChange={(v) => setTop('camHeight', v)} />
              </GuiFolder>

              <GuiFolder title="Depth of Field">
                <GuiSlider label="aperture" value={s.dofAperture} min={0} max={0.006} onChange={(v) => setTop('dofAperture', v)} />
                <GuiSlider label="max blur" value={s.dofMaxblur} min={0} max={0.03} onChange={(v) => setTop('dofMaxblur', v)} />
                <GuiSlider label="focus offset" value={s.dofFocus} min={-6} max={6} onChange={(v) => setTop('dofFocus', v)} />
              </GuiFolder>

              <GuiFolder title="Backdrop">
                <GuiSlider label="hill x" value={s.hillX} min={-14} max={14} onChange={(v) => setTop('hillX', v)} />
                <GuiSlider label="hill z" value={s.hillZ} min={-28} max={-4} onChange={(v) => setTop('hillZ', v)} />
                <GuiSlider label="hill radius" value={s.hillRadius} min={3} max={18} onChange={(v) => setTop('hillRadius', v)} />
                <GuiSlider label="flatten" value={s.hillFlat} min={0.2} max={1} onChange={(v) => setTop('hillFlat', v)} />
                <GuiSlider label="sink" value={s.hillSink} min={0} max={8} onChange={(v) => setTop('hillSink', v)} />
                <GuiColor label="hill color" value={s.hillColor} onChange={(v) => setTop('hillColor', v)} />
                <GuiSlider label="ridge height" value={s.ridgeHeight ?? 1} min={0.2} max={2.5} onChange={(v) => setTop('ridgeHeight', v)} />
                <GuiSlider label="ridge haze" value={s.ridgeHaze ?? 1} min={0} max={1.6} onChange={(v) => setTop('ridgeHaze', v)} />
                <GuiSlider label="ridge depth" value={s.ridgeDepth ?? 1} min={0.6} max={1.8} onChange={(v) => setTop('ridgeDepth', v)} />
              </GuiFolder>

              {/* Everything that varies with time of day. The "scene" picker switches
                  which preset (day / evening / night) every control below edits. */}
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
                <GuiColor label="backlight color" value={s.celRimColor} onChange={(v) => setTop('celRimColor', v)} />
                <GuiSlider label="backlight opacity" value={s.celRimStrength} min={0} max={1} onChange={(v) => setTop('celRimStrength', v)} />
                <GuiSlider label="backlight width" value={s.celRimWidth} min={0} max={1} onChange={(v) => setTop('celRimWidth', v)} />
                <GuiToggle label="outline" value={s.outline} onChange={(v) => setTop('outline', v)} />
                <GuiSlider label="outline width" value={s.outlineWidth} min={0} max={0.02} onChange={(v) => setTop('outlineWidth', v)} />
                <GuiColor label="outline color" value={s.outlineColor} onChange={(v) => setTop('outlineColor', v)} />
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

              {/* Equipment — same side panel, below the look controls */}
              {manifest && wardrobe
                ? WARDROBE_SLOTS.map((slot) => {
                    const def = manifest[slot];
                    if (!def) return null;
                    const st = wardrobe[slot];
                    const worn = !!st?.equipped;
                    const activeVariant = worn && !st?.color ? st?.variantId : undefined;
                    return (
                      <GuiFolder key={slot} title={`Equip · ${SLOT_LABEL[slot]}`}>
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
                  })
                : null}
            </>
          ) : null}
        </ScrollView>
      </View>
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
