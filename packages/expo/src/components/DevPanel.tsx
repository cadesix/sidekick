import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BOND_MIN, START_COINS, START_INVENTORY, buildProducts } from '@sidekick/core';

import { MANIFEST } from '../three/cosmetics-manifest';
import { SHOP_COLORS, SLOT_LABEL, WARDROBE_SLOTS } from '../three/wardrobe';
import { useBond } from '../store/bond';
import { useSidekickContext } from '../store/context';
import { useDailyBox } from '../store/dailyBox';
import { useEconomy } from '../store/economy';
import { useStarChat } from '../store/star-chat';
import { useStreak } from '../store/streak';

// DEV-only user-state panel — the RN counterpart of the web app's dev chip
// (packages/web/src/components/dev-panel.tsx). A tiny "DEV" chip pinned top-LEFT
// toggles a compact panel that nudges the dev dials: Bond, Streak, Coins,
// Inventory (own all / own none), the daily box ("replay first session"), map
// sessions, and a full profile reset.
//
// The web version writes localStorage keys then reloads (every store re-reads at
// mount). Expo can't reload the same way, and __DEV__ is FALSE on the Expo Web
// dev build — so we gate on SHOW_DEV below and mutate the zustand stores
// DIRECTLY (their updates propagate live, no reload needed).
//
// Not ported from web: the Personas presets and the Onboarding-phase row — no
// persona/onboarding stores exist in the Expo app yet.

const SHOW_DEV = true;

export function DevPanel({ onJumpToReveal }: { onJumpToReveal?: () => void }) {
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);

  // live dial values (re-render on change)
  const bond = useBond((s) => s.bond);
  const streak = useStreak((s) => s.count);
  const coins = useEconomy((s) => s.coins);
  const owned = useEconomy((s) => s.inventory.length);
  const boxArmed = useDailyBox((s) => s.hasBox());

  // every purchasable renderKey in the catalog (variants + solid colors)
  const allKeys = useMemo(
    () =>
      buildProducts({
        slots: WARDROBE_SLOTS,
        slotLabel: SLOT_LABEL,
        colors: SHOP_COLORS,
        manifest: MANIFEST,
      }).map((p) => p.renderKey),
    [],
  );

  if (!SHOW_DEV) return null;

  const setBond = useBond.getState().setBond;
  const addBond = useBond.getState().addBond;
  const setCount = useStreak.getState().setCount;
  const setCoins = useEconomy.getState().setCoins;
  const setInventory = useEconomy.getState().setInventory;
  const resetBox = useDailyBox.getState().reset;
  const resetSessions = useSidekickContext.getState().resetSessions;
  // Wipe both stores the guided/star chat spans: the context profile (fields,
  // notes, sessions, astral card) AND the Star Chat conversation itself (its
  // phase, message log, artifact) — else the continuous conversation resumes
  // from AsyncStorage and looks un-wiped.
  const wipeGuidedChats = () => {
    useSidekickContext.getState().resetGuidedChats();
    useStarChat.getState().reset();
  };

  // Full wipe: put every dial back to its starting value (the web's
  // "Reset profile (wipe all keys)").
  const resetProfile = () => {
    setBond(BOND_MIN);
    setCount(0);
    setCoins(START_COINS);
    setInventory([...START_INVENTORY]);
    resetBox();
    wipeGuidedChats();
  };

  return (
    <>
      <Pressable
        onPress={() => setOpen((o) => !o)}
        style={[styles.chip, { top: Math.max(insets.top, 16) }]}
        accessibilityLabel="Toggle dev panel"
      >
        <Text style={styles.chipText}>DEV</Text>
      </Pressable>

      {open ? (
        <ScrollView
          style={[styles.panel, { top: Math.max(insets.top, 16) + 34 }]}
          contentContainerStyle={styles.panelContent}
        >
          <Row label="Bond" value={`${bond}%`}>
            {[10, 25, 40, 55, 70, 85, 100].map((v) => (
              <Btn key={v} label={String(v)} onPress={() => setBond(v)} />
            ))}
            <Btn label="-10" onPress={() => addBond(-10)} />
            <Btn label="+10" onPress={() => addBond(10)} />
          </Row>

          <Row label="Streak" value={`${streak}d`}>
            {[1, 3, 6, 9, 13, 29, 89, 364].map((v) => (
              <Btn key={v} label={String(v)} onPress={() => setCount(v)} />
            ))}
            <Btn label="+1" onPress={() => setCount(streak + 1)} />
            <Btn label="reset" onPress={() => setCount(1)} />
          </Row>

          <Row label="Daily box" value={boxArmed ? 'unclaimed' : 'claimed'}>
            <Btn label="Replay first session of day" onPress={resetBox} wide />
          </Row>

          <Row label="Coins" value={String(coins)}>
            {[0, 50, 250, 1000, 5000].map((v) => (
              <Btn key={v} label={String(v)} onPress={() => setCoins(v)} />
            ))}
            <Btn label="+50" onPress={() => setCoins(coins + 50)} />
          </Row>

          <Row label="Inventory" value={`${owned} items`}>
            <Btn label="Own all" onPress={() => setInventory(allKeys)} />
            <Btn label="Own none" onPress={() => setInventory([...START_INVENTORY])} />
          </Row>

          <Row label="Guided chats">
            <Btn label="Re-lock map (progress only)" onPress={resetSessions} wide />
            <Btn label="Wipe guided chats (+ profile)" onPress={wipeGuidedChats} wide />
            {onJumpToReveal ? <Btn label="Jump to astral reveal" onPress={onJumpToReveal} wide /> : null}
          </Row>

          <Pressable onPress={resetProfile} style={styles.resetBtn}>
            <Text style={styles.resetText}>Reset profile (wipe all dials)</Text>
          </Pressable>
        </ScrollView>
      ) : null}
    </>
  );
}

function Row({
  label,
  value,
  children,
}: {
  label: string;
  value?: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>
        {label.toUpperCase()}
        {value != null ? <Text style={styles.rowValue}> {value}</Text> : null}
      </Text>
      <View style={styles.btnWrap}>{children}</View>
    </View>
  );
}

function Btn({ label, onPress, wide }: { label: string; onPress: () => void; wide?: boolean }) {
  return (
    <Pressable onPress={onPress} style={[styles.btn, wide && styles.btnWide]}>
      <Text style={styles.btnText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    position: 'absolute',
    left: 12,
    zIndex: 50,
    borderRadius: 6,
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  chipText: {
    fontFamily: 'monospace',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.5,
    color: '#bef264', // lime-300
  },
  panel: {
    position: 'absolute',
    left: 12,
    zIndex: 50,
    maxHeight: 480,
    width: 288,
    borderRadius: 12,
    backgroundColor: 'rgba(23,23,23,0.96)', // neutral-900
  },
  panelContent: {
    padding: 12,
    gap: 10,
  },
  row: {
    gap: 6,
  },
  rowLabel: {
    fontFamily: 'monospace',
    fontSize: 10,
    letterSpacing: 1.5,
    color: '#737373', // neutral-500
  },
  rowValue: {
    color: '#bef264', // lime-300
  },
  btnWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  btn: {
    borderRadius: 6,
    backgroundColor: '#404040', // neutral-700
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  btnWide: {
    flexGrow: 1,
  },
  btnText: {
    fontFamily: 'monospace',
    fontSize: 11,
    fontWeight: '700',
    color: '#fff',
  },
  resetBtn: {
    borderRadius: 6,
    backgroundColor: 'rgba(127,29,29,0.7)', // red-900/70
    paddingVertical: 8,
    alignItems: 'center',
  },
  resetText: {
    fontFamily: 'monospace',
    fontSize: 11,
    fontWeight: '700',
    color: '#fecaca', // red-200
  },
});
