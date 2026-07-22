import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as Device from 'expo-device';
import { GLView, type ExpoWebGLRenderingContext } from 'expo-gl';
import * as Haptics from 'expo-haptics';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View, type GestureResponderEvent } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  cupPong,
  eightBall,
  type CupPongFlick,
  type CupPongState,
  type EightBallShot,
  type EightBallState,
} from '@sidekick/core';

import type { fetchTranscript } from '../imessage/server';
import { trpc } from '../lib/api';
import { useSidekickDisplayName } from '../lib/sidekick-name';
import { patchSnapshot } from '../lib/state';
import { holdGameReveal } from '../store/game-reveal';
import { NO_BROWSER_PAN } from '../lib/web-style';
import { SCENE_3D_ENABLED } from '../three/enabled';
import {
  CUP_PONG_BACKGROUND,
  CUP_PONG_FRAMING,
  createCupPongScene,
  type CupPongSceneController,
} from '../three/games/cup-pong-scene';
import { createGameScene, type GameSceneHost } from '../three/games/game-scene';
import {
  POOL_BACKGROUND,
  POOL_BALL_COLORS,
  POOL_FRAMING,
  createPoolScene,
  type PoolSceneController,
} from '../three/games/pool-scene';

// The game turn player (plan 21 §The game overlay): a full-screen surface over
// the chat hosting its own GLView (SidekickCanvas recipe — imperative scene
// controller, wrapper owns touches, GLView is pointerEvents:none). Opening a
// card replays the sidekick's stored turn through the real engine from its
// `lastTurn.pre` snapshot (tap to skip), then hands over the user's turn —
// cup pong flicks, or 8-ball aim/power/spin shots chained while pots keep the
// turn. The completed turn submits as ONE `games.turn` mutation and the overlay
// dismisses back to chat, where the sidekick's reply card lands on refetch.

type MatchView = Awaited<ReturnType<typeof trpc.games.get.query>>;
type TurnResult = Awaited<ReturnType<typeof trpc.games.turn.mutate>>;

type Phase =
  | 'loading'
  | 'replay'
  | 'aim'
  | 'anim'
  | 'submitting'
  | 'retry'
  | 'ended'
  | 'unsupported';

type Drag = { x0: number; y0: number; x: number; y: number; t0: number; t: number };

const MIN_FLICK = 0.06;

function flickFromDrag(drag: Drag, size: { w: number; h: number }): CupPongFlick | null {
  const up = (drag.y0 - drag.y) / size.h;
  if (up < MIN_FLICK) {
    return null;
  }
  const dt = Math.max(drag.t - drag.t0, 40);
  const speed = ((drag.y0 - drag.y) / dt) * (1000 / size.h);
  const power = Math.min(Math.max(up * 1.05 + speed * 0.14, 0), 1);
  const x = Math.min(Math.max((drag.x - drag.x0) / (size.w * 0.45), -1), 1);
  return { x, power };
}

const MIN_PULL = 0.12;
const POWER_TRACK_LEN = 240;

type PoolDrag =
  | { mode: 'aim'; x0: number; y0: number; lastX: number }
  | { mode: 'place' };

type PoolTurn = {
  state: EightBallState;
  angle: number;
  cuePlace: { x: number; y: number } | null;
};

type PoolHud = {
  userGroup: 'solids' | 'stripes' | null;
  solids: number[];
  stripes: number[];
};

function dirOf(angle: number): { x: number; y: number } {
  return { x: Math.sin(angle), y: Math.cos(angle) };
}

function withCueAt(state: EightBallState, p: { x: number; y: number }): EightBallState {
  const balls = state.balls.map((b, id) => {
    if (id === 0) return { x: p.x, y: p.y, pocketed: false };
    return b;
  });
  return { ...state, balls };
}

function clampToTable(p: { x: number; y: number }): { x: number; y: number } {
  return {
    x: Math.min(Math.max(p.x, eightBall.BALL_R), eightBall.TABLE_W - eightBall.BALL_R),
    y: Math.min(Math.max(p.y, eightBall.BALL_R), eightBall.TABLE_L - eightBall.BALL_R),
  };
}

/** Aim at the nearest legal target so the guide starts somewhere sensible. */
function initialAngle(state: EightBallState, cue: { x: number; y: number }): number {
  let best: { d: number; a: number } | null = null;
  for (const id of eightBall.legalTargets(state)) {
    const b = state.balls[id]!;
    const dx = b.x - cue.x;
    const dy = b.y - cue.y;
    const d = Math.hypot(dx, dy);
    if (d === 0) continue;
    if (best === null || d < best.d) best = { d, a: Math.atan2(dx, dy) };
  }
  return best === null ? 0 : best.a;
}

function poolHudOf(state: EightBallState): PoolHud {
  const solids: number[] = [];
  const stripes: number[] = [];
  for (let id = 1; id < 16; id++) {
    if (id === 8 || state.balls[id]!.pocketed) continue;
    if (id < 8) solids.push(id);
    else stripes.push(id);
  }
  return { userGroup: state.userGroup, solids, stripes };
}

const POOL_FOULS = new Set(['scratch', 'cue_off_table', 'foul_wrong_group']);

/** Client-detectable highlight tags for the server allowlist (plan 21). */
function poolHighlights(events: string[], final: EightBallState): string[] {
  const out: string[] = [];
  if (events.includes('scratch_on_8')) out.push('scratched_on_8');
  if (final.userGroup !== null) {
    let pots = 0;
    for (const event of events) {
      const m = /^pot:(\d+)$/.exec(event);
      if (m && eightBall.groupOf(Number(m[1])) === final.userGroup) pots++;
    }
    if (pots >= 3) out.push('ran_3_plus');
  }
  return out;
}

function GroupDots({ hud, group }: { hud: PoolHud; group: 'solids' | 'stripes' | null }) {
  if (group === null) {
    return <Text style={styles.scoreText}>—</Text>;
  }
  const ids = group === 'solids' ? hud.solids : hud.stripes;
  if (ids.length === 0) {
    return <Text style={styles.scoreText}>🎱</Text>;
  }
  return (
    <View style={styles.groupDots}>
      {ids.map((id) => {
        const color = POOL_BALL_COLORS[id < 8 ? id : id - 8]!;
        return (
          <View
            key={id}
            style={[
              styles.groupDot,
              id < 8 ? { backgroundColor: color } : { backgroundColor: '#ffffff', borderWidth: 2, borderColor: color },
            ]}
          />
        );
      })}
    </View>
  );
}

export function GameOverlay({ matchId, onClose }: { matchId: string; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const sidekickName = useSidekickDisplayName();
  const queryClient = useQueryClient();

  const [phase, setPhaseState] = useState<Phase>('loading');
  const [cups, setCups] = useState<{ user: number; sidekick: number } | null>(null);
  const [poolHud, setPoolHud] = useState<PoolHud | null>(null);
  const [ballInHand, setBallInHand] = useState(false);
  const [pullUi, setPullUi] = useState(0);
  const [spinOpen, setSpinOpen] = useState(false);
  const [spin, setSpin] = useState({ x: 0, y: 0 });
  const [winner, setWinner] = useState<'user' | 'sidekick' | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmingResign, setConfirmingResign] = useState(false);

  const match = useQuery({
    queryKey: ['games', 'match', matchId],
    queryFn: () => trpc.games.get.query({ matchId }),
    staleTime: Number.POSITIVE_INFINITY,
  });

  const phaseRef = useRef<Phase>('loading');
  const disposedRef = useRef(false);
  const startedRef = useRef(false);
  const hostRef = useRef<GameSceneHost | null>(null);
  const cupCtlRef = useRef<CupPongSceneController | null>(null);
  const poolCtlRef = useRef<PoolSceneController | null>(null);
  const matchRef = useRef<MatchView | null>(null);
  const sizeRef = useRef({ w: 1, h: 1 });
  const dragRef = useRef<Drag | null>(null);
  const poolDragRef = useRef<PoolDrag | null>(null);
  const poolTurnRef = useRef<PoolTurn | null>(null);
  const powerPullRef = useRef(0);
  const powerDragY0 = useRef(0);
  const spinRef = useRef({ x: 0, y: 0 });
  const flickResolverRef = useRef<((flick: CupPongFlick) => void) | null>(null);
  const shotResolverRef = useRef<((shot: EightBallShot) => void) | null>(null);
  const retryResolverRef = useRef<(() => void) | null>(null);
  const submittedRef = useRef(false);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const setPhase = (next: Phase): void => {
    phaseRef.current = next;
    setPhaseState(next);
  };

  // Any close invalidates the match query too — a reopened card must resume
  // from the server's settled state, never this session's cached snapshot.
  // After a submitted turn the refetch carries the sidekick's reply card, which
  // shouldn't materialize the instant the overlay dismisses — hold it behind
  // the chat's typing indicator for a beat (store/game-reveal.ts).
  const finishAndClose = (): void => {
    if (submittedRef.current) {
      const cached = queryClient.getQueriesData<Awaited<ReturnType<typeof fetchTranscript>>>({
        queryKey: ['chat', 'transcript'],
      });
      const knownIds = cached.flatMap(([, data]) => (data?.messages ?? []).map((m) => m.id));
      if (knownIds.length > 0) {
        holdGameReveal(knownIds);
      }
    }
    queryClient.invalidateQueries({ queryKey: ['chat', 'transcript'] });
    queryClient.invalidateQueries({ queryKey: ['games'] });
    onCloseRef.current();
  };

  const awaitFlick = (): Promise<CupPongFlick> =>
    new Promise((resolve) => {
      flickResolverRef.current = resolve;
    });

  const submitTurn = async (input: {
    turnNo: number;
    shots: CupPongFlick[] | EightBallShot[];
    state: CupPongState | EightBallState;
    events: string[];
  }): Promise<TurnResult> => {
    for (;;) {
      setPhase('submitting');
      try {
        const result = await trpc.games.turn.mutate({ matchId, ...input });
        submittedRef.current = true;
        return result;
      } catch {
        setPhase('retry');
        await new Promise<void>((resolve) => {
          retryResolverRef.current = resolve;
        });
      }
    }
  };

  const runCupPong = async (view: MatchView, ctl: CupPongSceneController): Promise<void> => {
    if (!('cups' in view.state)) {
      setPhase('unsupported');
      return;
    }
    const showCups = (state: CupPongState): void => {
      setCups({
        user: cupPong.cupCount(state.cups.user),
        sidekick: cupPong.cupCount(state.cups.sidekick),
      });
    };
    const state: CupPongState = view.state;
    showCups(state);

    // Replay the sidekick's stored turn from its `lastTurn.pre` snapshot: its
    // throws target the USER's cups, watched from the receiving end —
    // GamePigeon's incoming view, your own rack big at your end of the table.
    const last = state.lastTurn;
    if (last !== null && last.actor === 'sidekick' && last.shots.length > 0) {
      setPhase('replay');
      let replayed = cupPong.stateFromPre(last.pre, 'sidekick');
      ctl.stage('receive', replayed.cups.user);
      showCups(replayed);
      await ctl.wait(600);
      for (const shot of last.shots) {
        if (disposedRef.current) return;
        const res = cupPong.throwOutcome(replayed, shot);
        await ctl.animateThrow(shot, {
          cupSlot: res.cupSlot,
          rimNearMiss: res.rimNearMiss,
          targetMaskAfter: res.finalState.cups.user,
        });
        replayed = res.finalState;
        showCups(replayed);
        await ctl.wait(350);
      }
      ctl.clearSkip();
    }
    if (disposedRef.current) return;

    if (state.winner !== null || view.status !== 'active') {
      const winnerActor = state.winner ?? view.winner;
      if (winnerActor === 'sidekick') {
        ctl.stage('receive', state.cups.user);
      } else {
        ctl.stage('throw', state.cups.sidekick);
      }
      showCups(state);
      setWinner(winnerActor);
      setPhase('ended');
      return;
    }

    // The user's turn: the thrower's view of the sidekick's rack.
    ctl.stage('throw', state.cups.sidekick);
    showCups(state);
    let cur: CupPongState = state;
    const shots: CupPongFlick[] = [];
    const events: string[] = [];
    while (cur.toMove === 'user' && cur.winner === null) {
      ctl.setBallsLeft(cur.turnBalls);
      setPhase('aim');
      const flick = await awaitFlick();
      if (disposedRef.current) return;
      setPhase('anim');
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      const res = cupPong.throwOutcome(cur, flick);
      shots.push(flick);
      events.push(...res.events);
      await ctl.animateThrow(flick, {
        cupSlot: res.cupSlot,
        rimNearMiss: res.rimNearMiss,
        targetMaskAfter: res.finalState.cups.sidekick,
      });
      if (res.cupSlot !== null) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
      cur = res.finalState;
      showCups(cur);
    }
    if (disposedRef.current) return;
    if (cur.winner === null) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    } else {
      setWinner(cur.winner);
      setPhase('ended');
    }

    const result = await submitTurn({ turnNo: view.turnNo + 1, shots, state: cur, events });
    if (disposedRef.current) return;
    if (result.stateVersion !== undefined && result.coins !== undefined) {
      patchSnapshot(queryClient, { stateVersion: result.stateVersion, coins: result.coins });
    }
    if (cur.winner !== null) {
      setPhase('ended');
      await ctl.wait(1500);
    } else {
      // Turn passed — the sidekick's reply card is the next thing they'll see
      // in chat, and opening it plays the reply. Settle briefly, then dismiss.
      await ctl.wait(400);
    }
    if (disposedRef.current) return;
    finishAndClose();
  };

  const refreshPoolAim = (): void => {
    const turn = poolTurnRef.current;
    const ctl = poolCtlRef.current;
    if (!turn || !ctl) return;
    const state = turn.cuePlace === null ? turn.state : withCueAt(turn.state, turn.cuePlace);
    ctl.setAim({ state, dir: dirOf(turn.angle) });
    if (turn.cuePlace !== null) {
      ctl.setCueLift({ x: turn.cuePlace.x, y: turn.cuePlace.y, legal: true });
    }
  };

  const awaitPoolShot = (cur: EightBallState, ctl: PoolSceneController): Promise<EightBallShot> => {
    let cuePlace: { x: number; y: number } | null = null;
    if (cur.ballInHand) {
      const cue = cur.balls[0]!;
      const resting = { x: cue.x, y: cue.y };
      cuePlace =
        !cue.pocketed && eightBall.isLegalCuePlacement(cur, resting)
          ? resting
          : eightBall.findCueSpot(cur);
    }
    const from = cuePlace ?? { x: cur.balls[0]!.x, y: cur.balls[0]!.y };
    poolTurnRef.current = { state: cur, angle: initialAngle(cur, from), cuePlace };
    setBallInHand(cur.ballInHand);
    powerPullRef.current = 0;
    setPullUi(0);
    ctl.setPull(0);
    refreshPoolAim();
    return new Promise((resolve) => {
      shotResolverRef.current = resolve;
    });
  };

  const firePoolShot = (pull: number): void => {
    const turn = poolTurnRef.current;
    const resolve = shotResolverRef.current;
    if (!turn || !resolve) return;
    shotResolverRef.current = null;
    const dir = dirOf(turn.angle);
    resolve({
      dirX: dir.x,
      dirY: dir.y,
      power: Math.min(Math.max(pull, MIN_PULL), 1),
      spin: { ...spinRef.current },
      cuePlace: turn.state.ballInHand ? turn.cuePlace : null,
    });
  };

  const runEightBall = async (view: MatchView, ctl: PoolSceneController): Promise<void> => {
    if (!('balls' in view.state)) {
      setPhase('unsupported');
      return;
    }
    const showHud = (state: EightBallState): void => setPoolHud(poolHudOf(state));
    const state: EightBallState = view.state;
    ctl.setBalls(state.balls);
    showHud(state);

    const last = state.lastTurn;
    if (last !== null && last.actor === 'sidekick' && last.shots.length > 0) {
      setPhase('replay');
      let replayed = eightBall.stateFromPre(last.pre, 'sidekick');
      ctl.setBalls(replayed.balls);
      showHud(replayed);
      await ctl.wait(600);
      for (const shot of last.shots) {
        if (disposedRef.current) return;
        let aimState = replayed;
        if (replayed.ballInHand && shot.cuePlace !== null) {
          aimState = withCueAt(replayed, shot.cuePlace);
          ctl.setBalls(aimState.balls);
          await ctl.wait(300);
        }
        // "Watch it decide": the aim line sweeps onto the shot before firing.
        await ctl.sweepAim({ state: aimState, dir: { x: shot.dirX, y: shot.dirY } }, 0.8);
        await ctl.wait(220);
        const sim = eightBall.createShotSim(replayed, shot);
        await ctl.animateShot(sim);
        replayed = sim.result().finalState;
        ctl.setBalls(replayed.balls);
        showHud(replayed);
        await ctl.wait(350);
      }
      ctl.clearSkip();
    }
    if (disposedRef.current) return;

    if (state.winner !== null || view.status !== 'active') {
      ctl.setBalls(state.balls);
      showHud(state);
      setWinner(state.winner ?? view.winner);
      setPhase('ended');
      return;
    }

    ctl.setBalls(state.balls);
    showHud(state);
    let cur: EightBallState = state;
    const shots: EightBallShot[] = [];
    const events: string[] = [];
    // Pot your ball legally → shoot again, all within the same card (cap
    // matches the lastTurn schema's shot bound).
    while (cur.toMove === 'user' && cur.winner === null && shots.length < 24) {
      setPhase('aim');
      const shot = await awaitPoolShot(cur, ctl);
      if (disposedRef.current) return;
      setPhase('anim');
      setBallInHand(false);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      const sim = eightBall.createShotSim(cur, shot);
      await ctl.animateShot(sim);
      const res = sim.result();
      shots.push(shot);
      events.push(...res.events);
      if (res.events.some((e) => POOL_FOULS.has(e))) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      } else if (res.events.some((e) => e.startsWith('pot:'))) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
      cur = res.finalState;
      ctl.setBalls(cur.balls);
      showHud(cur);
      await ctl.wait(300);
    }
    if (disposedRef.current) return;
    events.push(...poolHighlights(events, cur));
    if (cur.winner === null) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    } else {
      setWinner(cur.winner);
      setPhase('ended');
    }

    const result = await submitTurn({ turnNo: view.turnNo + 1, shots, state: cur, events });
    if (disposedRef.current) return;
    if (result.stateVersion !== undefined && result.coins !== undefined) {
      patchSnapshot(queryClient, { stateVersion: result.stateVersion, coins: result.coins });
    }
    if (cur.winner !== null) {
      setPhase('ended');
      await ctl.wait(1500);
    } else {
      await ctl.wait(400);
    }
    if (disposedRef.current) return;
    finishAndClose();
  };

  const maybeStart = (): void => {
    const view = matchRef.current;
    if (!view || startedRef.current || disposedRef.current) {
      return;
    }
    if (view.gameType === 'eight_ball') {
      const ctl = poolCtlRef.current;
      if (!ctl) return;
      startedRef.current = true;
      void runEightBall(view, ctl);
      return;
    }
    const ctl = cupCtlRef.current;
    if (!ctl) return;
    startedRef.current = true;
    void runCupPong(view, ctl);
  };

  if (match.data && matchRef.current === null) {
    matchRef.current = match.data;
  }

  useEffect(() => {
    maybeStart();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [match.data]);

  const onContextCreate = (gl: ExpoWebGLRenderingContext): void => {
    const view = matchRef.current;
    if (!view) return;
    const isPool = view.gameType === 'eight_ball';
    const host = createGameScene(gl, {
      background: isPool ? POOL_BACKGROUND : CUP_PONG_BACKGROUND,
      framing: isPool ? POOL_FRAMING : CUP_PONG_FRAMING,
    });
    hostRef.current = host;
    if (isPool) {
      poolCtlRef.current = createPoolScene(host);
    } else {
      cupCtlRef.current = createCupPongScene(host);
    }
    maybeStart();
  };

  useEffect(() => {
    return () => {
      disposedRef.current = true;
      hostRef.current?.dispose();
    };
  }, []);

  const gameType = match.data?.gameType ?? null;

  const skipReplay = (): void => {
    cupCtlRef.current?.skip();
    poolCtlRef.current?.skip();
  };

  const onTouchStart = (e: GestureResponderEvent): void => {
    if (phaseRef.current === 'replay') {
      skipReplay();
      return;
    }
    if (phaseRef.current !== 'aim') {
      return;
    }
    const { locationX, locationY } = e.nativeEvent;
    if (gameType === 'eight_ball') {
      const turn = poolTurnRef.current;
      const ctl = poolCtlRef.current;
      if (!turn || !ctl) return;
      if (turn.cuePlace !== null) {
        const p = ctl.tableFromScreen(locationX / sizeRef.current.w, locationY / sizeRef.current.h);
        if (Math.hypot(p.x - turn.cuePlace.x, p.y - turn.cuePlace.y) < 0.14) {
          poolDragRef.current = { mode: 'place' };
          return;
        }
      }
      poolDragRef.current = { mode: 'aim', x0: locationX, y0: locationY, lastX: locationX };
      return;
    }
    const now = Date.now();
    dragRef.current = { x0: locationX, y0: locationY, x: locationX, y: locationY, t0: now, t: now };
  };

  const onTouchMove = (e: GestureResponderEvent): void => {
    if (phaseRef.current !== 'aim') {
      return;
    }
    const { locationX, locationY } = e.nativeEvent;
    if (gameType === 'eight_ball') {
      const drag = poolDragRef.current;
      const turn = poolTurnRef.current;
      const ctl = poolCtlRef.current;
      if (!drag || !turn || !ctl) return;
      if (drag.mode === 'place') {
        const p = clampToTable(
          ctl.tableFromScreen(locationX / sizeRef.current.w, locationY / sizeRef.current.h),
        );
        const legal = eightBall.isLegalCuePlacement(turn.state, p);
        ctl.setCueLift({ x: p.x, y: p.y, legal });
        if (legal) {
          turn.cuePlace = p;
          const state = withCueAt(turn.state, p);
          ctl.setAim({ state, dir: dirOf(turn.angle) });
          ctl.setCueLift({ x: p.x, y: p.y, legal: true });
        }
        return;
      }
      // Drag distance from the touch start scales angular sensitivity, so
      // short drags fine-tune and long sweeps swing the cue around.
      const dx = locationX - drag.lastX;
      drag.lastX = locationX;
      const dist = Math.hypot(locationX - drag.x0, locationY - drag.y0);
      const mult = 0.25 + Math.min(dist / 200, 1) * 1.15;
      turn.angle += (dx / sizeRef.current.w) * 2.6 * mult;
      refreshPoolAim();
      return;
    }
    const drag = dragRef.current;
    if (!drag) {
      return;
    }
    drag.x = locationX;
    drag.y = locationY;
    drag.t = Date.now();
    const flick = flickFromDrag(drag, sizeRef.current);
    cupCtlRef.current?.setAimCue(flick === null ? null : flick.x);
  };

  const onTouchEnd = (): void => {
    if (gameType === 'eight_ball') {
      const drag = poolDragRef.current;
      poolDragRef.current = null;
      if (drag?.mode === 'place') {
        // Snap the hover back onto the last legal spot.
        refreshPoolAim();
      }
      return;
    }
    const drag = dragRef.current;
    dragRef.current = null;
    const flick = drag && phaseRef.current === 'aim' ? flickFromDrag(drag, sizeRef.current) : null;
    if (flick) {
      // The throw animates from the nudged ball, so no reset — it stays smooth.
      const resolve = flickResolverRef.current;
      flickResolverRef.current = null;
      resolve?.(flick);
    } else {
      cupCtlRef.current?.setAimCue(null);
    }
  };

  const onPowerGrant = (e: GestureResponderEvent): void => {
    if (phaseRef.current !== 'aim') return;
    powerPullRef.current = 0;
    poolDragRef.current = null;
    powerDragY0.current = e.nativeEvent.locationY;
  };

  const onPowerMove = (e: GestureResponderEvent): void => {
    if (phaseRef.current !== 'aim') return;
    const pull = Math.min(
      Math.max((e.nativeEvent.locationY - powerDragY0.current) / POWER_TRACK_LEN, 0),
      1,
    );
    powerPullRef.current = pull;
    setPullUi(pull);
    poolCtlRef.current?.setPull(pull);
  };

  const onPowerRelease = (): void => {
    const pull = powerPullRef.current;
    powerPullRef.current = 0;
    setPullUi(0);
    poolCtlRef.current?.setPull(0);
    if (phaseRef.current !== 'aim') return;
    if (pull >= MIN_PULL) {
      firePoolShot(pull);
    }
  };

  const onSpinDrag = (e: GestureResponderEvent): void => {
    const r = SPIN_WHEEL / 2;
    let dx = e.nativeEvent.locationX - r;
    let dy = e.nativeEvent.locationY - r;
    const m = Math.hypot(dx, dy);
    const max = r - 24;
    if (m > max) {
      dx = (dx / m) * max;
      dy = (dy / m) * max;
    }
    const next = { x: dx / max, y: -dy / max };
    spinRef.current = next;
    setSpin(next);
  };

  const resign = async (): Promise<void> => {
    setMenuOpen(false);
    setConfirmingResign(false);
    try {
      await trpc.games.resign.mutate({ matchId });
    } catch {
      // The card stays on your move; nothing to clean up.
    }
    finishAndClose();
  };

  if (!SCENE_3D_ENABLED) {
    return (
      <View style={[styles.container, styles.fallback]}>
        <Text style={styles.fallbackTitle}>Games need a real device</Text>
        <Text style={styles.fallbackBody}>
          Games run on-device or on the web — the simulator can't render them.
        </Text>
        <Pressable onPress={onClose} style={styles.fallbackClose} accessibilityLabel="Close game">
          <Text style={styles.fallbackCloseText}>Close</Text>
        </Pressable>
      </View>
    );
  }

  const isPool = gameType === 'eight_ball';
  const background = isPool ? POOL_BACKGROUND : CUP_PONG_BACKGROUND;

  return (
    <View style={[styles.container, { backgroundColor: background }]}>
      <View
        style={[styles.canvasWrap, NO_BROWSER_PAN]}
        onLayout={(e) => {
          sizeRef.current = {
            w: e.nativeEvent.layout.width || 1,
            h: e.nativeEvent.layout.height || 1,
          };
        }}
        onStartShouldSetResponder={() => true}
        onResponderGrant={onTouchStart}
        onResponderMove={onTouchMove}
        onResponderRelease={onTouchEnd}
        onResponderTerminate={onTouchEnd}
      >
        {match.data ? (
          <GLView
            style={styles.canvas}
            pointerEvents="none"
            msaaSamples={Device.isDevice ? 4 : 0}
            onContextCreate={onContextCreate}
          />
        ) : null}
      </View>

      <View style={[styles.topBar, { top: insets.top + 8 }]} pointerEvents="box-none">
        {isPool ? (
          <>
            <View style={[styles.scorePill, styles.poolPill]}>
              <Text style={styles.scoreText}>You</Text>
              {poolHud ? <GroupDots hud={poolHud} group={poolHud.userGroup} /> : null}
            </View>
            <View style={[styles.scorePill, styles.poolPill]}>
              <Text style={styles.scoreText}>{sidekickName}</Text>
              {poolHud ? (
                <GroupDots
                  hud={poolHud}
                  group={
                    poolHud.userGroup === null
                      ? null
                      : poolHud.userGroup === 'solids'
                        ? 'stripes'
                        : 'solids'
                  }
                />
              ) : null}
            </View>
          </>
        ) : (
          <>
            <View style={styles.scorePill}>
              <Text style={styles.scoreText}>You · {cups ? cups.user : '–'}</Text>
            </View>
            <View style={styles.scorePill}>
              <Text style={styles.scoreText}>{sidekickName} · {cups ? cups.sidekick : '–'}</Text>
            </View>
          </>
        )}
        <View style={styles.topSpacer} />
        <Pressable
          onPress={() => {
            setMenuOpen((open) => !open);
            setConfirmingResign(false);
          }}
          accessibilityLabel="Game menu"
          style={styles.roundButton}
        >
          <Text style={styles.roundButtonText}>⋯</Text>
        </Pressable>
        <Pressable
          onPress={finishAndClose}
          accessibilityLabel="Close game"
          style={styles.roundButton}
        >
          <Text style={styles.roundButtonText}>✕</Text>
        </Pressable>
      </View>

      {menuOpen ? (
        <View style={[styles.menu, { top: insets.top + 56 }]}>
          <Pressable
            onPress={() => {
              if (confirmingResign) {
                void resign();
              } else {
                setConfirmingResign(true);
              }
            }}
            style={styles.menuItem}
          >
            <Text style={styles.menuItemText}>
              {confirmingResign ? 'Tap again to resign' : 'Resign'}
            </Text>
          </Pressable>
        </View>
      ) : null}

      {isPool && phase === 'aim' ? (
        <View
          style={[styles.powerTrack, NO_BROWSER_PAN]}
          onStartShouldSetResponder={() => true}
          onMoveShouldSetResponder={() => true}
          onResponderGrant={onPowerGrant}
          onResponderMove={onPowerMove}
          onResponderRelease={onPowerRelease}
          onResponderTerminate={onPowerRelease}
        >
          <View style={styles.powerRail} />
          <View style={[styles.powerGrip, { top: 8 + pullUi * (POWER_TRACK_LEN - 16) }]} />
        </View>
      ) : null}

      {isPool && phase === 'aim' ? (
        <Pressable
          onPress={() => setSpinOpen(true)}
          accessibilityLabel="Spin"
          style={styles.spinButton}
        >
          <View
            style={[
              styles.spinDot,
              { transform: [{ translateX: spin.x * 13 }, { translateY: -spin.y * 13 }] },
            ]}
          />
        </Pressable>
      ) : null}

      {spinOpen ? (
        <View style={styles.spinModalWrap}>
          <View
            style={[styles.spinWheel, NO_BROWSER_PAN]}
            onStartShouldSetResponder={() => true}
            onMoveShouldSetResponder={() => true}
            onResponderGrant={onSpinDrag}
            onResponderMove={onSpinDrag}
          >
            <View style={styles.spinCross} />
            <View style={[styles.spinCross, styles.spinCrossV]} />
            <View
              style={[
                styles.spinBigDot,
                {
                  transform: [
                    { translateX: spin.x * (SPIN_WHEEL / 2 - 24) },
                    { translateY: -spin.y * (SPIN_WHEEL / 2 - 24) },
                  ],
                },
              ]}
            />
          </View>
          <Pressable onPress={() => setSpinOpen(false)} style={styles.retryButton}>
            <Text style={styles.retryText}>Done</Text>
          </Pressable>
        </View>
      ) : null}

      {phase === 'replay' ? (
        <View style={styles.hintWrap} pointerEvents="none">
          <Text style={styles.hint}>{sidekickName}'s turn · tap to skip</Text>
        </View>
      ) : null}
      {phase === 'aim' && !isPool ? (
        <View style={styles.hintWrap} pointerEvents="none">
          <Text style={styles.hint}>Your move — flick up to throw</Text>
        </View>
      ) : null}
      {phase === 'aim' && isPool ? (
        <View style={styles.hintWrap} pointerEvents="none">
          <Text style={styles.hint}>
            {ballInHand
              ? 'Ball in hand — drag the cue ball'
              : 'Drag to aim · pull the left track to shoot'}
          </Text>
        </View>
      ) : null}
      {phase === 'submitting' ? (
        <View style={styles.hintWrap} pointerEvents="none">
          <Text style={styles.hint}>Sending…</Text>
        </View>
      ) : null}
      {phase === 'retry' ? (
        <View style={styles.hintWrap}>
          <Text style={styles.hint}>Couldn't send your turn</Text>
          <Pressable
            onPress={() => {
              const resolve = retryResolverRef.current;
              retryResolverRef.current = null;
              resolve?.();
            }}
            style={styles.retryButton}
          >
            <Text style={styles.retryText}>Retry</Text>
          </Pressable>
        </View>
      ) : null}
      {phase === 'unsupported' ? (
        <View style={styles.hintWrap} pointerEvents="none">
          <Text style={styles.hint}>This game isn't playable yet</Text>
        </View>
      ) : null}
      {phase === 'ended' && winner !== null ? (
        <View style={styles.bannerWrap} pointerEvents="none">
          <View style={styles.banner}>
            <Text style={styles.bannerText}>{winner === 'user' ? 'You won' : `${sidekickName} wins`}</Text>
          </View>
        </View>
      ) : null}
    </View>
  );
}

const SPIN_WHEEL = 220;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: CUP_PONG_BACKGROUND,
  },
  canvasWrap: {
    ...StyleSheet.absoluteFillObject,
  },
  canvas: {
    flex: 1,
  },
  topBar: {
    position: 'absolute',
    left: 12,
    right: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  topSpacer: {
    flex: 1,
  },
  scorePill: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.85)',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  // Pool pills stack label over ball dots — side by side the pair overflows a
  // 320pt screen and pushes the ⋯/✕ buttons off the right edge.
  poolPill: {
    flexDirection: 'column',
    paddingHorizontal: 10,
    paddingVertical: 6,
    gap: 3,
  },
  scoreText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#3a2c1c',
  },
  groupDots: {
    flexDirection: 'row',
    gap: 2,
  },
  groupDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  roundButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(255,255,255,0.85)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  roundButtonText: {
    fontSize: 17,
    fontWeight: '600',
    color: '#3a2c1c',
  },
  menu: {
    position: 'absolute',
    right: 12,
    backgroundColor: '#ffffff',
    borderRadius: 14,
    borderCurve: 'continuous',
    paddingVertical: 4,
    shadowColor: '#000',
    shadowOpacity: 0.16,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  menuItem: {
    paddingHorizontal: 18,
    paddingVertical: 12,
  },
  menuItemText: {
    fontSize: 16,
    fontWeight: '500',
    color: '#e0362b',
  },
  powerTrack: {
    position: 'absolute',
    left: 2,
    top: '26%',
    width: 44,
    height: POWER_TRACK_LEN + 24,
    alignItems: 'center',
    justifyContent: 'flex-start',
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.55)',
  },
  powerRail: {
    position: 'absolute',
    top: 14,
    bottom: 14,
    width: 5,
    borderRadius: 2.5,
    backgroundColor: 'rgba(58,44,28,0.28)',
  },
  powerGrip: {
    position: 'absolute',
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#caa05e',
    borderWidth: 2,
    borderColor: 'rgba(58,44,28,0.35)',
  },
  spinButton: {
    position: 'absolute',
    right: 14,
    bottom: 16,
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.14,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
  },
  spinDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#e0362b',
  },
  spinModalWrap: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 18,
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  spinWheel: {
    width: SPIN_WHEEL,
    height: SPIN_WHEEL,
    borderRadius: SPIN_WHEEL / 2,
    backgroundColor: '#f6f2e8',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 10 },
  },
  spinCross: {
    position: 'absolute',
    width: SPIN_WHEEL - 48,
    height: 1.5,
    backgroundColor: 'rgba(58,44,28,0.18)',
  },
  spinCrossV: {
    transform: [{ rotate: '90deg' }],
  },
  spinBigDot: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: '#e0362b',
  },
  hintWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 28,
    // Clears the 48pt spin button pinned bottom-right — on narrow screens a
    // long hint otherwise runs underneath it.
    paddingHorizontal: 66,
    alignItems: 'center',
    gap: 10,
  },
  hint: {
    fontSize: 15,
    fontWeight: '600',
    color: 'rgba(58,44,28,0.75)',
    textAlign: 'center',
  },
  retryButton: {
    paddingHorizontal: 22,
    paddingVertical: 10,
    borderRadius: 20,
    backgroundColor: '#3a2c1c',
  },
  retryText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#ffffff',
  },
  bannerWrap: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  banner: {
    paddingHorizontal: 30,
    paddingVertical: 16,
    borderRadius: 24,
    borderCurve: 'continuous',
    backgroundColor: 'rgba(255,255,255,0.94)',
    shadowColor: '#000',
    shadowOpacity: 0.14,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 8 },
  },
  bannerText: {
    fontSize: 28,
    fontWeight: '800',
    color: '#3a2c1c',
  },
  fallback: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 36,
    gap: 10,
  },
  fallbackTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#3a2c1c',
  },
  fallbackBody: {
    fontSize: 15,
    color: 'rgba(58,44,28,0.7)',
    textAlign: 'center',
  },
  fallbackClose: {
    marginTop: 10,
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 20,
    backgroundColor: '#3a2c1c',
  },
  fallbackCloseText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#ffffff',
  },
});
