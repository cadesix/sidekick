import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { Dimensions, Image, Pressable, ScrollView, Text, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { Manifest } from '../three/cosmetics-manifest';
import {
  SHOP_COLORS,
  SLOT_LABEL,
  WARDROBE_SLOTS,
  type CosmeticsControls,
  type Wardrobe,
  type WardrobeSlot,
} from '../three/wardrobe';

// RN port of sidekick/src/components/shop-sheet.tsx: a bottom-sheet "Shop"
// (really a wardrobe) — pick which shirt / pants / hat / shoes are worn and
// recolor each one. It drives the live character behind it through the
// canvas's imperative CosmeticsControls, so every tap updates the 3D model
// immediately. The sheet covers the lower half; the character is framed above
// it (studio mode) so you can see the outfit change. Delta from the web: the
// controls arrive as a prop (state from onControls) instead of a ref.

const SHEET_H = Dimensions.get('window').height * 0.52;
const TILE = 66;

export function ShopSheet({
  open,
  onClose,
  controls,
}: {
  open: boolean;
  onClose: () => void;
  controls: CosmeticsControls | null;
}) {
  const insets = useSafeAreaInsets();
  const [slot, setSlot] = useState<WardrobeSlot>('shirt');
  const [wardrobe, setWardrobe] = useState<Wardrobe | null>(null);
  const [manifest, setManifest] = useState<Manifest | null>(null);

  const progress = useSharedValue(0);
  useEffect(() => {
    progress.value = withTiming(open ? 1 : 0, { duration: 300 });
  }, [open, progress]);
  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: (1 - progress.value) * SHEET_H }],
  }));

  // snapshot the current outfit + catalog when the sheet opens
  useEffect(() => {
    if (!open || !controls) return;
    setWardrobe(controls.getState());
    setManifest(controls.manifest());
  }, [open, controls]);

  const st = wardrobe?.[slot];
  const variants = manifest?.[slot]?.variants ?? [];
  const sync = () => {
    if (controls) setWardrobe(controls.getState());
  };

  const pickVariant = (id: string) => {
    controls?.equipVariant(slot, id);
    sync();
  };
  const pickColor = (color: string) => {
    controls?.setColor(slot, color);
    sync();
  };
  const removeSlot = () => {
    controls?.remove(slot);
    sync();
  };

  // which choice is currently active, for the highlight rings
  const activeColor = st?.equipped ? st.color : undefined;
  const activeVariant = st?.equipped && !st.color ? st.variantId : undefined;
  const isOff = !st?.equipped;

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
          <View className="mt-2 flex-row items-center justify-between">
            <Text className="text-[22px] font-extrabold text-neutral-900">Shop</Text>
            <Pressable
              onPress={onClose}
              accessibilityLabel="Close shop"
              className="h-9 w-9 rounded-full bg-neutral-100 items-center justify-center"
            >
              <Ionicons name="close" size={20} color="#737373" />
            </Pressable>
          </View>
        </View>

        {/* slot tabs */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          className="mt-3 shrink-0 grow-0"
          contentContainerStyle={{ gap: 8, paddingHorizontal: 20 }}
        >
          {WARDROBE_SLOTS.map((s) => {
            const on = wardrobe?.[s]?.equipped;
            const active = slot === s;
            return (
              <Pressable
                key={s}
                onPress={() => setSlot(s)}
                className={`rounded-full px-4 py-2 ${active ? 'bg-neutral-900' : 'bg-neutral-100'}`}
              >
                <Text
                  className={`text-[15px] font-bold ${active ? 'text-white' : 'text-neutral-600'}`}
                >
                  {SLOT_LABEL[s]}
                </Text>
                {on ? (
                  <View
                    className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full"
                    style={{ backgroundColor: active ? '#34d399' : '#10b981' }}
                  />
                ) : null}
              </Pressable>
            );
          })}
        </ScrollView>

        {/* scrolling content: styles then colors */}
        <ScrollView
          className="flex-1 px-5 pt-4"
          contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 16) }}
          showsVerticalScrollIndicator={false}
        >
          {/* Styles */}
          <Text className="mb-1.5 text-[13px] font-semibold uppercase tracking-wide text-neutral-400">
            Style
          </Text>
          <View className="flex-row flex-wrap" style={{ gap: 10 }}>
            {/* None / take off */}
            <Pressable
              onPress={removeSlot}
              accessibilityLabel={`Remove ${SLOT_LABEL[slot]}`}
              className="items-center justify-center rounded-2xl bg-neutral-50"
              style={{
                width: TILE,
                height: TILE,
                borderWidth: 2,
                borderColor: isOff ? '#171717' : 'transparent',
              }}
            >
              <Ionicons name="ban" size={24} color="#a3a3a3" />
            </Pressable>
            {variants.map((v) => {
              const selected = activeVariant === v.id;
              return (
                <Pressable
                  key={v.id}
                  onPress={() => pickVariant(v.id)}
                  accessibilityLabel={v.name}
                  className="overflow-hidden rounded-2xl"
                  style={{
                    width: TILE,
                    height: TILE,
                    borderWidth: 2,
                    borderColor: selected ? '#171717' : 'transparent',
                    backgroundColor: v.color ?? '#e9edf1',
                  }}
                >
                  {v.tex ? (
                    <Image
                      source={v.tex}
                      resizeMode="cover"
                      style={{ width: '100%', height: '100%' }}
                    />
                  ) : null}
                  {selected ? (
                    <View className="absolute right-1 top-1 h-5 w-5 items-center justify-center rounded-full bg-neutral-900">
                      <Ionicons name="checkmark" size={13} color="#fff" />
                    </View>
                  ) : null}
                </Pressable>
              );
            })}
          </View>

          {/* Colors */}
          <Text className="mb-1.5 mt-5 text-[13px] font-semibold uppercase tracking-wide text-neutral-400">
            Color
          </Text>
          <View className="flex-row flex-wrap" style={{ gap: 10 }}>
            {SHOP_COLORS.map((c) => {
              const selected = activeColor?.toLowerCase() === c.toLowerCase();
              return (
                <Pressable
                  key={c}
                  onPress={() => pickColor(c)}
                  accessibilityLabel={`Color ${c}`}
                  className="h-10 w-10 items-center justify-center rounded-full"
                  style={{
                    backgroundColor: c,
                    borderWidth: 2,
                    borderColor: selected ? '#171717' : 'rgba(0,0,0,0.05)',
                  }}
                >
                  {selected ? (
                    <Ionicons name="checkmark" size={20} color={pickTextColor(c)} />
                  ) : null}
                </Pressable>
              );
            })}
          </View>
        </ScrollView>
      </View>
    </Animated.View>
  );
}

// black or white check depending on swatch luminance
function pickTextColor(hex: string): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.6 ? '#111' : '#fff';
}
