import { useEffect, useRef, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, useAnimatedStyle, useSharedValue, withSequence, withSpring, withTiming } from 'react-native-reanimated';

import type { BoxReward } from '@sidekick/core';

import { shopRender } from '../three/shop-renders';

// RN port of sidekick/src/components/daily-box.tsx — the daily-box flow FX:
// StreakSplash (first session of day), GroundBox (the tap target), and
// BoxRewardsModal (coins count-up + milestone). The 3D chest pop is deferred
// (see task 9 spike); GroundBox is a 2D tap target for now.

const STREAK_ICON = require('../../assets/icons/streak.png');

// small gold coin disc (web uses an inline SVG Coin)
function Coin({ size = 24 }: { size?: number }) {
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: '#F2C94C',
        borderWidth: Math.max(1, size * 0.08),
        borderColor: '#e0b43a',
      }}
    />
  );
}

// ---- ease-out count-up ------------------------------------------------------
function useCountUp(target: number, ms = 700): number {
  const [v, setV] = useState(0);
  useEffect(() => {
    let raf = 0;
    const t0 = Date.now();
    const step = () => {
      const k = Math.min(1, (Date.now() - t0) / ms);
      setV(Math.round(target * (1 - (1 - k) * (1 - k))));
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return v;
}

// ---- StreakSplash -----------------------------------------------------------
export function StreakSplash({ streak, onDone }: { streak: number; onDone: () => void }) {
  const [shown, setShown] = useState(streak > 1 ? streak - 1 : streak);
  const pop = useSharedValue(1);
  useEffect(() => {
    const tick = setTimeout(() => {
      setShown(streak);
      pop.value = withSequence(withTiming(1.25, { duration: 120 }), withSpring(1));
    }, 700);
    const done = setTimeout(onDone, 2100);
    return () => {
      clearTimeout(tick);
      clearTimeout(done);
    };
  }, [streak, onDone, pop]);
  const numStyle = useAnimatedStyle(() => ({ transform: [{ scale: pop.value }] }));

  return (
    <Pressable onPress={onDone} accessibilityLabel="Continue" style={styles.splash}>
      <Animated.View entering={FadeIn} style={{ alignItems: 'center' }}>
        <Image source={STREAK_ICON} style={{ width: 112, height: 112, resizeMode: 'contain' }} />
        <Animated.Text style={[styles.splashNum, numStyle]}>{shown}</Animated.Text>
        <Text style={styles.splashLabel}>day streak!</Text>
      </Animated.View>
    </Pressable>
  );
}

// ---- GroundBox (2D tap target) ----------------------------------------------
export function GroundBox({ onOpened }: { onOpened: () => void }) {
  const scale = useSharedValue(1);
  const opened = useRef(false);
  const onTap = () => {
    if (opened.current) return;
    opened.current = true;
    scale.value = withSequence(withTiming(1.3, { duration: 140 }), withTiming(0, { duration: 260 }));
    setTimeout(onOpened, 500);
  };
  const style = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  return (
    <View style={styles.groundWrap} pointerEvents="box-none">
      <View style={styles.chestBadge}>
        <Text style={styles.chestBadgeText}>Daily Chest!</Text>
      </View>
      <Pressable onPress={onTap}>
        <Animated.View style={[styles.chest, style]}>
          <Text style={{ fontSize: 52 }}>🎁</Text>
        </Animated.View>
      </Pressable>
    </View>
  );
}

// ---- BoxRewardsModal --------------------------------------------------------
export function BoxRewardsModal({ reward, onCollect }: { reward: BoxReward; onCollect: () => void }) {
  const coins = useCountUp(reward.coins * (reward.doubled ? 2 : 1));
  const item = reward.milestone?.render;
  const itemArt = item ? shopRender(item) : undefined;

  return (
    <View style={styles.modalRoot}>
      <View style={styles.scrim} />
      <Animated.View entering={FadeIn} style={styles.card}>
        <Text style={styles.kicker}>Daily box</Text>
        <View style={styles.coinRow}>
          <Coin size={40} />
          <Text style={styles.coinNum}>+{coins}</Text>
        </View>
        {reward.doubled ? (
          <View style={styles.luckyPill}>
            <Text style={styles.luckyText}>LUCKY BOX — 2× coins!</Text>
          </View>
        ) : null}
        {reward.milestone ? (
          <View style={styles.mileRow}>
            <View style={styles.mileArt}>
              {itemArt ? (
                <Image source={itemArt} style={{ width: 48, height: 48, resizeMode: 'contain' }} />
              ) : (
                <Coin size={36} />
              )}
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.mileDay}>Day {reward.milestone.day} milestone</Text>
              <Text numberOfLines={1} style={styles.mileLabel}>
                {reward.milestone.label}
              </Text>
            </View>
          </View>
        ) : null}
        <Pressable onPress={onCollect} style={styles.collect}>
          <Text style={styles.collectText}>Collect</Text>
        </Pressable>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  splash: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 70,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  splashNum: {
    marginTop: 16,
    fontSize: 64,
    fontWeight: '800',
    color: '#fff',
    textShadowColor: 'rgba(0,0,0,0.35)',
    textShadowOffset: { width: 0, height: 4 },
    textShadowRadius: 12,
  },
  splashLabel: { marginTop: 4, fontSize: 17, fontWeight: '700', color: 'rgba(255,255,255,0.9)' },
  groundWrap: { alignItems: 'center', zIndex: 30 },
  chestBadge: {
    marginBottom: 10,
    borderRadius: 999,
    backgroundColor: '#111',
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  chestBadgeText: { color: '#fff', fontWeight: '800', fontSize: 14 },
  chest: { alignItems: 'center', justifyContent: 'center' },
  modalRoot: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 70,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.35)' },
  card: {
    width: '82%',
    maxWidth: 360,
    borderRadius: 28,
    backgroundColor: '#fff',
    padding: 24,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 20 },
    shadowOpacity: 0.35,
    shadowRadius: 60,
    elevation: 20,
  },
  kicker: { fontSize: 13, fontWeight: '800', letterSpacing: 2, textTransform: 'uppercase', color: '#a3a3a3' },
  coinRow: { marginTop: 16, flexDirection: 'row', alignItems: 'center', gap: 10 },
  coinNum: { fontSize: 44, fontWeight: '800', color: '#171717' },
  luckyPill: { marginTop: 6, borderRadius: 999, backgroundColor: '#fff1e6', paddingHorizontal: 12, paddingVertical: 4 },
  luckyText: { fontSize: 12, fontWeight: '800', color: '#ff7a3d' },
  mileRow: {
    marginTop: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 18,
    backgroundColor: '#f5f5f5',
    paddingHorizontal: 14,
    paddingVertical: 10,
    alignSelf: 'stretch',
  },
  mileArt: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  mileDay: { fontSize: 12, fontWeight: '800', letterSpacing: 0.5, textTransform: 'uppercase', color: '#ff7a3d' },
  mileLabel: { fontSize: 15, fontWeight: '700', color: '#171717' },
  collect: {
    marginTop: 20,
    alignSelf: 'stretch',
    borderRadius: 999,
    backgroundColor: '#F2C94C',
    paddingVertical: 13,
    alignItems: 'center',
  },
  collectText: { fontSize: 16, fontWeight: '800', color: '#fff' },
});
