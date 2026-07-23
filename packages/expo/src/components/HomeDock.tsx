import { LinearGradient } from 'expo-linear-gradient';
import { memo, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Path } from 'react-native-svg';

import { Glass } from '~/imessage/components/Glass';
import { NewsDot } from './NewsDot';

// iOS-home-screen-style dock — port of sidekick/src/components/home-dock.tsx.
// Frosted glass panel with four squircle app tiles (Messages / Shop / Goals /
// Profile), each a hand-drawn SVG + gradient. Fades down while a sheet covers
// the dock. (Map moved to the top-right pin; Profile folds in settings.)

// where a tile sits on screen (window coords) — the chat's zoom-open animation
// grows out of the Messages tile like an iOS app launch
export type TileOrigin = { x: number; y: number; width: number; height: number };

type DockProps = {
  hidden?: boolean;
  unread?: number;
  // wordless news dots: unseen shop restock / a goal not yet done today
  shopDot?: boolean;
  goalsDot?: boolean;
  // called with the Messages tile's measured window rect (when measurable)
  onMessages: (origin?: TileOrigin) => void;
  onShop?: () => void;
  onGoals?: () => void;
  onProfile?: () => void;
};

const TILE = 60; // iPhone home-screen app-icon size

// one squircle tile: gradient fill + press-in scale
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
  // NativeWind drops function-form Pressable `style`, which silently zeroes the
  // tile; track the press with state and keep `style` an array instead.
  const [pressed, setPressed] = useState(false);
  return (
    <Pressable
      accessibilityLabel={label}
      onPress={onPress}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      style={[styles.tile, { transform: [{ scale: pressed ? 0.9 : 1 }] }]}
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

export const HomeDock = memo(HomeDockImpl);
function HomeDockImpl({ hidden, unread = 0, shopDot, goalsDot, onMessages, onShop, onGoals, onProfile }: DockProps) {
  const insets = useSafeAreaInsets();
  const shown = useSharedValue(hidden ? 0 : 1);
  useEffect(() => {
    shown.value = withTiming(hidden ? 0 : 1, { duration: 300 });
  }, [hidden, shown]);
  // the Messages tile's wrapper — measured on press so the chat can zoom out
  // of the tile's actual on-screen position
  const messagesTileRef = useRef<View>(null);
  const pressMessages = () => {
    const node = messagesTileRef.current;
    if (!node) return onMessages();
    node.measureInWindow((x, y, width, height) => {
      onMessages(width > 0 ? { x, y, width, height } : undefined);
    });
  };
  // Slides fully off-screen rather than fading: animating a parent's opacity
  // permanently kills descendant UIGlassEffect views (expo/expo#41024).
  const dockStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: (1 - shown.value) * 200 }],
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
        <View ref={messagesTileRef} collapsable={false}>
          <AppTile label="Messages" onPress={pressMessages} gradient={['#5BF76B', '#12C93E']}>
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

        {/* Shop — shopping bag on an orange gradient; dot = unseen restock */}
        <View>
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
          {shopDot ? <NewsDot style={styles.dotAnchor} /> : null}
        </View>

        {/* Goals — bullseye target on a blue gradient; dot = a goal still open today */}
        <View>
          <AppTile label="Goals" onPress={onGoals} gradient={['#6BB6FF', '#3D7BFF']}>
            <Svg viewBox="0 0 24 24" width={ICON} height={ICON}>
              <Circle cx="12" cy="12" r="8.5" fill="none" stroke="#fff" strokeWidth={2} />
              <Circle cx="12" cy="12" r="4.75" fill="none" stroke="#fff" strokeWidth={2} />
              <Circle cx="12" cy="12" r="1.6" fill="#fff" />
            </Svg>
          </AppTile>
          {goalsDot ? <NewsDot style={styles.dotAnchor} /> : null}
        </View>

        {/* Profile — person on the astral purple gradient (name, card, settings) */}
        <AppTile label="Profile" onPress={onProfile} gradient={['#B79CFF', '#7A5AF8']}>
          <Svg viewBox="0 0 24 24" width={ICON} height={ICON}>
            <Circle cx="12" cy="8.2" r="3.9" fill="#fff" />
            <Path fill="#fff" d="M12 13.6c-4.5 0-7.6 2.6-7.6 5.6 0 .5.4.8.9.8h13.4c.5 0 .9-.3.9-.8 0-3-3.1-5.6-7.6-5.6z" />
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
  },
  tile: {
    width: TILE,
    height: TILE,
    borderRadius: 14,
    borderCurve: 'continuous',
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
  // same anchor as `badge`, but wordless — there's no count to show, just news
  dotAnchor: { top: -4, right: -4 },
  center: { alignItems: 'center', justifyContent: 'center' },
});
