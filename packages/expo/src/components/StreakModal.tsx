import { Ionicons } from '@expo/vector-icons';
import { Image, Modal, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { MILESTONES } from '@sidekick/core';

import { useStreak } from '../store/streak';

// Streak modal: the current streak up top, then only the NEXT few milestone
// containers — everything past that is a mystery card, so upcoming rewards tease
// without revealing the whole curve. Mirrors the web reference
// (packages/web/src/components/streak-sheet.tsx).
//
// NOTE: milestone cosmetic rewards render as shop product PNGs on web
// (public/shop-renders/<render>.png). Those images aren't bundled into the Expo
// app, so cosmetic rewards show a gift-icon placeholder + the render key as a
// caption; coin rewards show a coin icon + amount.

const SHOW_NEXT = 3; // upcoming milestones revealed; the rest stay a mystery
const FLAME = '#ff7a3d';

const streakIcon = require('../../assets/icons/streak.png');

export function StreakModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const count = useStreak((s) => s.count);

  const upcoming = MILESTONES.filter((m) => m.day > count);
  const revealed = upcoming.slice(0, SHOW_NEXT);
  const mystery = upcoming[SHOW_NEXT];

  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={onClose}>
      {/* scrim */}
      <Pressable
        onPress={onClose}
        accessibilityLabel="Dismiss streak"
        style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.3)' }}
      />
      {/* centered card — overlaid so the scrim press only fires outside it */}
      <View
        pointerEvents="box-none"
        style={{ position: 'absolute', inset: 0, alignItems: 'center', justifyContent: 'center', padding: 32 }}
      >
        <View
          className="w-full bg-white"
          style={{
            maxWidth: 380,
            borderRadius: 28,
            padding: 24,
            paddingBottom: Math.max(insets.bottom, 24),
            shadowColor: '#000',
            shadowOffset: { width: 0, height: 20 },
            shadowOpacity: 0.35,
            shadowRadius: 60,
            elevation: 24,
          }}
        >
          {/* close */}
          <Pressable
            onPress={onClose}
            accessibilityLabel="Close"
            className="absolute h-9 w-9 rounded-full bg-neutral-100 items-center justify-center"
            style={{ top: 16, right: 16, zIndex: 1 }}
          >
            <Ionicons name="close" size={20} color="#737373" />
          </Pressable>

          {/* the streak itself */}
          <View className="items-center">
            <Image source={streakIcon} style={{ width: 64, height: 64 }} resizeMode="contain" />
            <Text className="mt-2 text-[24px] font-extrabold text-neutral-900">{count}-day streak</Text>
            <Text className="text-[13px] font-medium text-neutral-400">Come back daily to earn rewards</Text>
          </View>

          {/* next few milestones, then mystery */}
          <View className="mt-5" style={{ gap: 10 }}>
            {revealed.map((m, i) => {
              const days = m.day - count;
              const first = i === 0;
              return (
                <View
                  key={m.day}
                  className="flex-row items-center rounded-[18px] px-3.5 py-2.5"
                  style={{
                    gap: 12,
                    backgroundColor: first ? '#fff' : '#f5f5f5',
                    borderWidth: first ? 2 : 0,
                    borderColor: FLAME,
                  }}
                >
                  <View className="h-11 w-11 shrink-0 rounded-xl bg-white items-center justify-center">
                    <Ionicons
                      name={m.render ? 'gift' : 'ellipse'}
                      size={24}
                      color={m.render ? FLAME : '#f5c451'}
                    />
                  </View>
                  <View className="min-w-0 flex-1">
                    <Text className="text-[12px] font-bold uppercase text-neutral-400">Day {m.day}</Text>
                    <Text numberOfLines={1} className="text-[15px] font-bold text-neutral-900">
                      {m.label}
                    </Text>
                    {m.render ? (
                      <Text numberOfLines={1} className="text-[11px] text-neutral-400">
                        render: {m.render}
                      </Text>
                    ) : null}
                  </View>
                  <View
                    className="shrink-0 rounded-full px-2.5 py-1"
                    style={{ backgroundColor: first ? '#fff1e6' : '#fff' }}
                  >
                    <Text className="text-[11px] font-bold" style={{ color: first ? FLAME : '#a3a3a3' }}>
                      {days === 1 ? 'Tomorrow' : `In ${days} days`}
                    </Text>
                  </View>
                </View>
              );
            })}
            {mystery ? (
              <View
                className="flex-row items-center rounded-[18px] bg-neutral-100 px-3.5 py-2.5"
                style={{ gap: 12, opacity: 0.8 }}
              >
                <View className="h-11 w-11 shrink-0 rounded-xl bg-white items-center justify-center">
                  <Text className="text-[20px] font-extrabold text-neutral-300">?</Text>
                </View>
                <View className="min-w-0 flex-1">
                  <Text className="text-[12px] font-bold uppercase text-neutral-400">Day {mystery.day}</Text>
                  <Text numberOfLines={1} className="text-[15px] font-bold text-neutral-500">
                    Come back tomorrow for more!
                  </Text>
                </View>
              </View>
            ) : null}
          </View>
        </View>
      </View>
    </Modal>
  );
}
