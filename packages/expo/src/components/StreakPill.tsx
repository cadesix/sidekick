import { Image, Pressable, StyleSheet, Text } from 'react-native';

import { Glass } from '~/imessage/components/Glass';
import { Skeleton } from './Skeleton';
import { useSnapshot } from '../lib/state';

// Top-right streak pill: flame icon + current day count, read from the server
// snapshot's streak slice (plan 20). Opens the streak modal (milestone ladder).
// Mirrors home5's top-right streak affordance.

const STREAK_ICON = require('../../assets/icons/streak.png');

// `darkBg` = the sky behind the glass is dark, so the material tint goes dark
// (translucent glass over dark rather than a white panel) and the count flips to
// white. The flame icon is a colour graphic that reads on either, so it isn't tinted.
export function StreakPill({ onPress, darkBg }: { onPress?: () => void; darkBg?: boolean }) {
  const count = useSnapshot().data?.streak.count;
  return (
    // Frosted glass pill. The tap target (Pressable) lives INSIDE the glass, and
    // the glass carries no `overflow:'hidden'` — clipping a glass view kills the
    // effect; borderRadius alone rounds it into a pill.
    <Glass tint={darkBg ? 'systemThinMaterialDark' : 'systemThinMaterialLight'} style={styles.pill}>
      <Pressable onPress={onPress} style={styles.inner} accessibilityLabel={`${count ?? 0} day streak`}>
        <Image source={STREAK_ICON} style={styles.icon} />
        {count == null ? (
          <Skeleton className="h-[14px] w-5 rounded-full" />
        ) : (
          <Text style={[styles.count, darkBg && styles.countLight]}>{count}</Text>
        )}
      </Pressable>
    </Glass>
  );
}

const styles = StyleSheet.create({
  pill: {
    borderRadius: 999, // fully rounded pill; Glass shrink-wraps the inner row
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 6,
    elevation: 4,
  },
  inner: {
    height: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 16,
  },
  icon: { width: 28, height: 28, resizeMode: 'contain' },
  count: { fontSize: 16, fontWeight: '800', color: '#1a1a1a' },
  countLight: { color: '#fff' },
});
