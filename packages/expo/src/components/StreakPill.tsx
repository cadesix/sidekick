import { Image, Pressable, StyleSheet, Text } from 'react-native';

import { useStreak } from '../store/streak';

// Top-right streak pill: flame icon + current day count. Opens the streak modal
// (milestone ladder). Mirrors home5's top-right streak affordance.

const STREAK_ICON = require('../../assets/icons/streak.png');

export function StreakPill({ onPress }: { onPress?: () => void }) {
  const count = useStreak((s) => s.count);
  return (
    <Pressable onPress={onPress} style={styles.pill} accessibilityLabel={`${count} day streak`}>
      <Image source={STREAK_ICON} style={styles.icon} />
      <Text style={styles.count}>{count}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    height: 52,
    paddingHorizontal: 16,
    borderRadius: 999, // fully rounded pill
    backgroundColor: 'rgba(255,255,255,0.92)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 6,
    elevation: 4,
  },
  icon: { width: 28, height: 28, resizeMode: 'contain' },
  count: { fontSize: 16, fontWeight: '800', color: '#1a1a1a' },
});
