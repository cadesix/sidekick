import { LinearGradient } from 'expo-linear-gradient';
import { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Path, Rect } from 'react-native-svg';

import { Glass } from '~/imessage/components/Glass';

// iOS-home-screen-style dock — exact port of sidekick/src/components/home-dock.tsx.
// Frosted glass panel with four squircle app tiles (Messages / Shop / Map /
// Goals), each the same hand-drawn SVG + gradient as web. Fades down while a
// sheet covers the dock.

type DockProps = {
  hidden?: boolean;
  unread?: number;
  onMessages: () => void;
  onShop?: () => void;
  onMap?: () => void;
  onGoals?: () => void;
};

const TILE = 58;

// one squircle tile: gradient (or a full-bleed SVG for Map) + press-in scale
function AppTile({
  label,
  onPress,
  gradient,
  children,
}: {
  label: string;
  onPress?: () => void;
  gradient?: [string, string];
  children: React.ReactNode;
}) {
  return (
    <Pressable
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [styles.tile, { transform: [{ scale: pressed ? 0.9 : 1 }] }]}
    >
      {gradient ? (
        <LinearGradient colors={gradient} style={StyleSheet.absoluteFill} />
      ) : null}
      {/* icon sits in its own positioned layer so it paints ABOVE the absolutely
          positioned gradient (CSS paints positioned siblings over static ones) */}
      <View style={[StyleSheet.absoluteFill, styles.center]}>{children}</View>
    </Pressable>
  );
}

const ICON = Math.round(TILE * 0.62);
const BAG = Math.round(TILE * 0.56);

export function HomeDock({ hidden, unread = 0, onMessages, onShop, onMap, onGoals }: DockProps) {
  const insets = useSafeAreaInsets();
  const shown = useSharedValue(hidden ? 0 : 1);
  useEffect(() => {
    shown.value = withTiming(hidden ? 0 : 1, { duration: 300 });
  }, [hidden, shown]);
  const dockStyle = useAnimatedStyle(() => ({
    opacity: shown.value,
    transform: [{ translateY: (1 - shown.value) * 24 }],
  }));

  return (
    <Animated.View
      style={[
        dockStyle,
        { position: 'absolute', left: 0, right: 0, bottom: 0, alignItems: 'center', paddingBottom: Math.max(insets.bottom, 16), zIndex: 30 },
      ]}
      pointerEvents={hidden ? 'none' : 'box-none'}
    >
      <Glass style={styles.panel}>
        {/* Messages — chat bubble on a green gradient; red unread badge */}
        <View>
          <AppTile label="Messages" onPress={onMessages} gradient={['#5BF76B', '#12C93E']}>
            <Svg viewBox="0 0 24 24" width={ICON} height={ICON}>
              <Path
                fill="#fff"
                d="M12 4.2C6.9 4.2 3 7.3 3 11.2c0 2.2 1.3 4.2 3.3 5.5-.2 1.1-.8 2.1-1.5 2.9 1.5-.1 3.1-.6 4.3-1.5.9.3 1.9.4 2.9.4 5.1 0 9-3.1 9-7S17.1 4.2 12 4.2z"
              />
            </Svg>
          </AppTile>
          {unread > 0 ? (
            <View style={styles.badge} pointerEvents="none">
              <Text style={styles.badgeText}>{unread > 9 ? '9+' : unread}</Text>
            </View>
          ) : null}
        </View>

        {/* Shop — shopping bag on an orange gradient */}
        <AppTile label="Shop" onPress={onShop} gradient={['#FF9E5A', '#FF5E3A']}>
          <Svg viewBox="0 0 24 24" width={BAG} height={BAG}>
            <Path
              fill="#fff"
              fillRule="evenodd"
              clipRule="evenodd"
              d="M9 8V7.4a3 3 0 0 1 6 0V8h2.1c.53 0 .97.4 1.02.93l.8 8.7A2 2 0 0 1 16.93 20H7.07a2 2 0 0 1-1.99-2.37l.8-8.7A1.02 1.02 0 0 1 6.9 8H9zm1.6 0h2.8v-.6a1.4 1.4 0 0 0-2.8 0V8zm-1.6 2.6a.9.9 0 1 0 0-1.8.9.9 0 0 0 0 1.8zm6 0a.9.9 0 1 0 0-1.8.9.9 0 0 0 0 1.8z"
            />
          </Svg>
        </AppTile>

        {/* Map — Apple-Maps mini-map: lake, park, roads, red pin */}
        <AppTile label="Map" onPress={onMap}>
          <Svg viewBox="0 0 60 60" width={TILE} height={TILE}>
            <Rect width="60" height="60" fill="#eaf1e2" />
            <Path d="M0 42C10 44 16 52 18 60L0 60Z" fill="#9fd0ff" />
            <Path d="M60 0L60 22C50 22 44 14 44 0Z" fill="#c7e6a8" />
            <Path d="M-6 16C18 26 34 30 66 12" stroke="#f2d9a0" strokeWidth={8} fill="none" />
            <Path d="M-6 16C18 26 34 30 66 12" stroke="#fff" strokeWidth={1.6} strokeDasharray="3 3" fill="none" />
            <Path d="M14 62L30 -2" stroke="#ffffff" strokeWidth={4} fill="none" />
            <Path d="M36 22c0-3.3-2.7-6-6-6s-6 2.7-6 6c0 4.5 6 11 6 11s6-6.5 6-11z" fill="#ff5b4d" />
            <Circle cx="30" cy="22" r="2.2" fill="#fff" />
          </Svg>
        </AppTile>

        {/* Goals — bullseye target on a blue gradient */}
        <AppTile label="Goals" onPress={onGoals} gradient={['#6BB6FF', '#3D7BFF']}>
          <Svg viewBox="0 0 24 24" width={ICON} height={ICON}>
            <Circle cx="12" cy="12" r="8.5" fill="none" stroke="#fff" strokeWidth={2} />
            <Circle cx="12" cy="12" r="4.75" fill="none" stroke="#fff" strokeWidth={2} />
            <Circle cx="12" cy="12" r="1.6" fill="#fff" />
          </Svg>
        </AppTile>
      </Glass>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  panel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 18,
    borderRadius: 32,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.4)',
    backgroundColor: 'rgba(255,255,255,0.25)',
    paddingHorizontal: 18,
    paddingVertical: 14,
    overflow: 'hidden',
  },
  tile: {
    width: TILE,
    height: TILE,
    borderRadius: 14,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.05)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    position: 'absolute',
    top: -6,
    right: -6,
    minWidth: 21,
    height: 21,
    paddingHorizontal: 5,
    borderRadius: 11,
    backgroundColor: '#FF3B30',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
  },
  badgeText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  center: { alignItems: 'center', justifyContent: 'center' },
});
