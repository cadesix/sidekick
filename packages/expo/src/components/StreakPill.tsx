import { Image, Pressable, StyleSheet, Text } from 'react-native';

import { Skeleton } from './Skeleton';
import { useSnapshot } from '../lib/state';

// Top-right streak pill: flame icon + current day count, read from the server
// snapshot's streak slice (plan 20). Opens the streak modal (milestone ladder).
// Mirrors home5's top-right streak affordance.

const STREAK_ICON = require('../../assets/icons/streak.png');

export function StreakPill({ onPress }: { onPress?: () => void }) {
  const count = useSnapshot().data?.streak.count;
  return (
    <Pressable onPress={onPress} style={styles.pill} accessibilityLabel={`${count ?? 0} day streak`}>
      <Image source={STREAK_ICON} style={styles.icon} />
      {count == null ? (
        <Skeleton className="h-[14px] w-5 rounded-full" />
      ) : (
        <Text style={styles.count}>{count}</Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    height: 40,
    paddingHorizontal: 12,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.92)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 6,
    elevation: 4,
  },
  icon: { width: 22, height: 22, resizeMode: 'contain' },
  count: { fontSize: 16, fontWeight: '800', color: '#1a1a1a' },
});
