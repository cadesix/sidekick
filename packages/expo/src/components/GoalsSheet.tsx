import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { memo, useEffect } from 'react';
import { Dimensions, Pressable, ScrollView, Text, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { fetchGoals, goalDoneToday, type GoalsList } from '../lib/api';

// Bottom-sheet "Goals": the user's adopted goals (goals.list), each simply done
// or not done today. Tapping a card opens the main chat, where the sidekick asks
// "did you [action] today?" and logs the answer (goals.askCheckin → the chat's
// always-on log_checkin tool). Mirrors the web reference; the reanimated
// slide-up + grabber/header shell matches the other bottom sheets.
//
// NOTE: the goal slug (e.g. 'get-fit') keys the icon, and the webp goal icons
// from web aren't bundled into the Expo app. So instead of an <Image>, we
// render an Ionicon placeholder (mapped per slug) inside a per-goal colored dot.

export const GOALS_QUERY_KEY = ['goals', 'list'] as const;

const SHEET_H = Math.round(Dimensions.get('window').height * 0.55);

const DONE = '#12C93E';

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

export const GoalsSheet = memo(GoalsSheetImpl);
function GoalsSheetImpl({
  open,
  onClose,
  onCheckin,
  onAddHabit,
}: {
  open: boolean;
  onClose: () => void;
  // tapping a goal opens the main chat, where the sidekick asks about it and
  // logs the answer (host closes this sheet + slides the chat open)
  onCheckin: (goalId: string) => void;
  // "Add a Habit or Goal" — the host closes this sheet and opens the guided
  // habit-add chat in the full Messages interface.
  onAddHabit: () => void;
}) {
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const goalsQuery = useQuery({ queryKey: GOALS_QUERY_KEY, queryFn: fetchGoals });
  const list = goalsQuery.data;

  useEffect(() => {
    if (open) {
      void queryClient.invalidateQueries({ queryKey: GOALS_QUERY_KEY });
    }
  }, [open, queryClient]);

  const progress = useSharedValue(0);
  // Drive the animation from an effect, NOT the render body: writing a shared
  // value during render triggers a synchronous re-render on the New Architecture
  // (Fabric) → an infinite render loop (which destabilized the whole app on device).
  useEffect(() => {
    progress.value = withTiming(open ? 1 : 0, { duration: 300 });
  }, [open, progress]);
  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: (1 - progress.value) * SHEET_H }],
    // opacity-gate so a closed sheet never peeks above the screen edge
    opacity: progress.value === 0 ? 0 : 1,
  }));

  return (
    <>
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
                <GoalCard key={g.goalId} goal={g} onTap={onCheckin} />
              ))
            : null}

          {/* add a habit — opens the same guided-habit chat as onboarding */}
          {list ? (
            <Pressable
              onPress={onAddHabit}
              className="flex-row items-center rounded-[18px] border-2 border-dashed border-neutral-200 px-3.5 py-3"
            >
              <View className="h-10 w-10 items-center justify-center rounded-xl bg-neutral-100">
                <Ionicons name="add" size={22} color="#737373" />
              </View>
              <Text className="ml-3 text-[15px] font-semibold text-neutral-500">
                Add a Habit or Goal
              </Text>
            </Pressable>
          ) : null}
        </ScrollView>
      </View>
      </Animated.View>
    </>
  );
}

function GoalCard({
  goal,
  onTap,
}: {
  goal: GoalsList['goals'][number];
  onTap: (goalId: string) => void;
}) {
  const done = goalDoneToday(goal);
  const ico = ICONS[goal.slug] ?? FALLBACK;
  const streak = goal.streak ?? 0;

  return (
    <Pressable
      onPress={() => onTap(goal.goalId)}
      className="flex-row items-center rounded-[20px] bg-white px-3.5 py-4"
      style={{
        gap: 12,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.1,
        shadowRadius: 12,
        elevation: 3,
      }}
    >
      <View
        className="h-11 w-11 shrink-0 rounded-2xl items-center justify-center"
        style={{ backgroundColor: ico.color + '22' }}
      >
        <Ionicons name={ico.icon} size={22} color={ico.color} />
      </View>
      <View className="min-w-0 flex-1">
        <Text numberOfLines={1} className="text-[16px] font-bold text-neutral-900">
          {goal.label}
        </Text>
        {/* days-in-a-row streak underneath the goal */}
        <Text
          numberOfLines={1}
          className="mt-0.5 text-[12.5px] font-semibold"
          style={{ color: streak > 0 ? '#ff7a3d' : '#a3a3a3' }}
        >
          {streak > 0 ? `🔥 ${streak} day${streak === 1 ? '' : 's'} in a row` : 'Start your streak'}
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
  );
}
