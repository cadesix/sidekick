import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BOND_MAX, BOND_MIN } from '@sidekick/core';

import {
  devAdjustCoins,
  devResetDailyBox,
  devResetOnboarding,
  devResetProfile,
  devResetSessions,
  devSetBond,
  devSetStreak,
  type Snapshot,
} from '../lib/api';
import { patchSnapshot, SNAPSHOT_QUERY_KEY, type SnapshotPatch, useSnapshot } from '../lib/state';
import { refreshOnboarding, resetOnboarding } from '../lib/onboarding';
import { useStarChat } from '../store/star-chat';
import { CHAT_UI_MODES, useDevPrefs } from '../store/devPrefs';
import { TIMES, type TimeOfDay } from '../three/settings';

// DEV-only user-state panel — the RN counterpart of the web app's dev chip
// (packages/web/src/components/dev-panel.tsx). A tiny "DEV" chip pinned top-LEFT
// toggles a compact panel that nudges the dev dials: Bond, Streak, Coins, the
// daily box, guided-session progress, and the extracted profile.
//
// Progression is server state now (plan 20), so every dial routes through the
// `dev` router (double-gated to NODE_ENV=development server-side). Each response
// carries the bumped stateVersion; we patch the snapshot cache for instant
// feedback and then refetch it so the slices the response doesn't carry —
// dailyBox.claimable after a box reset, the sessions list after a wipe —
// reconcile too.
//
// __DEV__ is FALSE on the Expo Web dev build, so we gate on SHOW_DEV below.

const SHOW_DEV = true;

const COIN_STEPS = [-1000, -100, 100, 1000, 5000];
const BOND_PRESETS = [10, 25, 40, 55, 70, 85, 100];
const STREAK_PRESETS = [1, 3, 6, 9, 13, 29, 89, 364];

export function DevPanel({
  onJumpToReveal,
  timeOfDay,
  onSetTimeOfDay,
}: {
  onJumpToReveal?: () => void;
  // live time-of-day override (day/evening/night) for scene look-dev
  timeOfDay?: TimeOfDay;
  onSetTimeOfDay?: (t: TimeOfDay) => void;
}) {
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const snapshot = useSnapshot().data;
  const chatUi = useDevPrefs((s) => s.chatUiMode);

  if (!SHOW_DEV) return null;

  const bond = snapshot?.bond ?? BOND_MIN;
  const streak = snapshot?.streak.count ?? 0;
  const coins = snapshot?.coins ?? 0;

  const settle = (patch: SnapshotPatch) => {
    patchSnapshot(queryClient, patch);
    void queryClient.invalidateQueries({ queryKey: SNAPSHOT_QUERY_KEY });
  };
  const onError = (error: unknown) => {
    Alert.alert('Dev lever failed', error instanceof Error && error.message ? error.message : 'try again');
  };

  const setBondTo = (v: number) =>
    devSetBond(Math.min(BOND_MAX, Math.max(BOND_MIN, v)))
      .then((r) => settle({ stateVersion: r.stateVersion, bond: r.bond }))
      .catch(onError);
  const setStreakTo = (v: number) =>
    devSetStreak(Math.max(0, v))
      .then((r) => {
        const current = queryClient.getQueryData<Snapshot>(SNAPSHOT_QUERY_KEY);
        settle({
          stateVersion: r.stateVersion,
          streak: { milestoneLadder: current?.streak.milestoneLadder ?? [], count: r.count },
        });
      })
      .catch(onError);
  const adjustCoins = (amount: number) =>
    devAdjustCoins(amount)
      .then((r) => settle({ stateVersion: r.stateVersion, coins: r.coins }))
      .catch(onError);
  const replayDailyBox = () =>
    devResetDailyBox()
      .then((r) => settle({ stateVersion: r.stateVersion, coins: r.coins }))
      .catch(onError);
  // reset the CLIENT-side Star Chat conversation too (its phase/messages/artifact
  // live in the local star-chat store, not the server snapshot) — else the
  // continuous conversation resumes from AsyncStorage and looks un-wiped.
  const relockMap = () => {
    useStarChat.getState().reset();
    devResetSessions()
      .then((r) => settle({ stateVersion: r.stateVersion, coins: r.coins, bond: r.bond }))
      .catch(onError);
  };
  const wipeProfile = () => {
    useStarChat.getState().reset();
    devResetProfile()
      .then((r) => settle({ stateVersion: r.stateVersion, coins: r.coins, bond: r.bond }))
      .catch(onError);
  };
  // wipe the onboarding gate so the 3D flow runs again from welcome
  const replayOnboarding = () => {
    // Wipe BOTH the local gate and the server onboarding chat + goals, so the
    // funnel truly re-runs the guided-habit flow instead of resuming a finished one.
    Promise.all([resetOnboarding(), devResetOnboarding().catch(() => {})])
      .then(() => refreshOnboarding(queryClient))
      .finally(() => router.replace('/onboarding'));
  };

  return (
    <>
      <Pressable
        onPress={() => setOpen((o) => !o)}
        hitSlop={10}
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
          <Row label="Labs">
            <Btn label="Open dev tools →" onPress={() => router.push('/dev')} wide />
          </Row>

          <Row label="Onboarding">
            <Btn label="Replay onboarding" onPress={replayOnboarding} wide />
          </Row>

          {/* which Messages presentation is live (store/devPrefs) */}
          <Row label="Chat UI" value={chatUi}>
            {CHAT_UI_MODES.map((m) => (
              <Btn
                key={m}
                label={m}
                active={m === chatUi}
                onPress={() => useDevPrefs.getState().setChatUiMode(m)}
                wide
              />
            ))}
          </Row>

          {onSetTimeOfDay ? (
            <Row label="Time of day" value={timeOfDay}>
              {TIMES.map((t) => (
                <Btn
                  key={t}
                  label={t}
                  active={t === timeOfDay}
                  onPress={() => onSetTimeOfDay(t)}
                  wide
                />
              ))}
            </Row>
          ) : null}

          <Row label="Bond" value={`${bond}%`}>
            {BOND_PRESETS.map((v) => (
              <Btn key={v} label={String(v)} onPress={() => setBondTo(v)} />
            ))}
            <Btn label="-10" onPress={() => setBondTo(bond - 10)} />
            <Btn label="+10" onPress={() => setBondTo(bond + 10)} />
          </Row>

          <Row label="Streak" value={`${streak}d`}>
            {STREAK_PRESETS.map((v) => (
              <Btn key={v} label={String(v)} onPress={() => setStreakTo(v)} />
            ))}
            <Btn label="+1" onPress={() => setStreakTo(streak + 1)} />
            <Btn label="reset" onPress={() => setStreakTo(1)} />
          </Row>

          <Row label="Daily box">
            <Btn label="Replay daily box" onPress={replayDailyBox} wide />
          </Row>

          <Row label="Coins" value={String(coins)}>
            {COIN_STEPS.map((v) => (
              <Btn key={v} label={v > 0 ? `+${v}` : String(v)} onPress={() => adjustCoins(v)} />
            ))}
          </Row>

          <Row label="Guided chats">
            <Btn label="Re-lock map (progress only)" onPress={relockMap} wide />
            <Btn label="Wipe guided chats (+ profile)" onPress={wipeProfile} wide />
            {onJumpToReveal ? <Btn label="Jump to astral reveal" onPress={onJumpToReveal} wide /> : null}
          </Row>
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

function Btn({
  label,
  onPress,
  wide,
  active,
}: {
  label: string;
  onPress: () => void;
  wide?: boolean;
  active?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={6}
      style={[styles.btn, wide && styles.btnWide, active && styles.btnActive]}
    >
      <Text style={[styles.btnText, active && styles.btnTextActive]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    position: 'absolute',
    left: 12,
    zIndex: 50,
    borderRadius: 8,
    backgroundColor: 'rgba(0,0,0,0.6)',
    minHeight: 44,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipText: {
    fontFamily: 'monospace',
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 1.5,
    color: '#bef264', // lime-300
  },
  panel: {
    position: 'absolute',
    left: 12,
    zIndex: 50,
    maxHeight: 560,
    width: 328,
    borderRadius: 14,
    backgroundColor: 'rgba(23,23,23,0.96)', // neutral-900
  },
  panelContent: {
    padding: 14,
    gap: 14,
  },
  row: {
    gap: 8,
  },
  rowLabel: {
    fontFamily: 'monospace',
    fontSize: 11,
    letterSpacing: 1.5,
    color: '#737373', // neutral-500
  },
  rowValue: {
    color: '#bef264', // lime-300
  },
  btnWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  btn: {
    minHeight: 44,
    minWidth: 44,
    borderRadius: 8,
    backgroundColor: '#404040', // neutral-700
    paddingHorizontal: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnWide: {
    flexGrow: 1,
  },
  btnActive: {
    backgroundColor: '#bef264', // lime-300
  },
  btnText: {
    fontFamily: 'monospace',
    fontSize: 14,
    fontWeight: '700',
    color: '#fff',
  },
  btnTextActive: {
    color: '#171717', // neutral-900
  },
});
