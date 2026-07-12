import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import { Dimensions, Pressable, ScrollView, Text, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

// RN port of sidekick/src/components/world-map.tsx: the full-screen "world map"
// the dock's Map icon opens. A static 3:4 map fills the viewport height (cover)
// and pans horizontally; each area is an unlockable region with an emoji pin;
// tapping one slides up an Apple-Maps-style place card.
//
// The web's `clip-path: circle()` reveal has no RN equivalent, so the mask is
// built by hand: a screen-centered circular container (overflow hidden) scales
// up from 0 while its screen-sized inner content counter-scales by 1/s, so the
// map stays pinned to the viewport as the circle grows over it.

const MAP_SRC = require('../../assets/images/world-map-day.webp');
const MAP_ASPECT = 1080 / 1440; // art normalized to 1080×1440 (3:4)

const REVEAL_MS = 380;
const CARD_DELAY = 300; // circle has visually landed by here; then the card pops

type Area = {
  id: string;
  name: string;
  emoji: string;
  color: string; // marker badge background
  left: number; // fraction of the map image
  top: number;
  unlocked: boolean;
  blurb: string;
};

// positions are fractions of the world-map-*.webp image (matches the web's %)
const AREAS: Area[] = [
  { id: 'frostpeak', name: 'Frostpeak', emoji: '❄️', color: '#cfe6ff', left: 0.28, top: 0.26, unlocked: true, blurb: 'Snow-capped summit' },
  { id: 'pinewood', name: 'Pinewood', emoji: '🌲', color: '#8fd18f', left: 0.74, top: 0.32, unlocked: true, blurb: 'Evergreen forest' },
  { id: 'blossom', name: 'Blossom Vale', emoji: '🌸', color: '#ffc1dd', left: 0.29, top: 0.55, unlocked: false, blurb: 'Cherry-blossom groves' },
  { id: 'dunes', name: 'Sandy Dunes', emoji: '🏜️', color: '#f2c98a', left: 0.8, top: 0.64, unlocked: false, blurb: 'Golden desert canyon' },
  { id: 'palmcove', name: 'Palm Cove', emoji: '🌴', color: '#7fd6b0', left: 0.18, top: 0.79, unlocked: false, blurb: 'Tropical palm shore' },
  { id: 'ember', name: 'Mount Ember', emoji: '🌋', color: '#ff8a5b', left: 0.58, top: 0.86, unlocked: false, blurb: 'Smouldering volcano' },
];

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');
// CSS circle(74%) resolves against hypot(w,h)/√2; sized so the deceleration
// lands just past the corners instead of overshooting off-frame.
const CIRCLE_D = 2 * 0.74 * (Math.hypot(SCREEN_W, SCREEN_H) / Math.SQRT2);
const MAP_W = SCREEN_H * MAP_ASPECT; // cover: fills height, pans horizontally

export function WorldMap({
  open,
  onClose,
  onChat,
}: {
  open: boolean;
  onClose: () => void;
  onChat?: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [selId, setSelId] = useState<string | null>(null);
  const selected = AREAS.find((a) => a.id === selId) ?? null;

  // the bottom promo card pops in only after the circle mask finishes expanding
  const [cardIn, setCardIn] = useState(false);
  useEffect(() => {
    if (!open) {
      setCardIn(false);
      return;
    }
    const t = setTimeout(() => setCardIn(true), CARD_DELAY);
    return () => clearTimeout(t);
  }, [open]);

  const reveal = useSharedValue(0);
  useEffect(() => {
    reveal.value = withTiming(open ? 1 : 0, {
      duration: REVEAL_MS,
      easing: Easing.out(Easing.cubic), // graceful settle, deceleration stays on-screen
    });
  }, [open, reveal]);

  const circleStyle = useAnimatedStyle(() => ({
    transform: [{ scale: Math.max(reveal.value, 0.0001) }],
  }));
  const contentStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 1 / Math.max(reveal.value, 0.0001) }],
  }));

  const promoStyle = useAnimatedStyle(() => ({ opacity: reveal.value }));

  return (
    <View
      style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 40 }}
      pointerEvents={open ? 'auto' : 'none'}
    >
      {/* circular mask: centered, scales up while the content counter-scales */}
      <Animated.View
        style={[
          circleStyle,
          {
            position: 'absolute',
            left: (SCREEN_W - CIRCLE_D) / 2,
            top: (SCREEN_H - CIRCLE_D) / 2,
            width: CIRCLE_D,
            height: CIRCLE_D,
            borderRadius: CIRCLE_D / 2,
            overflow: 'hidden',
          },
        ]}
      >
        <Animated.View
          style={[
            contentStyle,
            {
              position: 'absolute',
              left: (CIRCLE_D - SCREEN_W) / 2,
              top: (CIRCLE_D - SCREEN_H) / 2,
              width: SCREEN_W,
              height: SCREEN_H,
            },
          ]}
        >
          {/* sky→sea gradient backs the letterbox bands while the art loads */}
          <View style={{ position: 'absolute', top: 0, left: 0, right: 0, height: SCREEN_H / 2, backgroundColor: '#9d8fc2' }} />
          <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: SCREEN_H / 2, backgroundColor: '#6991ac' }} />

          {/* the 3:4 map fills the viewport height; it's wider than the screen,
              so it pans horizontally and opens centered */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentOffset={{ x: Math.max(0, (MAP_W - SCREEN_W) / 2), y: 0 }}
          >
            <Pressable onPress={() => setSelId(null)} style={{ width: MAP_W, height: SCREEN_H }}>
              <Image
                source={MAP_SRC}
                style={{ width: MAP_W, height: SCREEN_H }}
                contentFit="cover"
              />
              {AREAS.map((a) => (
                <Pressable
                  key={a.id}
                  onPress={() => setSelId(a.id)}
                  accessibilityLabel={a.name}
                  // static style only: css-interop drops function-form Pressable styles
                  style={{
                    position: 'absolute',
                    left: a.left * MAP_W - 60,
                    top: a.top * SCREEN_H - 18,
                    width: 120,
                    alignItems: 'center',
                    gap: 4,
                  }}
                >
                  <View
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: 18,
                      backgroundColor: a.color,
                      alignItems: 'center',
                      justifyContent: 'center',
                      borderWidth: 2,
                      borderColor: '#fff',
                      opacity: a.unlocked ? 1 : 0.8,
                      shadowColor: '#000',
                      shadowOffset: { width: 0, height: 2 },
                      shadowOpacity: 0.4,
                      shadowRadius: 3.5,
                      elevation: 4,
                    }}
                  >
                    <Text style={{ fontSize: 17 }}>{a.emoji}</Text>
                    {!a.unlocked ? (
                      <View
                        style={{
                          position: 'absolute',
                          bottom: -4,
                          right: -4,
                          width: 16,
                          height: 16,
                          borderRadius: 8,
                          backgroundColor: '#262626',
                          borderWidth: 1.5,
                          borderColor: '#fff',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        <Ionicons name="lock-closed" size={9} color="#fff" />
                      </View>
                    ) : null}
                  </View>
                  <Text
                    numberOfLines={1}
                    className="rounded-full px-2 py-0.5 text-[11px] font-semibold overflow-hidden"
                    style={
                      a.unlocked
                        ? { backgroundColor: 'rgba(255,255,255,0.95)', color: '#262626' }
                        : { backgroundColor: 'rgba(0,0,0,0.5)', color: 'rgba(255,255,255,0.8)' }
                    }
                  >
                    {a.name}
                  </Text>
                </Pressable>
              ))}
            </Pressable>
          </ScrollView>

          {/* top scrim + close, like a map app header (stacked strips stand in
              for the web's CSS gradient) */}
          <View
            style={{ position: 'absolute', top: 0, left: 0, right: 0 }}
            pointerEvents="box-none"
          >
            <View style={{ position: 'absolute', top: 0, left: 0, right: 0, height: insets.top + 40, backgroundColor: 'rgba(0,0,0,0.28)' }} />
            <View style={{ position: 'absolute', top: insets.top + 40, left: 0, right: 0, height: 26, backgroundColor: 'rgba(0,0,0,0.16)' }} />
            <View style={{ position: 'absolute', top: insets.top + 66, left: 0, right: 0, height: 26, backgroundColor: 'rgba(0,0,0,0.07)' }} />
            <View
              className="flex-row items-center justify-end px-4"
              style={{ paddingTop: Math.max(insets.top, 12) }}
            >
              <Pressable
                onPress={onClose}
                accessibilityLabel="Close map"
                className="h-9 w-9 rounded-full items-center justify-center"
                style={{ backgroundColor: 'rgba(255,255,255,0.9)' }}
              >
                <Ionicons name="close" size={20} color="#404040" />
              </Pressable>
            </View>
          </View>

          {/* Default bottom prompt — styled like an incoming chat message from
              the sidekick. Hides when a marker's place card takes over. Tapping
              it starts a chat (how you unlock areas). */}
          {cardIn && !selected ? (
            <Animated.View
              style={[promoStyle, { position: 'absolute', left: 12, right: 12, bottom: Math.max(insets.bottom, 12) }]}
            >
              <Pressable
                onPress={onChat}
                className="flex-row items-end gap-2.5 p-3"
                // static style only: css-interop drops function-form Pressable styles
                style={{
                  borderRadius: 26,
                  backgroundColor: 'rgba(255,255,255,0.85)',
                  shadowColor: '#000',
                  shadowOffset: { width: 0, height: 10 },
                  shadowOpacity: 0.28,
                  shadowRadius: 20,
                  elevation: 10,
                }}
              >
                <View className="w-11 h-11 rounded-full bg-[#F2C94C] items-center justify-center">
                  <Ionicons name="happy" size={24} color="#fff" />
                </View>
                <View className="rounded-3xl rounded-bl-md bg-[#FBEFC9] px-4 py-3 flex-1">
                  <Text className="text-[17px] font-extrabold leading-tight text-[#111]">
                    Explore the World
                  </Text>
                  <Text className="mt-0.5 text-[14px] leading-snug text-[#111]/60">
                    Unlock new areas by chatting with me
                  </Text>
                </View>
              </Pressable>
            </Animated.View>
          ) : null}

          {/* Apple-Maps-style place card */}
          {selected ? (
            <View
              style={{ position: 'absolute', left: 12, right: 12, bottom: Math.max(insets.bottom, 12) }}
            >
              <View
                className="rounded-[26px] bg-white p-4"
                style={{
                  shadowColor: '#000',
                  shadowOffset: { width: 0, height: 10 },
                  shadowOpacity: 0.35,
                  shadowRadius: 20,
                  elevation: 12,
                }}
              >
                <View className="flex-row items-center gap-3">
                  <View
                    className="h-12 w-12 items-center justify-center rounded-2xl"
                    style={{ backgroundColor: selected.color }}
                  >
                    <Text style={{ fontSize: 24 }}>{selected.emoji}</Text>
                  </View>
                  <View className="flex-1">
                    <Text numberOfLines={1} className="text-[17px] font-bold text-neutral-900">
                      {selected.name}
                    </Text>
                    <Text numberOfLines={1} className="text-sm text-neutral-500">
                      {selected.blurb} · {selected.unlocked ? 'Unlocked' : 'Locked'}
                    </Text>
                  </View>
                  <Pressable
                    onPress={() => setSelId(null)}
                    accessibilityLabel="Dismiss"
                    className="h-7 w-7 items-center justify-center rounded-full bg-neutral-200"
                  >
                    <Ionicons name="close" size={16} color="#737373" />
                  </Pressable>
                </View>
                <Pressable
                  disabled={!selected.unlocked}
                  className={`mt-4 flex-row items-center justify-center gap-2 rounded-2xl py-3 ${
                    selected.unlocked ? 'bg-[#0a84ff]' : 'bg-neutral-100'
                  }`}
                >
                  {!selected.unlocked ? (
                    <Ionicons name="lock-closed" size={16} color="#a3a3a3" />
                  ) : null}
                  <Text
                    className={`text-[15px] font-semibold ${
                      selected.unlocked ? 'text-white' : 'text-neutral-400'
                    }`}
                  >
                    {selected.unlocked ? 'Explore' : 'Locked'}
                  </Text>
                </Pressable>
              </View>
            </View>
          ) : null}
        </Animated.View>
      </Animated.View>
    </View>
  );
}
