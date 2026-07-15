import { useEffect, useRef, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { cancelAnimation, Easing, FadeIn, useAnimatedStyle, useSharedValue, withDelay, withRepeat, withSequence, withSpring, withTiming } from 'react-native-reanimated';

import type { BoxReward } from '@sidekick/core';

import type { OverheadTarget } from './SidekickCanvas';
import { shopRender } from '../three/shop-renders';

// RN port of sidekick/src/components/daily-box.tsx — the daily-box flow FX:
// StreakSplash (first session of day), GroundBox (the DOM layer pinned over the
// 3D chest), and BoxRewardsModal (coins count-up + milestone). GroundBox is an
// invisible tap target + badge/sparkles/burst pinned to the 3D chest via the
// canvas ground projection; the tap drives the real 3D lid-swing pop.

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

// ---- GroundBox: DOM layer pinned over the 3D chest --------------------------
// A 150×150 box the canvas anchors bottom-center over the 3D chest (via the
// `ground` projection). Invisible tap target + bouncing badge + sparkles;
// tapping fires onTap (canvas plays the real rattle → lid-swing → light burst),
// the confetti/flash play over it, and onOpened fires when the chest is spent.
const BOX = 150;
const CONFETTI_COLORS = ['#F2C94C', '#FF7A3D', '#5BF76B', '#6BB6FF', '#FF5B4D', '#B57BFF'];

// deterministic scatter of chip i → outward offset (mirrors web's scatter())
function scatter(i: number, n: number, r: number): { x: number; y: number } {
  const a = (i / n) * Math.PI * 2 + (i % 2 ? 0.4 : 0);
  const d = r * (0.55 + ((i * 37) % 45) / 100);
  return { x: Math.cos(a) * d, y: Math.sin(a) * d - r * 0.15 };
}

function ConfettiChip({ i }: { i: number }) {
  const t = useSharedValue(0);
  useEffect(() => {
    t.value = withDelay(700, withTiming(1, { duration: 900, easing: Easing.out(Easing.cubic) }));
  }, [t]);
  const { x, y } = scatter(i, 14, 118);
  const style = useAnimatedStyle(() => ({
    opacity: 1 - t.value,
    transform: [
      { translateX: x * t.value },
      { translateY: y * t.value + t.value * t.value * 60 },
      { rotate: `${t.value * 320}deg` },
      { scale: 0.4 + t.value * 0.6 },
    ],
  }));
  return (
    <Animated.View
      style={[
        { position: 'absolute', left: BOX / 2 - 6, top: BOX / 2 - 7, width: 12, height: 14, borderRadius: 3, backgroundColor: CONFETTI_COLORS[i % CONFETTI_COLORS.length] },
        style,
      ]}
    />
  );
}

export function GroundBox({
  ground,
  hidden,
  onTap,
  onOpened,
}: {
  ground: OverheadTarget;
  hidden?: boolean;
  onTap: () => void;
  onOpened: () => void;
}) {
  const [burst, setBurst] = useState(false);
  const bounce = useSharedValue(0);
  const flash = useSharedValue(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const opened = useRef(false); // ref guard: same-frame double-tap can't schedule twice
  useEffect(() => {
    bounce.value = withRepeat(withTiming(1, { duration: 520, easing: Easing.inOut(Easing.quad) }), -1, true);
    return () => {
      cancelAnimation(bounce);
      if (timer.current) clearTimeout(timer.current);
    };
  }, [bounce]);

  const tap = () => {
    if (opened.current) return;
    opened.current = true;
    setBurst(true);
    onTap(); // canvas starts rattle → lid swing → light
    flash.value = withDelay(620, withSequence(withTiming(1, { duration: 120 }), withTiming(0, { duration: 380 })));
    timer.current = setTimeout(onOpened, 1200); // light pours out ~0.62s; modal rides the beam
  };

  // pin bottom-center over the projected chest ground point; hide when behind
  // the camera / in studio (visible === 0) or while a surface covers the scene
  const wrapStyle = useAnimatedStyle(() => ({
    opacity: hidden || ground.visible.value < 0.5 ? 0 : 1,
    transform: [
      { translateX: ground.x.value - BOX / 2 },
      { translateY: ground.y.value - BOX },
    ],
  }));
  const badgeStyle = useAnimatedStyle(() => ({ transform: [{ translateY: -6 - bounce.value * 6 }] }));
  const flashStyle = useAnimatedStyle(() => ({ opacity: flash.value }));

  return (
    <Animated.View
      pointerEvents={hidden ? 'none' : 'box-none'}
      style={[{ position: 'absolute', left: 0, top: 0, width: BOX, height: BOX }, wrapStyle]}
    >
      {!burst ? (
        <>
          <Animated.View style={[{ position: 'absolute', top: -18, alignSelf: 'center' }, badgeStyle]}>
            <View style={styles.chestBadge}>
              <Text style={styles.chestBadgeText}>Daily Chest!</Text>
            </View>
          </Animated.View>
          <Text style={{ position: 'absolute', left: 4, top: 36, fontSize: 18 }}>✨</Text>
          <Text style={{ position: 'absolute', right: 8, top: 64, fontSize: 15 }}>✨</Text>
        </>
      ) : (
        <>
          <Animated.View style={[styles.flash, flashStyle]} />
          {Array.from({ length: 14 }, (_, i) => (
            <ConfettiChip key={i} i={i} />
          ))}
        </>
      )}
      {/* invisible tap target covering the chest */}
      <Pressable onPress={tap} accessibilityLabel="Open daily box" style={StyleSheet.absoluteFill} />
    </Animated.View>
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
  chestBadge: {
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.92)',
    paddingHorizontal: 14,
    paddingVertical: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.12,
    shadowRadius: 0,
  },
  chestBadgeText: { color: '#111', fontWeight: '800', fontSize: 14 },
  flash: {
    position: 'absolute',
    left: BOX * 0.2,
    top: BOX * 0.2,
    width: BOX * 0.6,
    height: BOX * 0.6,
    borderRadius: BOX * 0.3,
    backgroundColor: 'rgba(255,252,235,0.85)',
  },
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
