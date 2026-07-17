import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useMemo, useState } from 'react';
import { Dimensions, Modal, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle } from 'react-native-svg';

import {
  buildCatalogProducts,
  localDay,
  rarityOf,
  todaysShop,
  type Product,
  type Rarity,
} from '@sidekick/core';

import { Pressable } from './Pressable';
import { useDeferredFlag } from '../lib/useDeferredFlag';
import { MANIFEST } from '../three/cosmetics-manifest';
import { shopRender } from '../three/shop-renders';
import { useCosmeticVersion } from '../store/cosmeticVersion';
import { useEconomy } from '../store/economy';
import {
  SHOP_COLORS,
  SLOT_LABEL,
  WARDROBE_SLOTS,
  type CosmeticsControls,
  type Wardrobe,
  type WardrobeSlot,
} from '../three/wardrobe';

// Full-screen RN "Shop" — a focused daily drop (2 featured heroes + a daily
// row) that restocks at local midnight. Everything is gamified to reward the
// daily open: cards spring in on a stagger (which also hides the PNG decode), a
// live countdown ticks toward the restock (turning red + pulsing in the last
// hour), Rare+ cards get a sweeping gloss, and the featured heroes carry a
// rarity-tinted glow + a gentle float. Tapping a product opens the buy / equip
// detail modal that drives the live 3D character.
//
// Parity note vs web: product art is a STATIC pre-rendered PNG (three/
// shop-renders); web's live spinning ItemTurntable would be a second GL context
// in the sheet, which we avoid. The old "Browse all" full-catalog grid is gone
// on purpose — the shop is the daily drop, not a store directory.

const { height: SCREEN_H } = Dimensions.get('window');

// CSS `linear-gradient(160deg, …)` → expo-linear-gradient start/end. 160deg
// points mostly down, tilted slightly right (matches the web card fills).
const GRAD_START = { x: 0.33, y: 0.03 } as const;
const GRAD_END = { x: 0.67, y: 0.97 } as const;

// ---- product art: pre-rendered PNG, else a tinted / neutral placeholder ------
function ProductArt({ p, size, radius = 16 }: { p: Product; size: number; radius?: number }) {
  const render = shopRender(p.renderKey);
  if (render != null) {
    return <Image source={render} style={{ width: size, height: size }} contentFit="contain" />;
  }
  if (p.tint) {
    return <View style={{ width: size, height: size, borderRadius: radius, backgroundColor: p.tint }} />;
  }
  if (p.tex != null) {
    return (
      <Image
        source={p.tex as number}
        style={{ width: size, height: size, borderRadius: radius }}
        contentFit="cover"
      />
    );
  }
  return <View style={{ width: size, height: size, borderRadius: radius, backgroundColor: '#e9edf1' }} />;
}

// exact replica of the web inline-SVG coin (gold disc + two concentric rings)
function Coin({ size = 16 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 16 16">
      <Circle cx={8} cy={8} r={7} fill="#f4c634" />
      <Circle cx={8} cy={8} r={7} fill="none" stroke="#d99e1b" strokeWidth={1.6} />
      <Circle cx={8} cy={8} r={4.2} fill="none" stroke="#d99e1b" strokeWidth={1.2} />
    </Svg>
  );
}

function PriceOrOwned({ owned, cost }: { owned: boolean; cost: number }) {
  return owned ? (
    <Text style={styles.ownedText}>Owned</Text>
  ) : (
    <View style={styles.priceRow}>
      <Coin size={14} />
      <Text style={styles.priceText}>{cost}</Text>
    </View>
  );
}

function WornBadge({ small }: { small?: boolean }) {
  return (
    <View style={[styles.wornBadge, small && styles.wornBadgeSmall]}>
      <Ionicons name="checkmark" size={small ? 13 : 15} color="#fff" />
    </View>
  );
}

// Sweeping diagonal gloss — the classic "shiny loot card" tell. Runs on Rare+
// cards only. One bar clipped to the card, sweeps across (~0.85s) then rests
// off-screen (~3s) so it reads as an occasional glint, not a strobe.
function ShineSweep({ radius }: { radius: number }) {
  const sx = useSharedValue(0);
  useEffect(() => {
    sx.value = withRepeat(
      withSequence(
        withDelay(400, withTiming(1, { duration: 850, easing: Easing.in(Easing.cubic) })),
        withDelay(2800, withTiming(0, { duration: 0 })), // hold off-screen, then snap back
      ),
      -1,
      false,
    );
    return () => cancelAnimation(sx);
  }, [sx]);
  const barStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: -70 + sx.value * 260 }, { rotate: '16deg' }],
  }));
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { borderRadius: radius, overflow: 'hidden' }]}>
      <Animated.View style={[{ position: 'absolute', top: -40, bottom: -40, width: 46 }, barStyle]}>
        <LinearGradient
          colors={['transparent', 'rgba(255,255,255,0.5)', 'transparent']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={{ flex: 1 }}
        />
      </Animated.View>
    </View>
  );
}

// A featured (big) hero / daily card. `play` triggers the staggered spring-in
// (per `index`); featured cards additionally carry a rarity-tinted glow and a
// slow float. Defined at module scope so the animations survive re-renders.
function ShopCard({
  p,
  big,
  owned,
  worn,
  play,
  index,
  onPress,
}: {
  p: Product;
  big?: boolean;
  owned: boolean;
  worn: boolean;
  play: boolean;
  index: number;
  onPress: () => void;
}) {
  const r: Rarity = rarityOf(p.cost);
  const shine = r.label !== 'Common';
  const rv = useSharedValue(0); // reveal (pop-in)
  const fl = useSharedValue(0); // idle float (featured only)

  useEffect(() => {
    if (play) rv.value = withDelay(index * 65, withSpring(1, { damping: 13, stiffness: 160, mass: 0.7 }));
    else {
      cancelAnimation(rv);
      rv.value = 0;
    }
  }, [play, index, rv]);

  useEffect(() => {
    if (!big) return;
    fl.value = withRepeat(withTiming(1, { duration: 2000, easing: Easing.inOut(Easing.quad) }), -1, true);
    return () => cancelAnimation(fl);
  }, [big, fl]);

  const aStyle = useAnimatedStyle(() => ({
    opacity: rv.value,
    transform: [
      { translateY: (1 - rv.value) * 16 - (big ? fl.value * 4 : 0) },
      { scale: 0.88 + rv.value * 0.12 },
    ],
  }));

  return (
    <Animated.View
      style={[
        aStyle,
        big && { borderRadius: 24, shadowColor: r.chip, shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.5, shadowRadius: 16, elevation: 10 },
      ]}
    >
      <Pressable onPress={onPress} style={({ pressed }) => [pressed && styles.pressed2]}>
        <LinearGradient
          colors={r.grad}
          start={GRAD_START}
          end={GRAD_END}
          style={big ? styles.featuredCard : styles.dailyCard}
        >
          {big ? (
            <View style={[styles.rarityChip, { backgroundColor: r.chip }]}>
              <Text style={styles.rarityChipText}>{r.label.toUpperCase()}</Text>
            </View>
          ) : null}
          <View style={{ alignItems: 'center', marginTop: big ? 4 : 0 }}>
            <ProductArt p={p} size={big ? 144 : 96} />
          </View>
          <Text numberOfLines={1} style={big ? styles.featuredName : styles.dailyName}>
            {p.name}
          </Text>
          <PriceOrOwned owned={owned} cost={p.cost} />
          {shine ? <ShineSweep radius={big ? 24 : 20} /> : null}
        </LinearGradient>
        {worn ? <WornBadge small={!big} /> : null}
      </Pressable>
    </Animated.View>
  );
}

const msToMidnight = () => {
  const d = new Date();
  d.setHours(24, 0, 0, 0);
  return d.getTime() - Date.now();
};
const pad = (n: number) => String(n).padStart(2, '0');

// Live restock countdown — the urgency anchor. Ticks every second (isolated so
// only this pill re-renders) and escalates to a red, pulsing state in the final
// hour. Own component so its 1s cadence never re-renders the whole sheet.
function Countdown() {
  const [ms, setMs] = useState(() => msToMidnight());
  useEffect(() => {
    const t = setInterval(() => setMs(msToMidnight()), 1000);
    return () => clearInterval(t);
  }, []);
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const urgent = total < 3600;

  const pulse = useSharedValue(0);
  useEffect(() => {
    pulse.value = withRepeat(withTiming(1, { duration: 850, easing: Easing.inOut(Easing.quad) }), -1, true);
    return () => cancelAnimation(pulse);
  }, [pulse]);
  const iconStyle = useAnimatedStyle(() => ({
    opacity: urgent ? 0.55 + pulse.value * 0.45 : 1,
    transform: [{ scale: urgent ? 1 + pulse.value * 0.14 : 1 }],
  }));

  return (
    <View style={[styles.restockPill, urgent && styles.restockPillUrgent]}>
      <Animated.View style={iconStyle}>
        <Ionicons name="time" size={13} color={urgent ? '#ef4444' : '#ff7a3d'} />
      </Animated.View>
      <Text style={[styles.restockText, urgent && styles.restockTextUrgent]}>
        {h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`}
      </Text>
    </View>
  );
}

export function ShopSheet({
  open,
  onClose,
  controls,
}: {
  open: boolean;
  onClose: () => void;
  controls: CosmeticsControls | null;
}) {
  const insets = useSafeAreaInsets();

  // economy store (reactive: reading coins + inventory re-renders on change)
  const coins = useEconomy((s) => s.coins);
  const inventory = useEconomy((s) => s.inventory);
  const spendCoins = useEconomy((s) => s.spendCoins);
  const addToInventory = useEconomy((s) => s.addToInventory);

  const [detail, setDetail] = useState<Product | null>(null);
  const [wardrobe, setWardrobe] = useState<Wardrobe | null>(null);

  // slide the whole takeover up from the bottom
  const progress = useSharedValue(0);
  useEffect(() => {
    progress.value = withTiming(open ? 1 : 0, { duration: 300 });
  }, [open, progress]);
  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: (1 - progress.value) * SCREEN_H }],
    // fully hide when closed (RN-web root can be taller than SCREEN_H, so the
    // slide alone leaves a peeking sliver)
    opacity: progress.value < 0.001 ? 0 : 1,
  }));

  // snapshot the worn outfit when the sheet opens; clear any open detail on
  // close so its Modal can't linger over the home screen
  useEffect(() => {
    setDetail(null);
    if (open && controls) setWardrobe(controls.getState());
  }, [open, controls]);

  // This sheet is always mounted (slides via transform), so its content — the
  // countdown's 1s interval, the shine sweeps, the featured float — would loop
  // forever even while closed. `active` unmounts the content 320ms after the
  // slide-out finishes; `revealed` fires the card stagger 120ms after open (over
  // the slide-in, which also masks the PNG decode).
  const active = useDeferredFlag(open, { offDelay: 320 });
  const revealed = useDeferredFlag(open, { onDelay: 120 });

  // catalog is static (manifest is bundled); the daily drop derives from it.
  // buildCatalogProducts gates the offer set to the curated shop-catalog.json
  // (authored in the Asset Manager) — only cataloged items can rotate in.
  const products = useMemo(
    () =>
      buildCatalogProducts({
        slots: WARDROBE_SLOTS,
        slotLabel: SLOT_LABEL,
        colors: SHOP_COLORS,
        manifest: MANIFEST,
      }),
    [],
  );
  const seed = localDay(Date.now());
  const { featured, daily } = useMemo(() => todaysShop(products, seed), [products, seed]);

  const sync = () => {
    if (controls) setWardrobe(controls.getState());
    useCosmeticVersion.getState().bump(); // regenerate the live head avatars
  };
  const isWorn = (p: Product) => {
    const st = wardrobe?.[p.slot as WardrobeSlot];
    if (!st?.equipped) return false;
    return p.variantId
      ? st.variantId === p.variantId && !st.color
      : st.color?.toLowerCase() === p.color?.toLowerCase();
  };
  const owns = (p: Product) => inventory.includes(p.renderKey);
  const wear = (p: Product) => {
    if (!controls) return;
    if (p.variantId) controls.equipVariant(p.slot as WardrobeSlot, p.variantId);
    else if (p.color) controls.setColor(p.slot as WardrobeSlot, p.color);
    sync();
  };
  const takeOff = (p: Product) => {
    controls?.remove(p.slot as WardrobeSlot);
    sync();
  };
  const buy = (p: Product) => {
    if (!spendCoins(p.cost)) return;
    addToInventory(p.renderKey);
  };

  const detailWorn = detail ? isWorn(detail) : false;
  const detailOwned = detail ? owns(detail) : false;
  const canAfford = detail ? coins >= detail.cost : false;
  const detailRarity = detail ? rarityOf(detail.cost) : null;

  return (
    <Animated.View style={[styles.takeover, sheetStyle]} pointerEvents={open ? 'auto' : 'none'}>
      {/* sticky header: title + coin balance + close */}
      <View style={[styles.header, { paddingTop: Math.max(insets.top, 12) }]}>
        <Text style={styles.title}>Shop</Text>
        <View style={styles.headerRight}>
          <View style={styles.coinPill}>
            <Coin size={16} />
            <Text style={styles.coinPillText}>{coins}</Text>
          </View>
          <Pressable onPress={onClose} accessibilityLabel="Close shop" style={styles.closeBtn}>
            <Ionicons name="close" size={20} color="#737373" />
          </Pressable>
        </View>
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          paddingHorizontal: 24,
          paddingTop: 8,
          paddingBottom: Math.max(insets.bottom, 20) + 12,
        }}
        showsVerticalScrollIndicator={false}
      >
        {/* content unmounts when the shop is closed so its loops don't run idle */}
        {active ? (
          <>
            {/* Today's drop header + live restock countdown */}
            <View style={styles.sectionRow}>
              <View>
                <Text style={styles.sectionTitle}>Today&apos;s Shop</Text>
                <Text style={styles.sectionSub}>Fresh picks — gone at midnight</Text>
              </View>
              <Countdown />
            </View>

            {/* featured heroes (premium, larger) */}
            <View style={styles.grid}>
              {featured.map((p, i) => (
                <View key={p.renderKey} style={styles.gridCell}>
                  <ShopCard p={p} big owned={owns(p)} worn={isWorn(p)} play={revealed} index={i} onPress={() => setDetail(p)} />
                </View>
              ))}
            </View>

            {/* daily row */}
            <View style={[styles.grid, { marginTop: 14 }]}>
              {daily.map((p, i) => (
                <View key={p.renderKey} style={styles.gridCell}>
                  <ShopCard p={p} owned={owns(p)} worn={isWorn(p)} play={revealed} index={featured.length + i} onPress={() => setDetail(p)} />
                </View>
              ))}
            </View>
          </>
        ) : null}
      </ScrollView>

      {/* item detail modal */}
      <Modal visible={detail != null} transparent animationType="fade" onRequestClose={() => setDetail(null)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setDetail(null)}>
          {detail && detailRarity ? (
            <Pressable style={styles.modalCard} onPress={() => {}}>
              <LinearGradient
                colors={detailRarity.grad}
                start={GRAD_START}
                end={GRAD_END}
                style={styles.modalArt}
              >
                <View style={[styles.rarityChip, { backgroundColor: detailRarity.chip }]}>
                  <Text style={styles.rarityChipText}>{detailRarity.label.toUpperCase()}</Text>
                </View>
                <View style={{ alignItems: 'center', marginTop: 6 }}>
                  <ProductArt p={detail} size={208} />
                </View>
                {detailRarity.label !== 'Common' ? <ShineSweep radius={22} /> : null}
              </LinearGradient>
              <Text style={styles.modalName}>{detail.name}</Text>

              {detailOwned ? (
                detailWorn ? (
                  <Pressable
                    onPress={() => takeOff(detail)}
                    style={({ pressed }) => [styles.btnNeutral, pressed && styles.pressed3]}
                  >
                    <Text style={styles.btnNeutralText}>Take off</Text>
                  </Pressable>
                ) : (
                  <Pressable
                    onPress={() => wear(detail)}
                    style={({ pressed }) => [styles.btnEquip, pressed && styles.pressed3]}
                  >
                    <Text style={styles.btnEquipText}>Equip</Text>
                  </Pressable>
                )
              ) : (
                <Pressable
                  disabled={!canAfford}
                  onPress={() => buy(detail)}
                  style={({ pressed }) => [
                    styles.btnBuy,
                    !canAfford && styles.btnDisabled,
                    pressed && canAfford && styles.pressed3,
                  ]}
                >
                  <Coin size={16} />
                  <Text style={[styles.btnBuyText, !canAfford && styles.btnDisabledText]}>
                    Buy for {detail.cost}
                  </Text>
                </Pressable>
              )}
            </Pressable>
          ) : (
            <View />
          )}
        </Pressable>
      </Modal>
    </Animated.View>
  );
}

// hard "0 Npx 0" bottom shadows (the squishy-card / 3D-button look on web)
const hardShadow = (height: number, color: string, opacity: number) => ({
  shadowColor: color,
  shadowOffset: { width: 0, height },
  shadowOpacity: opacity,
  shadowRadius: 0,
  elevation: height,
});

const styles = StyleSheet.create({
  takeover: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 50,
    backgroundColor: '#fff',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 10,
  },
  title: { fontSize: 22, fontWeight: '800', color: '#171717' },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  coinPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#f5f5f5',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    ...hardShadow(2, '#000', 0.08),
  },
  coinPillText: { fontSize: 14, fontWeight: '800', color: '#262626' },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#f5f5f5',
    alignItems: 'center',
    justifyContent: 'center',
  },

  sectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 12,
  },
  sectionTitle: { fontSize: 16, fontWeight: '800', color: '#171717' },
  sectionSub: { marginTop: 2, fontSize: 12, fontWeight: '600', color: '#a3a3a3' },
  restockPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#fff1e6',
    paddingHorizontal: 11,
    paddingVertical: 6,
    borderRadius: 999,
  },
  restockPillUrgent: { backgroundColor: '#fee2e2' },
  restockText: { fontSize: 13, fontWeight: '800', color: '#ff7a3d', fontVariant: ['tabular-nums'] },
  restockTextUrgent: { color: '#ef4444' },

  grid: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 12, marginHorizontal: -7 },
  gridCell: { width: '50%', paddingHorizontal: 7, marginBottom: 14 },

  featuredCard: { borderRadius: 24, padding: 16, overflow: 'hidden', ...hardShadow(4, '#000', 0.1) },
  featuredName: { marginTop: 8, fontSize: 14, fontWeight: '700', color: '#171717' },
  dailyCard: { borderRadius: 20, padding: 12, overflow: 'hidden', ...hardShadow(3, '#000', 0.08) },
  dailyName: { marginTop: 6, fontSize: 12, fontWeight: '700', color: '#262626' },

  pressed2: { transform: [{ translateY: 2 }] },
  pressed3: { transform: [{ translateY: 3 }] },

  rarityChip: { alignSelf: 'flex-start', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
  rarityChipText: { fontSize: 10, fontWeight: '800', color: '#fff', letterSpacing: 0.6 },

  priceRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  priceText: { fontSize: 12, fontWeight: '700', color: '#525252' },
  ownedText: { fontSize: 12, fontWeight: '700', color: '#059669', marginTop: 2 },

  wornBadge: {
    position: 'absolute',
    right: 8,
    top: 8,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#171717',
    alignItems: 'center',
    justifyContent: 'center',
  },
  wornBadgeSmall: { right: 4, top: 4, width: 20, height: 20, borderRadius: 10 },

  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  modalCard: {
    width: '100%',
    maxWidth: 384,
    borderRadius: 28,
    backgroundColor: '#fff',
    padding: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 20 },
    shadowOpacity: 0.35,
    shadowRadius: 60,
    elevation: 24,
  },
  modalArt: { borderRadius: 22, padding: 12, overflow: 'hidden' },
  modalName: { marginTop: 16, textAlign: 'center', fontSize: 20, fontWeight: '800', color: '#171717' },

  btnBuy: {
    marginTop: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 999,
    paddingVertical: 14,
    backgroundColor: '#7A5AF8',
    ...hardShadow(4, '#5638c6', 1),
  },
  btnBuyText: { fontSize: 15, fontWeight: '700', color: '#fff' },
  btnDisabled: { backgroundColor: '#f5f5f5', shadowOpacity: 0, elevation: 0 },
  btnDisabledText: { color: '#a3a3a3' },
  btnEquip: {
    marginTop: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 999,
    paddingVertical: 14,
    backgroundColor: '#0a84ff',
    ...hardShadow(4, '#0868c8', 1),
  },
  btnEquipText: { fontSize: 15, fontWeight: '700', color: '#fff' },
  btnNeutral: {
    marginTop: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 999,
    paddingVertical: 14,
    backgroundColor: '#f5f5f5',
    ...hardShadow(4, '#000', 0.1),
  },
  btnNeutralText: { fontSize: 15, fontWeight: '700', color: '#525252' },
});
