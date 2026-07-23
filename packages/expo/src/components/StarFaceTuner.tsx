import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { SliderRow } from './look-controls';
import { starFaceSnippet, useStarFaceConfig } from '../store/starFaceConfig';

// TEMPORARY: star-face look-dev (its own file so deleting the tool is one
// file removal plus import cleanup).
// OFF: the tuned numbers are baked into the constants in three/star-face.ts, so
// the chat transcript is back. Flip this to true to dial the sky in live again
// (the sliders start from those same values). To delete the tool for good: this
// flag + StarFaceTuner below, store/starFaceConfig.ts, the renderer's
// setStarFace, and the canvas's starFace prop — the uniforms stay.
export const STAR_FACE_TUNING = false;

export function StarFaceTuner() {
  const cfg = useStarFaceConfig();
  const set = useStarFaceConfig((s) => s.set);
  const reset = useStarFaceConfig((s) => s.reset);
  const [saved, setSaved] = useState(false);
  // Every drag already persists (the store is on AsyncStorage), so this is the
  // last mile: print the values as a paste-ready block for star-face.ts, which is
  // the only way a tuning session actually lands in the code.
  const save = () => {
    console.log('\n' + starFaceSnippet(cfg) + '\n');
    setSaved(true);
    setTimeout(() => setSaved(false), 1600);
  };
  return (
    <ScrollView
      style={{ flex: 1 }}
      className="px-3 pt-3"
      contentContainerStyle={{ paddingBottom: 16 }}
      showsVerticalScrollIndicator={false}
    >
      <View className="flex-row items-center justify-between px-1 pb-1">
        <Text className="text-[11px] font-extrabold uppercase tracking-[2px] text-[#C9BCFF]">
          ✦ star face — temporary
        </Text>
        <View className="flex-row items-center gap-2">
          <Pressable onPress={reset} className="rounded-full bg-white/15 px-3 py-1">
            <Text className="text-[11px] font-bold text-white">reset</Text>
          </Pressable>
          <Pressable onPress={save} className="rounded-full bg-[#7A5AF8] px-3 py-1">
            <Text className="text-[11px] font-bold text-white">{saved ? 'logged ✓' : 'save'}</Text>
          </Pressable>
        </View>
      </View>
      <Text className="px-1 pb-1 text-[10px] text-[#C9BCFF]/60">
        every drag is saved automatically · save prints the constants to the console
      </Text>
      <SliderRow label="Line alpha" value={cfg.lineAlpha} min={0} max={1} onChange={(v) => set('lineAlpha', v)} />
      <SliderRow label="Dust bright" value={cfg.dustWeight} min={0} max={1} onChange={(v) => set('dustWeight', v)} />
      <SliderRow label="Star size" value={cfg.starSize} min={0.3} max={3} onChange={(v) => set('starSize', v)} />
      <SliderRow label="Shine speed" value={cfg.shineSpeed} min={0} max={2} onChange={(v) => set('shineSpeed', v)} />
      <SliderRow label="Shine depth" value={cfg.shineDepth} min={0} max={1} onChange={(v) => set('shineDepth', v)} />
      <SliderRow label="Size" value={cfg.size} min={5} max={30} onChange={(v) => set('size', v)} />
      <SliderRow label="Height" value={cfg.height} min={14} max={40} onChange={(v) => set('height', v)} />
      <SliderRow label="Depth" value={cfg.depth} min={-50} max={-12} onChange={(v) => set('depth', v)} />
      <SliderRow label="Pitch" value={cfg.pitch} min={-0.4} max={1.2} onChange={(v) => set('pitch', v)} />
      <SliderRow label="Pulse pitch" value={cfg.pulseAmt} min={0} max={0.2} onChange={(v) => set('pulseAmt', v)} />
      <SliderRow label="Pulse depth" value={cfg.pulseDepth} min={0} max={4} onChange={(v) => set('pulseDepth', v)} />
      <SliderRow label="Pulse rate" value={cfg.pulseHz} min={0.01} max={0.3} onChange={(v) => set('pulseHz', v)} />
    </ScrollView>
  );
}
