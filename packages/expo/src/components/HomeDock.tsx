import { Ionicons } from '@expo/vector-icons';
import { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

// RN port of sidekick/src/components/home-dock.tsx: an iOS-home-screen-style
// dock pinned to the bottom with four app-icon "squircles". Messages opens the
// chat sheet; Shop / Map / Settings are wired to callbacks. The whole dock
// fades down out of the way while the full-screen map is up. Deltas from the
// web: Ionicons stand in for the hand-drawn SVGs, the frosted glass is a
// translucent panel (no expo-blur in the dev client), and the web's CSS
// gradients are solid mid-tone tile colors.

type DockProps = {
  hidden?: boolean;
  unread?: number;
  onMessages: () => void;
  onShop?: () => void;
  onMap?: () => void;
  onSettings?: () => void;
};

// one dock app: a rounded-squircle tile. NOTE: static style object only — the
// NativeWind css-interop layer drops FUNCTION-form Pressable styles entirely
// (tile backgrounds vanish), so no ({pressed}) => ... here.
function AppTile({
  label,
  color,
  onPress,
  children,
}: {
  label: string;
  color: string;
  onPress?: () => void;
  children: React.ReactNode;
}) {
  return (
    <Pressable
      accessibilityLabel={label}
      onPress={onPress}
      style={{
        width: 58,
        height: 58,
        borderRadius: 14,
        backgroundColor: color,
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
        borderWidth: 1,
        borderColor: 'rgba(0,0,0,0.05)',
      }}
    >
      {children}
    </Pressable>
  );
}

export function HomeDock({ hidden, unread = 0, onMessages, onShop, onMap, onSettings }: DockProps) {
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
        {
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          alignItems: 'center',
          paddingBottom: Math.max(insets.bottom, 16),
          zIndex: 30,
        },
      ]}
      pointerEvents={hidden ? 'none' : 'box-none'}
    >
      <View
        className="flex-row items-center"
        style={{
          gap: 18,
          borderRadius: 32,
          borderWidth: 1,
          borderColor: 'rgba(255,255,255,0.5)',
          backgroundColor: 'rgba(255,255,255,0.55)',
          paddingHorizontal: 18,
          paddingVertical: 14,
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 8 },
          shadowOpacity: 0.18,
          shadowRadius: 15,
          elevation: 8,
        }}
      >
        {/* Messages — opens the chat sheet. Unread badge sits on an OUTER
            wrapper (the tile itself is overflow:hidden). */}
        <View>
          <AppTile label="Messages" color="#2BD14E" onPress={onMessages}>
            <Ionicons name="chatbubble" size={30} color="#fff" />
          </AppTile>
          {unread > 0 ? (
            <View style={styles.badge} pointerEvents="none">
              <Text style={styles.badgeText}>{unread > 9 ? '9+' : unread}</Text>
            </View>
          ) : null}
        </View>

        {/* Shop — shopping bag */}
        <AppTile label="Shop" color="#FF7A48" onPress={onShop}>
          <Ionicons name="bag" size={28} color="#fff" />
        </AppTile>

        {/* Map — pale map tile with a red pin (web draws a mini map here) */}
        <AppTile label="Map" color="#eaf1e2" onPress={onMap}>
          <Ionicons name="location-sharp" size={30} color="#ff5b4d" />
        </AppTile>

        {/* Settings — grey gear */}
        <AppTile label="Settings" color="#aeaeb5" onPress={onSettings}>
          <Ionicons name="settings-sharp" size={28} color="#fff" />
        </AppTile>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  badge: {
    position: 'absolute',
    top: -6,
    right: -6,
    minWidth: 21,
    height: 21,
    paddingHorizontal: 5,
    borderRadius: 11,
    backgroundColor: '#FF3B30',
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.9)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { color: '#fff', fontSize: 12, fontWeight: '800' },
});
