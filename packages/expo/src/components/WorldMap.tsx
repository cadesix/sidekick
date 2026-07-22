import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { memo, useEffect, useRef, useState } from 'react';
import { Text, View, useWindowDimensions } from 'react-native';
import Animated, {
  Easing,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  BOND_MAX,
  BOND_MIN,
  isIslandUnlocked,
  isSessionStartable,
  nextSession,
  sessionFor,
} from '@sidekick/core';

import { Pressable } from './Pressable';
import { type EnvironmentId } from '../three/biomes';
import { ISLANDS, type Island } from '../lib/islands';
import { useSidekickDisplayName } from '../lib/sidekick-name';
import { loadSettings } from '../three/settings';
import { snapshotSessions, useSnapshot } from '../lib/state';
import { useSidekickContext } from '../store/context';

// RN port of sidekick/src/components/world-map.tsx: the full-screen "world map"
// the dock's Map icon opens. A static 3:4 map fills the viewport height (cover),
// fixed and centered — the side overhang is clipped, never panned. Each island
// is locked behind ONE guided session.
// Unlocked islands show an emoji badge + name pill; locked islands show the
// "Chat to unlock" purple lock-pill. Tapping any island opens the centered
// destination modal — travel when unlocked, the session doorway when locked.
//
// The web's `clip-path: circle()` reveal has no RN equivalent, so the mask is
// built by hand: a screen-centered circular container (overflow hidden) scales
// up from 0 while its screen-sized inner content counter-scales by 1/s, so the
// map stays pinned to the viewport as the circle grows over it.

// time-of-day-matched quest map art (mirrors web's MAP_ART), 941×1672
const MAP_ART = {
  day: require('../../assets/images/world-map-quests.webp'),
  evening: require('../../assets/images/world-map-quests-evening.webp'),
  night: require('../../assets/images/world-map-quests-night.webp'),
} as const;
const BOND_ICON = require('../../assets/icons/bond.png');
const MAP_ASPECT = 941 / 1672; // quests art dimensions

const REVEAL_MS = 380;
const CARD_DELAY = 300; // circle has visually landed by here; then the card pops

// brand purple + the hard drop-shadow it presses into (web: #7A5AF8 / #5638c6)
const PURPLE = '#7A5AF8';
const PURPLE_SHADOW = '#5638c6';
// bond bar fill gradient (web: from-[#ffb454] to-[#ff7a3d])
const BOND_FILL: readonly [string, string] = ['#ffb454', '#ff7a3d'];

// an island placed on the map: its identity (from ISLANDS) + where the art puts
// it. left/top are fractions of the world-map-*.webp image (matches the web's %)
type Area = Island & { left: number; top: number };

const AREAS: Area[] = [
  { ...ISLANDS.frostpeak, left: 0.29, top: 0.19 },
  { ...ISLANDS.pinewood, left: 0.73, top: 0.28 },
  { ...ISLANDS.blossom, left: 0.29, top: 0.49 },
  { ...ISLANDS.dunes, left: 0.82, top: 0.57 },
  { ...ISLANDS.palmcove, left: 0.24, top: 0.73 },
  { ...ISLANDS.ember, left: 0.65, top: 0.79 },
];

// each marker box is centered on its map point; box is large enough to never
// clip the lock-pill / name, and box-none so only the pill takes touches
const MARK_W = 200;
const MARK_H = 140;

// markers sit in screen space, so an island near the art's edge can overhang
// the viewport; nudge it back inside. Widths are measured on layout — this
// stands in for the first frame.
const PILL_W_GUESS = 150;
const EDGE_PAD = 10;

// memoized: Home re-renders on every surface toggle; the map only cares about
// its own props, so skip the work (and the heavy image tree) when they're equal.
export const WorldMap = memo(WorldMapImpl);
function WorldMapImpl({
  open,
  onClose,
  onChat,
  onTravel,
  onStartSession,
}: {
  open: boolean;
  onClose: () => void;
  onChat?: () => void;
  onTravel?: (biome: EnvironmentId) => void;
  onStartSession?: (islandId: string) => void;
}) {
  const insets = useSafeAreaInsets();
  const sidekickName = useSidekickDisplayName();
  // live, so the map keeps filling the viewport when it changes (web resize,
  // rotation) instead of staying pinned to whatever it measured at module load
  const { width: SCREEN_W, height: SCREEN_H } = useWindowDimensions();
  // CSS circle(74%) resolves against hypot(w,h)/√2; sized so the deceleration
  // lands just past the corners instead of overshooting off-frame.
  const CIRCLE_D = 2 * 0.74 * (Math.hypot(SCREEN_W, SCREEN_H) / Math.SQRT2);
  const MAP_W = SCREEN_H * MAP_ASPECT; // cover: fills the height, overhangs the sides
  const MAP_X = (SCREEN_W - MAP_W) / 2; // fixed, centered — the overhang is clipped
  const clampX = (x: number, w: number) =>
    Math.min(Math.max(x, w / 2 + EDGE_PAD), SCREEN_W - w / 2 - EDGE_PAD);

  // map art matches the scene's time of day (like web's MAP_ART)
  const mapSrc = MAP_ART[loadSettings().timeOfDay] ?? MAP_ART.day;
  const [selId, setSelId] = useState<string | null>(null);
  // measured marker widths, so edge islands can be clamped into the viewport
  const [pillW, setPillW] = useState<Record<string, number>>({});
  const selected = AREAS.find((a) => a.id === selId) ?? null;
  // the modal keeps rendering the last destination through its fade-out
  const lastSelRef = useRef<Area | null>(null);
  if (selected) lastSelRef.current = selected;
  const shown = selected ?? lastSelRef.current;

  // live Bond score for the bars; session completion drives the locks. Both are
  // server state (plan 20): the snapshot, patched by sessions.complete.
  const snapshot = useSnapshot().data;
  const bond = snapshot?.bond ?? BOND_MIN;
  const sessions = snapshotSessions(snapshot);
  // the island unlocked since they last looked — gets a "new" bubble
  const unseenIsland = useSidekickContext((s) => s.unseenIsland);
  // real gating: the first island is open from launch; every other unlocks by
  // completing its guided session. The rule lives in @sidekick/core so the map
  // and the store can't drift apart on it.
  const isUnlocked = (id: string) => isIslandUnlocked(sessions, id);

  // the top notification rides in with the locked-island modal
  const notifShown = !!selected && !isUnlocked(selected.id);

  // ---- reveal + pan mechanics (unchanged) ----------------------------------
  const [cardIn, setCardIn] = useState(false);
  useEffect(() => {
    if (!open) {
      setCardIn(false);
      setSelId(null); // never reopen onto a stale destination modal
      return;
    }
    const t = setTimeout(() => setCardIn(true), CARD_DELAY);
    return () => clearTimeout(t);
  }, [open]);

  const reveal = useSharedValue(0);
  useEffect(() => {
    reveal.value = withTiming(open ? 1 : 0, {
      duration: REVEAL_MS,
      easing: Easing.out(Easing.cubic), // graceful settle, deceleration stays on-screen
    });
  }, [open, reveal]);

  const circleStyle = useAnimatedStyle(() => ({
    transform: [{ scale: Math.max(reveal.value, 0.0001) }],
  }));
  const contentStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 1 / Math.max(reveal.value, 0.0001) }],
  }));

  // ---- pop / drop-in animations --------------------------------------------
  // bottom bond card: springs in (scale 0.9 → 1, fade) after the reveal lands
  const cardV = useSharedValue(0);
  const wantCard = cardIn && !selected;
  useEffect(() => {
    cardV.value = wantCard
      ? withSpring(1, { damping: 12, stiffness: 170, mass: 0.7 })
      : withTiming(0, { duration: 140 });
  }, [wantCard, cardV]);
  const cardStyle = useAnimatedStyle(() => ({
    opacity: interpolate(cardV.value, [0, 1], [0, 1], 'clamp'),
    transform: [{ scale: 0.9 + 0.1 * cardV.value }],
  }));

  // destination modal: backdrop fade + card spring
  const modalV = useSharedValue(0);
  useEffect(() => {
    modalV.value = selected
      ? withSpring(1, { damping: 14, stiffness: 180, mass: 0.7 })
      : withTiming(0, { duration: 200 });
  }, [selected, modalV]);
  const backdropStyle = useAnimatedStyle(() => ({
    opacity: interpolate(modalV.value, [0, 1], [0, 1], 'clamp'),
  }));
  const modalCardStyle = useAnimatedStyle(() => ({
    opacity: interpolate(modalV.value, [0, 0.6, 1], [0, 1, 1], 'clamp'),
    transform: [{ scale: 0.9 + 0.1 * Math.min(modalV.value, 1) }],
  }));

  // notification banner: drops in from above (translateY -160 → 0)
  const notifV = useSharedValue(0);
  useEffect(() => {
    notifV.value = notifShown
      ? withSpring(1, { damping: 15, stiffness: 160, mass: 0.8 })
      : withTiming(0, { duration: 250 });
  }, [notifShown, notifV]);
  const notifStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: interpolate(notifV.value, [0, 1], [-160, 0], 'clamp') }],
  }));

  // the animated ping ring on the nextSession island (tailwind animate-ping)
  const ping = useSharedValue(0);
  useEffect(() => {
    ping.value = withRepeat(
      withTiming(1, { duration: 1000, easing: Easing.bezier(0, 0, 0.2, 1) }),
      -1,
      false,
    );
  }, [ping]);
  const pingStyle = useAnimatedStyle(() => ({
    opacity: interpolate(ping.value, [0, 1], [0.45, 0]),
    transform: [{ scale: interpolate(ping.value, [0, 1], [1, 1.9]) }],
  }));

  const nextId = nextSession(sessions)?.id;

  return (
    <View
      style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 40 }}
      pointerEvents={open ? 'auto' : 'none'}
    >
      {/* circular mask: centered, scales up while the content counter-scales */}
      <Animated.View
        style={[
          circleStyle,
          {
            position: 'absolute',
            left: (SCREEN_W - CIRCLE_D) / 2,
            top: (SCREEN_H - CIRCLE_D) / 2,
            width: CIRCLE_D,
            height: CIRCLE_D,
            borderRadius: CIRCLE_D / 2,
            overflow: 'hidden',
          },
        ]}
      >
        <Animated.View
          style={[
            contentStyle,
            {
              position: 'absolute',
              left: (CIRCLE_D - SCREEN_W) / 2,
              top: (CIRCLE_D - SCREEN_H) / 2,
              width: SCREEN_W,
              height: SCREEN_H,
            },
          ]}
        >
          {/* sky→sea gradient backs the letterbox bands while the art loads */}
          <LinearGradient
            colors={['#b795c9', '#3e97d9']}
            style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
          />

          {/* the 3:4 map fills the viewport height; it's wider than the screen,
              so it sits centered and the overhang is clipped — fixed, no pan */}
          <View
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: SCREEN_W,
              height: SCREEN_H,
              overflow: 'hidden',
            }}
          >
            <Pressable
              onPress={() => setSelId(null)}
              style={{ position: 'absolute', left: MAP_X, top: 0, width: MAP_W, height: SCREEN_H }}
            >
              <Image
                source={mapSrc}
                style={{ width: MAP_W, height: SCREEN_H }}
                contentFit="cover"
              />
            </Pressable>
            {AREAS.map((a) => {
              const unlocked = isUnlocked(a.id);
              const session = sessionFor(a.id);
              const startable = isSessionStartable(sessions, a.id);
              const isNext = nextId === a.id;
              // low-map islands flip their card ABOVE the pin so nothing clips
              // at the bottom edge on tall (9:16) screens
              const cardAbove = a.top > 0.6;
              const cx = clampX(a.left * MAP_W + MAP_X, pillW[a.id] ?? PILL_W_GUESS);
              return (
                <View
                  key={a.id}
                  pointerEvents="box-none"
                  style={{
                    position: 'absolute',
                    left: cx - MARK_W / 2,
                    top: a.top * SCREEN_H - MARK_H / 2,
                    width: MARK_W,
                    height: MARK_H,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Pressable
                    onPress={() => setSelId(a.id)}
                    onLayout={(e) => {
                      const w = e.nativeEvent.layout.width;
                      setPillW((p) => (p[a.id] === w ? p : { ...p, [a.id]: w }));
                    }}
                    accessibilityLabel={a.name}
                    style={{
                      flexDirection: cardAbove ? 'column-reverse' : 'column',
                      alignItems: 'center',
                      gap: 6,
                    }}
                  >
                    {unlocked ? (
                      <>
                        {/* freshly opened and not yet looked at — matches the
                            dot on the dock's map icon, and clears with it */}
                        {a.id === unseenIsland ? (
                          <View
                            pointerEvents="none"
                            style={{
                              position: 'absolute',
                              top: -9,
                              right: 30,
                              zIndex: 2,
                              borderRadius: 999,
                              backgroundColor: '#FF3B30',
                              paddingHorizontal: 6,
                              paddingVertical: 1.5,
                              borderWidth: 1.5,
                              borderColor: 'rgba(255,255,255,0.9)',
                            }}
                          >
                            <Text style={{ fontSize: 9, fontWeight: '800', color: '#fff', letterSpacing: 0.4 }}>
                              NEW
                            </Text>
                          </View>
                        ) : null}
                        <View
                          style={{
                            width: 36,
                            height: 36,
                            borderRadius: 18,
                            backgroundColor: a.color,
                            alignItems: 'center',
                            justifyContent: 'center',
                            borderWidth: 2,
                            borderColor: '#fff',
                            shadowColor: '#000',
                            shadowOffset: { width: 0, height: 2 },
                            shadowOpacity: 0.4,
                            shadowRadius: 3.5,
                            elevation: 4,
                          }}
                        >
                          <Text style={{ fontSize: 17 }}>{a.emoji}</Text>
                        </View>
                        <View
                          style={{
                            borderRadius: 999,
                            backgroundColor: 'rgba(255,255,255,0.95)',
                            paddingHorizontal: 8,
                            paddingVertical: 2,
                            overflow: 'hidden',
                            shadowColor: '#000',
                            shadowOffset: { width: 0, height: 1 },
                            shadowOpacity: 0.3,
                            shadowRadius: 4,
                            elevation: 2,
                          }}
                        >
                          <Text
                            numberOfLines={1}
                            style={{ fontSize: 11, fontWeight: '700', color: '#262626' }}
                          >
                            {a.name}
                          </Text>
                        </View>
                      </>
                    ) : session ? (
                      // locked: the lock icon IS the marker (no emoji circle) —
                      // "Chat to unlock" primary, the island name secondary
                      <View style={{ position: 'relative' }}>
                        {isNext ? (
                          <Animated.View
                            pointerEvents="none"
                            style={[
                              pingStyle,
                              {
                                position: 'absolute',
                                top: -6,
                                left: -6,
                                right: -6,
                                bottom: -6,
                                borderRadius: 20,
                                backgroundColor: 'rgba(122,90,248,0.45)',
                              },
                            ]}
                          />
                        ) : null}
                        <View
                          style={{
                            flexDirection: 'row',
                            alignItems: 'center',
                            gap: 8,
                            borderRadius: 16,
                            paddingHorizontal: 12,
                            paddingVertical: 8,
                            backgroundColor: startable ? PURPLE : 'rgba(0,0,0,0.45)',
                            shadowColor: startable ? PURPLE_SHADOW : '#000',
                            shadowOffset: { width: 0, height: startable ? 3 : 1 },
                            shadowOpacity: startable ? 1 : 0.3,
                            shadowRadius: startable ? 0 : 4,
                            elevation: startable ? 5 : 3,
                          }}
                        >
                          <Ionicons name="lock-closed" size={15} color="#fff" />
                          <View>
                            <Text style={{ fontSize: 12, fontWeight: '800', color: '#fff' }}>
                              Chat to unlock
                            </Text>
                            <Text
                              style={{
                                fontSize: 10,
                                fontWeight: '600',
                                color: startable ? 'rgba(255,255,255,0.75)' : 'rgba(255,255,255,0.6)',
                              }}
                            >
                              {a.name}
                            </Text>
                          </View>
                        </View>
                      </View>
                    ) : null}
                  </Pressable>
                </View>
              );
            })}
          </View>

          {/* top scrim + close, like a map app header */}
          <View
            style={{ position: 'absolute', top: 0, left: 0, right: 0 }}
            pointerEvents="box-none"
          >
            <LinearGradient
              colors={['rgba(0,0,0,0.28)', 'rgba(0,0,0,0)']}
              style={{ position: 'absolute', top: 0, left: 0, right: 0, height: insets.top + 92 }}
              pointerEvents="none"
            />
            <View
              className="flex-row items-center justify-between px-4"
              style={{ paddingTop: Math.max(insets.top, 12) }}
            >
              {/* travel back to the home meadow — always available so the user is
                  never stranded in a biome */}
              <Pressable
                onPress={() => onTravel?.('meadow')}
                accessibilityLabel="Travel home"
                className="h-9 flex-row items-center rounded-full"
                style={{ backgroundColor: 'rgba(255,255,255,0.9)', paddingHorizontal: 12, gap: 6 }}
              >
                <Ionicons name="home" size={16} color="#404040" />
                <Text style={{ fontSize: 14, fontWeight: '700', color: '#404040' }}>Home</Text>
              </Pressable>
              <Pressable
                onPress={onClose}
                accessibilityLabel="Close map"
                className="h-9 w-9 rounded-full items-center justify-center"
                style={{ backgroundColor: 'rgba(255,255,255,0.9)' }}
              >
                <Ionicons name="close" size={20} color="#404040" />
              </Pressable>
            </View>
          </View>

          {/* Default bottom card — the Bond progress bar. Hides when a marker's
              destination modal takes over. Tapping it starts a chat. */}
          {cardIn && !selected ? (
            <Animated.View
              style={[cardStyle, { position: 'absolute', left: 12, right: 12, bottom: Math.max(insets.bottom, 12) }]}
            >
              <Pressable
                onPress={onChat}
                style={({ pressed }) => ({
                  borderRadius: 26,
                  backgroundColor: 'rgba(255,255,255,0.85)',
                  padding: 16,
                  transform: [{ scale: pressed ? 0.98 : 1 }],
                  shadowColor: '#000',
                  shadowOffset: { width: 0, height: 10 },
                  shadowOpacity: 0.28,
                  shadowRadius: 20,
                  elevation: 10,
                })}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <View style={{ flex: 1, height: 10, borderRadius: 999, backgroundColor: 'rgba(0,0,0,0.1)', overflow: 'hidden' }}>
                    <LinearGradient
                      colors={BOND_FILL}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 0 }}
                      style={{ height: '100%', width: `${(bond / BOND_MAX) * 100}%`, borderRadius: 999 }}
                    />
                  </View>
                  <Text style={{ fontSize: 14, fontWeight: '800', color: '#111' }}>{bond}%</Text>
                </View>
                <Text style={{ marginTop: 8, textAlign: 'center', fontSize: 14, fontWeight: '600', color: 'rgba(17,17,17,0.6)' }}>
                  Grow our bond to explore the world
                </Text>
              </Pressable>
            </Animated.View>
          ) : null}

          {/* Destination modal — centered, minimal: bond progress toward the
              unlock (when locked), one pill CTA. Backdrop tap dismisses. */}
          <View
            style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' }}
            pointerEvents={selected ? 'auto' : 'none'}
          >
            <Animated.View
              style={[backdropStyle, { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.3)' }]}
            >
              <Pressable accessibilityLabel="Dismiss" onPress={() => setSelId(null)} style={{ flex: 1 }} />
            </Animated.View>

            {shown ? (
              <Animated.View
                style={[
                  modalCardStyle,
                  {
                    width: SCREEN_W - 64,
                    maxWidth: 384,
                    borderRadius: 28,
                    backgroundColor: '#fff',
                    padding: 24,
                    shadowColor: '#000',
                    shadowOffset: { width: 0, height: 20 },
                    shadowOpacity: 0.35,
                    shadowRadius: 40,
                    elevation: 24,
                  },
                ]}
              >
                {!isUnlocked(shown.id) ? (
                  <>
                    {/* bond score, up top */}
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                      <Image source={BOND_ICON} style={{ width: 20, height: 20 }} contentFit="contain" />
                      <Text style={{ fontSize: 12, fontWeight: '700', color: '#737373', fontVariant: ['tabular-nums'] }}>
                        bond score
                      </Text>
                      <Text style={{ marginLeft: 'auto', fontSize: 13, fontWeight: '700', color: '#262626', fontVariant: ['tabular-nums'] }}>
                        {bond}%
                      </Text>
                    </View>
                    <View style={{ height: 10, width: '100%', borderRadius: 999, backgroundColor: 'rgba(0,0,0,0.1)', overflow: 'hidden' }}>
                      <LinearGradient
                        colors={BOND_FILL}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 0 }}
                        style={{ height: '100%', width: `${(bond / BOND_MAX) * 100}%`, borderRadius: 999 }}
                      />
                    </View>

                    <Text style={{ marginTop: 28, textAlign: 'center', fontSize: 19, lineHeight: 24, fontWeight: '800', color: '#171717' }}>
                      Start a Guided Chat to Unlock
                    </Text>

                    <Pressable
                      onPress={() => {
                        const startable = isSessionStartable(sessions, shown.id);
                        const target = startable ? sessionFor(shown.id) : nextSession(sessions);
                        setSelId(null);
                        if (target) onStartSession?.(target.id);
                      }}
                      style={({ pressed }) => ({
                        marginTop: 16,
                        borderRadius: 999,
                        backgroundColor: PURPLE,
                        paddingVertical: 14,
                        alignItems: 'center',
                        justifyContent: 'center',
                        transform: [{ translateY: pressed ? 3 : 0 }],
                        shadowColor: PURPLE_SHADOW,
                        shadowOffset: { width: 0, height: pressed ? 1 : 4 },
                        shadowOpacity: 1,
                        shadowRadius: 0,
                        elevation: 6,
                      })}
                    >
                      <Text style={{ fontSize: 16, fontWeight: '700', color: '#fff' }}>Chat</Text>
                    </Pressable>
                  </>
                ) : (
                  // travel confirmation: the big question + a chunky purple pill
                  // with a hard (0-blur) drop shadow it presses down into
                  <>
                    <Text style={{ paddingHorizontal: 8, paddingVertical: 32, textAlign: 'center', fontSize: 26, lineHeight: 30, fontWeight: '800', color: '#171717' }}>
                      Travel to {shown.name}?
                    </Text>
                    <Pressable
                      onPress={() => {
                        const biome = shown.biome;
                        setSelId(null);
                        onTravel?.(biome);
                      }}
                      style={({ pressed }) => ({
                        borderRadius: 999,
                        backgroundColor: PURPLE,
                        paddingVertical: 16,
                        alignItems: 'center',
                        justifyContent: 'center',
                        transform: [{ translateY: pressed ? 4 : 0 }],
                        shadowColor: PURPLE_SHADOW,
                        shadowOffset: { width: 0, height: pressed ? 1 : 5 },
                        shadowOpacity: 1,
                        shadowRadius: 0,
                        elevation: 6,
                      })}
                    >
                      <Text style={{ fontSize: 17, fontWeight: '700', color: '#fff' }}>Continue</Text>
                    </Pressable>
                  </>
                )}
              </Animated.View>
            ) : null}
          </View>

          {/* Notification banner — drops in from the top in sync with the locked
              island modal, like a push from the sidekick. */}
          <Animated.View
            pointerEvents="none"
            style={[
              notifStyle,
              {
                position: 'absolute',
                top: Math.max(insets.top, 12),
                left: 12,
                right: 12,
                alignItems: 'center',
                zIndex: 30,
              },
            ]}
          >
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 12,
                width: '100%',
                maxWidth: 384,
                borderRadius: 22,
                backgroundColor: 'rgba(255,255,255,0.9)',
                paddingHorizontal: 14,
                paddingVertical: 12,
                shadowColor: '#000',
                shadowOffset: { width: 0, height: 12 },
                shadowOpacity: 0.28,
                shadowRadius: 34,
                elevation: 14,
              }}
            >
              {/* the iOS Messages app tile — green rounded square + white speech
                  bubble, matching the onboarding notif beat */}
              <View style={{ width: 40, height: 40, borderRadius: 10, backgroundColor: '#34C759', alignItems: 'center', justifyContent: 'center' }}>
                <Ionicons name="chatbubble" size={22} color="#fff" />
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={{ fontSize: 13, fontWeight: '800', color: '#171717' }}>{sidekickName}</Text>
                <Text style={{ fontSize: 13, fontWeight: '500', lineHeight: 17, color: '#525252' }}>
                  Complete a star chat to unlock this!
                </Text>
              </View>
            </View>
          </Animated.View>
        </Animated.View>
      </Animated.View>
    </View>
  );
}
