import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { memo, useRef, useState } from 'react';
import { Dimensions, Pressable, ScrollView, Switch, Text, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { SidekickController } from '../three/renderer';
import {
  resetSettings,
  saveSettings,
  TIMES,
  type ScenePreset,
  type SidekickSettings,
  type TimeOfDay,
} from '../three/settings';
import { ColorRow, SliderRow } from './look-controls';

// Mobile look-dev panel — the in-app analog of the web's /sidekick-3d lil-gui
// editor, organized into tabs. Opens as a COMPACT bottom sheet (~45%) with the
// camera pulled back so the meadow, sky, clouds and character stay visible
// above it: every control tick calls controller.applySettings() on the live
// scene. Color rows open a lil-gui-style picker in a MODAL (bottom-anchored so
// the scene stays visible) — in-list pickers fought the ScrollView for the
// gesture. Edits persist to AsyncStorage under the web's settings key.

const SHEET_H = Math.round(Dimensions.get('window').height * 0.45);

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

const TABS = ['Scene', 'Grass', 'Char', 'Pose', 'Light', 'FX'] as const;
type Tab = (typeof TABS)[number];

export const SettingsSheet = memo(SettingsSheetImpl);
function SettingsSheetImpl({
  open,
  onClose,
  controller,
  settings,
  onSettingsChange,
}: {
  open: boolean;
  onClose: () => void;
  controller: SidekickController | null;
  settings: SidekickSettings;
  onSettingsChange: (s: SidekickSettings) => void;
}) {
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<Tab>('Scene');
  const progress = useSharedValue(0);
  progress.value = withTiming(open ? 1 : 0, { duration: 300 });
  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: (1 - progress.value) * SHEET_H }],
  }));

  // debounce persistence; the live scene updates on every tick regardless
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const apply = (next: SidekickSettings) => {
    onSettingsChange(next);
    controller?.applySettings(clone(next));
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => saveSettings(next), 400);
  };

  const s = settings;
  const sc = s.scenes[s.timeOfDay];

  const setTop = <K extends keyof SidekickSettings>(k: K, v: SidekickSettings[K]) => {
    const next = clone(s);
    next[k] = v;
    apply(next);
  };
  const setScene = <K extends keyof ScenePreset>(k: K, v: ScenePreset[K]) => {
    const next = clone(s);
    next.scenes[next.timeOfDay][k] = v;
    apply(next);
  };

  return (
    <Animated.View
      style={[
        sheetStyle,
        { position: 'absolute', left: 0, right: 0, bottom: 0, height: SHEET_H, zIndex: 40 },
      ]}
      pointerEvents={open ? 'auto' : 'none'}
    >
      <View
        className="flex-1 bg-white"
        style={{
          borderTopLeftRadius: 28,
          borderTopRightRadius: 28,
          shadowColor: '#000',
          shadowOffset: { width: 0, height: -8 },
          shadowOpacity: 0.22,
          shadowRadius: 20,
          elevation: 12,
        }}
      >
        {/* grabber + header */}
        <View className="px-5 pt-3">
          <View className="self-center h-1.5 w-10 rounded-full bg-neutral-200" />
          <View className="mt-1.5 flex-row items-center justify-between">
            <Text className="text-[20px] font-extrabold text-neutral-900">Look</Text>
            <View className="flex-row items-center" style={{ gap: 8 }}>
              <Pressable
                onPress={() => {
                  onClose();
                  router.push('/sidekick-3d');
                }}
                className="h-9 px-3 rounded-full bg-neutral-100 items-center justify-center flex-row"
                style={{ gap: 4 }}
              >
                <Text className="text-[13px] font-semibold text-neutral-600">Full editor</Text>
                <Ionicons name="open-outline" size={14} color="#525252" />
              </Pressable>
              <Pressable
                onPress={() => {
                  const next = resetSettings();
                  onSettingsChange(next);
                  controller?.applySettings(clone(next));
                }}
                className="h-9 px-3 rounded-full bg-neutral-100 items-center justify-center"
              >
                <Text className="text-[13px] font-semibold text-neutral-500">Reset</Text>
              </Pressable>
              <Pressable
                onPress={onClose}
                accessibilityLabel="Close settings"
                className="h-9 w-9 rounded-full bg-neutral-100 items-center justify-center"
              >
                <Ionicons name="close" size={20} color="#737373" />
              </Pressable>
            </View>
          </View>
        </View>

        {/* tabs */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          className="mt-2 shrink-0 grow-0"
          contentContainerStyle={{ gap: 8, paddingHorizontal: 20 }}
        >
          {TABS.map((t) => (
            <Pressable
              key={t}
              onPress={() => setTab(t)}
              className={`rounded-full px-4 py-2 ${tab === t ? 'bg-neutral-900' : 'bg-neutral-100'}`}
            >
              <Text className={`text-[14px] font-bold ${tab === t ? 'text-white' : 'text-neutral-600'}`}>
                {t}
              </Text>
            </Pressable>
          ))}
        </ScrollView>

        <ScrollView
          className="flex-1 px-5 pt-3"
          contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 16), gap: 7 }}
          showsVerticalScrollIndicator={false}
        >
          {tab === 'Scene' ? (
            <>
              <View className="flex-row" style={{ gap: 8 }}>
                {TIMES.map((t) => (
                  <Pressable
                    key={t}
                    onPress={() => setTop('timeOfDay', t as TimeOfDay)}
                    className={`rounded-full px-4 py-2 ${s.timeOfDay === t ? 'bg-neutral-900' : 'bg-neutral-100'}`}
                  >
                    <Text
                      className={`text-[14px] font-bold capitalize ${
                        s.timeOfDay === t ? 'text-white' : 'text-neutral-600'
                      }`}
                    >
                      {t}
                    </Text>
                  </Pressable>
                ))}
              </View>
              <ColorRow label="Sky top" value={sc.skyTop} onChange={(v) => setScene('skyTop', v)} />
              <ColorRow label="Sky mid" value={sc.skyMid} onChange={(v) => setScene('skyMid', v)} />
              <ColorRow label="Horizon" value={sc.skyHorizon} onChange={(v) => setScene('skyHorizon', v)} />
              <ColorRow label="Fog" value={sc.fog} onChange={(v) => setScene('fog', v)} />
              <SliderRow label="Fog near" value={sc.fogNear} min={0} max={30} onChange={(v) => setScene('fogNear', v)} />
              <SliderRow label="Fog far" value={sc.fogFar} min={5} max={120} onChange={(v) => setScene('fogFar', v)} />
            </>
          ) : null}

          {tab === 'Grass' ? (
            <>
              <ColorRow label="Hill" value={sc.grassHill} onChange={(v) => setScene('grassHill', v)} />
              <ColorRow label="Base" value={sc.grassBase} onChange={(v) => setScene('grassBase', v)} />
              <ColorRow label="Tip" value={sc.grassTip} onChange={(v) => setScene('grassTip', v)} />
              <ColorRow label="Rock" value={sc.rock} onChange={(v) => setScene('rock', v)} />
              <SliderRow label="Height" value={s.grassHeight} min={0.2} max={2} onChange={(v) => setTop('grassHeight', v)} />
              <SliderRow label="Clumping" value={s.grassClumping} min={0} max={1} onChange={(v) => setTop('grassClumping', v)} />
            </>
          ) : null}

          {tab === 'Char' ? (
            <>
              <ColorRow label="Body" value={s.celBodyColor} onChange={(v) => setTop('celBodyColor', v)} />
              <ColorRow label="Tint" value={sc.charTint} onChange={(v) => setScene('charTint', v)} />
              <ColorRow label="Shade" value={sc.shadeColor} onChange={(v) => setScene('shadeColor', v)} />
              <SliderRow label="Shadow amt" value={s.celShadowAmt} min={0} max={1} onChange={(v) => setTop('celShadowAmt', v)} />
              <SliderRow label="Softness" value={s.celSoftness} min={0} max={1} onChange={(v) => setTop('celSoftness', v)} />
              <SliderRow label="Face zoom" value={s.faceZoom} min={0.8} max={1.5} onChange={(v) => setTop('faceZoom', v)} />
              <SliderRow label="Face height" value={s.faceHeight} min={-0.5} max={0.6} onChange={(v) => setTop('faceHeight', v)} />
              <View className="flex-row items-center justify-between py-1">
                <Text className="text-[14px] text-neutral-600">Outline</Text>
                <Switch value={s.outline} onValueChange={(v) => setTop('outline', v)} />
              </View>
              {s.outline ? (
                <>
                  <ColorRow label="Ink color" value={s.outlineColor} onChange={(v) => setTop('outlineColor', v)} />
                  <SliderRow
                    label="Ink width"
                    value={s.outlineWidth}
                    min={0.001}
                    max={0.03}
                    onChange={(v) => setTop('outlineWidth', v)}
                  />
                </>
              ) : null}
            </>
          ) : null}

          {tab === 'Pose' ? (
            <>
              <SliderRow label="Arm down" value={s.poseArmDown} min={0} max={2} onChange={(v) => setTop('poseArmDown', v)} />
              <SliderRow label="Arm twist" value={s.poseArmTwist} min={-2} max={2} onChange={(v) => setTop('poseArmTwist', v)} />
              <SliderRow label="Arm fwd" value={s.poseArmForward} min={-1} max={1} onChange={(v) => setTop('poseArmForward', v)} />
              <SliderRow label="Fore bend" value={s.poseForeBend} min={-1.5} max={1.5} onChange={(v) => setTop('poseForeBend', v)} />
              <SliderRow label="Roll split" value={s.poseRollSplit} min={0} max={1} onChange={(v) => setTop('poseRollSplit', v)} />
            </>
          ) : null}

          {tab === 'Light' ? (
            <>
              <ColorRow label="Key" value={sc.keyColor} onChange={(v) => setScene('keyColor', v)} />
              <SliderRow label="Key int" value={sc.keyIntensity} min={0} max={3} onChange={(v) => setScene('keyIntensity', v)} />
              <ColorRow label="Fill" value={sc.fillColor} onChange={(v) => setScene('fillColor', v)} />
              <SliderRow label="Fill int" value={sc.fillIntensity} min={0} max={2} onChange={(v) => setScene('fillIntensity', v)} />
              <ColorRow label="Rim" value={sc.rimColor} onChange={(v) => setScene('rimColor', v)} />
              <SliderRow label="Rim int" value={sc.rimIntensity} min={0} max={3} onChange={(v) => setScene('rimIntensity', v)} />
              <ColorRow label="Hemi sky" value={sc.hemiSky} onChange={(v) => setScene('hemiSky', v)} />
              <ColorRow label="Hemi gnd" value={sc.hemiGround} onChange={(v) => setScene('hemiGround', v)} />
              <SliderRow label="Hemi int" value={sc.hemiIntensity} min={0} max={2} onChange={(v) => setScene('hemiIntensity', v)} />
              <SliderRow label="Exposure" value={sc.exposure} min={0.3} max={2.5} onChange={(v) => setScene('exposure', v)} />
            </>
          ) : null}

          {tab === 'FX' ? (
            <>
              <View className="flex-row items-center justify-between py-1">
                <Text className="text-[14px] text-neutral-600">Bloom</Text>
                <Switch value={s.bloomEnabled} onValueChange={(v) => setTop('bloomEnabled', v)} />
              </View>
              {s.bloomEnabled ? (
                <>
                  <SliderRow label="Strength" value={s.bloomStrength} min={0} max={1.5} onChange={(v) => setTop('bloomStrength', v)} />
                  <SliderRow label="Radius" value={s.bloomRadius} min={0} max={1} onChange={(v) => setTop('bloomRadius', v)} />
                  <SliderRow label="Threshold" value={s.bloomThreshold} min={0} max={1} onChange={(v) => setTop('bloomThreshold', v)} />
                </>
              ) : null}
              <Text className="pt-1 text-[12px] leading-4 text-neutral-400">
                Depth-of-field and tilt-shift from the web editor aren’t on mobile yet
                (home4 renders without them on web too).
              </Text>
            </>
          ) : null}
        </ScrollView>
      </View>
    </Animated.View>
  );
}
