import { Platform, StyleSheet, Text, View } from 'react-native';
import Animated, { useAnimatedStyle, type SharedValue } from 'react-native-reanimated';

// DEV LAYOUT AID — Expo Web only, stripped from production. A non-interactive
// iOS-style keyboard mock so keyboard-up layouts can be FELT in the browser
// (which never shows a virtual keyboard). Native devices always render null:
// they have the real thing.
//
// `progress` (0→1 shared value) slides it in/out — the chat drives it from its
// emulated-keyboard focus animation. Omit it for a statically-visible deck
// (onboarding's always-focused input steps).
export const FAUX_KB_HEIGHT = 320;
// exported so keyboard-adjacent layouts can reserve the deck's space in dev-web
export const FAUX_KB_VISIBLE = Platform.OS === 'web' && process.env.NODE_ENV !== 'production';
const SHOW = FAUX_KB_VISIBLE;

const ROWS = [
  ['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P'],
  ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L'],
  ['⇧', 'Z', 'X', 'C', 'V', 'B', 'N', 'M', '⌫'],
];

export function FauxKeyboard({
  progress,
  height = FAUX_KB_HEIGHT,
}: {
  progress?: SharedValue<number>;
  height?: number;
}) {
  const slide = useAnimatedStyle(() => ({
    transform: [{ translateY: progress ? (1 - progress.value) * height : 0 }],
  }));
  if (!SHOW) return null;
  return (
    <Animated.View pointerEvents="none" style={[styles.wrap, { height }, slide]}>
      <View style={styles.suggestions}>
        {['“I’m”', 'I', 'The'].map((w) => (
          <Text key={w} style={styles.suggestion}>
            {w}
          </Text>
        ))}
      </View>
      {ROWS.map((row, i) => (
        <View key={i} style={[styles.row, i === 1 ? { paddingHorizontal: 22 } : null]}>
          {row.map((k) => (
            <View key={k} style={[styles.key, k === '⇧' || k === '⌫' ? styles.keyMod : null]}>
              <Text style={styles.keyText}>{k}</Text>
            </View>
          ))}
        </View>
      ))}
      <View style={styles.row}>
        <View style={[styles.key, styles.keyWide]}>
          <Text style={styles.keyText}>123</Text>
        </View>
        <View style={[styles.key, styles.keySpace]}>
          <Text style={styles.keyText}>space</Text>
        </View>
        <View style={[styles.key, styles.keyWide]}>
          <Text style={styles.keyText}>return</Text>
        </View>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#D1D4D9',
    paddingTop: 8,
    paddingHorizontal: 4,
    gap: 10,
    zIndex: 90,
  },
  suggestions: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    paddingVertical: 4,
  },
  suggestion: { fontSize: 16, color: '#111' },
  row: { flexDirection: 'row', gap: 6, paddingHorizontal: 4 },
  key: {
    flex: 1,
    height: 42,
    borderRadius: 5,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.3,
    shadowRadius: 0,
  },
  keyMod: { backgroundColor: '#ABB0BA' },
  keyWide: { flex: 2, backgroundColor: '#ABB0BA' },
  keySpace: { flex: 6 },
  keyText: { fontSize: 16, color: '#111' },
});
