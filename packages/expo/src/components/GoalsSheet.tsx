import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Alert, Dimensions, Pressable, ScrollView, Text, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { fetchGoals, type GoalsList, logGoalCheckIn, startHabitChat } from '../lib/api';
import { GuidedHabitChat } from './GuidedHabitChat';

// Bottom-sheet "Goals": the user's adopted goals (goals.list), each simply done
// or not done today. Tapping a card expands an action row — mark it done/undo
// (an optimistic goals.logCheckIn round-trip, plan 20 decision 8), or "Talk
// about it", which the host turns into a chat prompt. Mirrors the web reference
// (packages/web/src/components/goals-sheet.tsx); the reanimated slide-up +
// grabber/header shell matches SettingsSheet.
//
// NOTE: the goal slug (e.g. 'get-fit') keys the icon, and the webp goal icons
// from web aren't bundled into the Expo app. So instead of an <Image>, we
// render an Ionicon placeholder (mapped per slug) inside a per-goal colored dot.

const GOALS_QUERY_KEY = ['goals', 'list'] as const;

const SHEET_H = Math.round(Dimensions.get('window').height * 0.55);

const DONE = '#12C93E';
const TALK = '#0a84ff';

// slug → (Ionicon, accent color) placeholder, since the web webp icons aren't bundled
const ICONS: Record<string, { icon: keyof typeof Ionicons.glyphMap; color: string }> = {
  'get-fit': { icon: 'barbell', color: '#ff6b6b' },
  'sleep-better': { icon: 'moon', color: '#6c8cff' },
  'stop-procrastinating': { icon: 'timer', color: '#ffa53d' },
  'stop-doomscrolling': { icon: 'phone-portrait', color: '#a06bff' },
  'social-skills': { icon: 'people', color: '#12c9a0' },
  'manage-stress': { icon: 'leaf', color: '#3dbd6a' },
  'read-more': { icon: 'book', color: '#ff9f43' },
  'be-productive': { icon: 'checkmark-done', color: '#0a84ff' },
  // streamlined onboarding "one thing to improve" slugs
  'eat-healthier': { icon: 'restaurant', color: '#ff6b6b' },
  'exercise-more': { icon: 'barbell', color: '#ff6b6b' },
  'wake-earlier': { icon: 'sunny', color: '#ffa53d' },
  'be-organized': { icon: 'checkmark-done', color: '#0a84ff' },
  'mental-health': { icon: 'leaf', color: '#3dbd6a' },
};
const FALLBACK = { icon: 'flag' as const, color: '#8a8a8a' };

export function GoalsSheet({
  open,
  onClose,
  onTalk,
}: {
  open: boolean;
  onClose: () => void;
  // "Talk about it" — the host closes this sheet and opens the goal in chat
  onTalk: (goalValue: string) => void;
}) {
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const goalsQuery = useQuery({ queryKey: GOALS_QUERY_KEY, queryFn: fetchGoals });
  const list = goalsQuery.data;

  // one card expanded at a time; keyed by goal id. Collapse + refresh on reopen
  // (the list's "today" rolls over at the user's local midnight, server-decided).
  const [expanded, setExpanded] = useState<string | null>(null);
  // The guided habit-add chat ("+"): its conversation id when open, else null.
  const [habitConvId, setHabitConvId] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  useEffect(() => {
    if (open) {
      setExpanded(null);
      void queryClient.invalidateQueries({ queryKey: GOALS_QUERY_KEY });
    } else {
      setHabitConvId(null); // don't resume an add-habit chat when the sheet reopens
    }
  }, [open, queryClient]);

  const openAddHabit = () => {
    if (starting) return;
    setStarting(true);
    startHabitChat()
      .then(({ conversationId }) => setHabitConvId(conversationId))
      .catch(() => {})
      .finally(() => setStarting(false));
  };
  const closeAddHabit = () => {
    setHabitConvId(null);
    void queryClient.invalidateQueries({ queryKey: GOALS_QUERY_KEY }); // pick up the new goal
  };

  const progress = useSharedValue(0);
  progress.value = withTiming(open ? 1 : 0, { duration: 300 });
  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: (1 - progress.value) * SHEET_H }],
    // opacity-gate so a closed sheet never peeks above the screen edge
    opacity: progress.value === 0 ? 0 : 1,
  }));

  return (
    <Animated.View
      style={[
        sheetStyle,
        { position: 'absolute', left: 0, right: 0, bottom: 0, height: SHEET_H, zIndex: 40 },
      ]}
      pointerEvents={open ? 'auto' : 'none'}
    >
      <View
        className="flex-1 bg-white"
        style={{
          borderTopLeftRadius: 28,
          borderTopRightRadius: 28,
          shadowColor: '#000',
          shadowOffset: { width: 0, height: -8 },
          shadowOpacity: 0.22,
          shadowRadius: 20,
          elevation: 12,
        }}
      >
        {/* grabber + header */}
        <View className="px-5 pt-3">
          <View className="self-center h-1.5 w-10 rounded-full bg-neutral-200" />
          <View className="mt-1.5 flex-row items-center justify-between">
            <Text className="text-[22px] font-extrabold text-neutral-900">Goals</Text>
            <Pressable
              onPress={onClose}
              accessibilityLabel="Close goals"
              className="h-9 w-9 rounded-full bg-neutral-100 items-center justify-center"
            >
              <Ionicons name="close" size={20} color="#737373" />
            </Pressable>
          </View>
        </View>

        {/* one card per goal: icon, label, done-or-not; tap to expand actions */}
        <ScrollView
          className="flex-1 px-4 pt-3"
          contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 16), gap: 10 }}
          showsVerticalScrollIndicator={false}
        >
          {list
            ? list.goals.slice(0, 4).map((g) => (
                <GoalCard
                  key={g.goalId}
                  goal={g}
                  date={list.date}
                  expanded={expanded === g.goalId}
                  onToggleExpand={() => setExpanded(expanded === g.goalId ? null : g.goalId)}
                  onTalk={onTalk}
                />
              ))
            : null}

          {/* add a habit — opens the same guided-habit chat as onboarding */}
          {list ? (
            <Pressable
              onPress={openAddHabit}
              disabled={starting}
              className="flex-row items-center rounded-[18px] border-2 border-dashed border-neutral-200 px-3.5 py-3"
            >
              <View className="h-10 w-10 items-center justify-center rounded-xl bg-neutral-100">
                <Ionicons name="add" size={22} color="#737373" />
              </View>
              <Text className="ml-3 text-[15px] font-semibold text-neutral-500">
                {starting ? 'starting…' : 'add a habit'}
              </Text>
            </Pressable>
          ) : null}
        </ScrollView>

        {/* guided habit-add chat, over the goals list */}
        {habitConvId ? (
          <View
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              backgroundColor: '#fff',
              borderTopLeftRadius: 28,
              borderTopRightRadius: 28,
            }}
          >
            <View className="px-5 pt-3">
              <View className="self-center h-1.5 w-10 rounded-full bg-neutral-200" />
              <View className="mt-1.5 flex-row items-center justify-between">
                <Text className="text-[22px] font-extrabold text-neutral-900">Add a habit</Text>
                <Pressable
                  onPress={closeAddHabit}
                  accessibilityLabel="Close add habit"
                  className="h-9 w-9 items-center justify-center rounded-full bg-neutral-100"
                >
                  <Ionicons name="close" size={20} color="#737373" />
                </Pressable>
              </View>
            </View>
            <GuidedHabitChat conversationId={habitConvId} onComplete={closeAddHabit} />
          </View>
        ) : null}
      </View>
    </Animated.View>
  );
}

function GoalCard({
  goal,
  date,
  expanded,
  onToggleExpand,
  onTalk,
}: {
  goal: GoalsList['goals'][number];
  date: string;
  expanded: boolean;
  onToggleExpand: () => void;
  onTalk: (goalValue: string) => void;
}) {
  const queryClient = useQueryClient();
  const done = goal.today.outcome === 'hit' || goal.today.outcome === 'partial';
  const ico = ICONS[goal.slug] ?? FALLBACK;

  // optimistic toggle: flip today's outcome in the cached list at once, then
  // let the server settle it — a refetch on success (it owns the derived week
  // counts + streak), the pre-toggle list back + an alert on failure
  const logToday = (result: 'hit' | null) => {
    const previous = queryClient.getQueryData<GoalsList>(GOALS_QUERY_KEY);
    if (previous) {
      queryClient.setQueryData<GoalsList>(GOALS_QUERY_KEY, {
        ...previous,
        goals: previous.goals.map((g) =>
          g.goalId === goal.goalId ? { ...g, today: { outcome: result, note: null } } : g,
        ),
      });
    }
    logGoalCheckIn({ goalId: goal.goalId, date, result })
      .then(() => queryClient.invalidateQueries({ queryKey: GOALS_QUERY_KEY }))
      .catch((error: unknown) => {
        queryClient.setQueryData(GOALS_QUERY_KEY, previous);
        const message =
          error instanceof Error && error.message
            ? error.message
            : 'something went wrong — try again';
        Alert.alert("Couldn't update the goal", message);
      });
  };

  return (
    <View
      className="overflow-hidden rounded-[18px] bg-neutral-100"
      style={{ shadowColor: '#000', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.08, shadowRadius: 0 }}
    >
      <Pressable
        onPress={onToggleExpand}
        className="flex-row items-center px-3.5 py-2.5"
        style={{ gap: 12 }}
      >
        <View
          className="h-10 w-10 shrink-0 rounded-xl items-center justify-center"
          style={{ backgroundColor: ico.color + '22' }}
        >
          <Ionicons name={ico.icon} size={20} color={ico.color} />
        </View>
        <View className="min-w-0 flex-1">
          <Text numberOfLines={1} className="text-[15px] font-bold text-neutral-900">
            {goal.label}
          </Text>
          <Text
            numberOfLines={1}
            className={`text-[12px] ${done ? 'font-semibold' : 'text-neutral-400'}`}
            style={done ? { color: DONE } : undefined}
          >
            {done ? 'Completed today' : 'Not completed'}
          </Text>
        </View>
        <View
          className="h-7 w-7 shrink-0 rounded-full items-center justify-center"
          style={
            done
              ? { backgroundColor: DONE }
              : { backgroundColor: '#fff', borderWidth: 1, borderColor: '#e5e5e5' }
          }
        >
          <Ionicons name="checkmark" size={16} color={done ? '#fff' : 'transparent'} />
        </View>
      </Pressable>

      {expanded ? (
        <View className="flex-row px-4 pb-4" style={{ gap: 8 }}>
          <Pressable
            onPress={() => logToday(done ? null : 'hit')}
            className="flex-1 flex-row items-center justify-center rounded-2xl py-2.5"
            style={{ gap: 6, backgroundColor: done ? '#f5f5f5' : DONE }}
          >
            <Ionicons name={done ? 'arrow-undo' : 'checkmark'} size={16} color={done ? '#737373' : '#fff'} />
            <Text className="text-[14px] font-semibold" style={{ color: done ? '#737373' : '#fff' }}>
              {done ? 'Undo' : 'Mark done'}
            </Text>
          </Pressable>
          <Pressable
            onPress={() => onTalk(goal.slug)}
            className="flex-1 flex-row items-center justify-center rounded-2xl py-2.5"
            style={{ gap: 6, backgroundColor: TALK }}
          >
            <Ionicons name="chatbubble-ellipses" size={16} color="#fff" />
            <Text className="text-[14px] font-semibold text-white">Talk about it</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}
