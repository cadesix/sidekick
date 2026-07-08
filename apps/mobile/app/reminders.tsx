import { useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { GestureHandlerRootView, Swipeable } from "react-native-gesture-handler";
import Animated, { FadeOut, LinearTransition } from "react-native-reanimated";
import DateTimePicker, { type DateTimePickerEvent } from "@react-native-community/datetimepicker";
import * as Haptics from "expo-haptics";
import { ChevronLeft, Repeat, Trash2 } from "lucide-react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  type Schedule,
  type WeekdayCode,
  WEEKDAYS,
  formatWallDateTime,
  parseTimeOfDay,
  parseWallDateTime,
  rruleWeekdays,
  scheduleKindLabel,
  scheduleTimeLabel,
  weekdaysToRrule,
} from "@sidekick/shared";
import { BottomSheet } from "~/components/BottomSheet";
import { PrimaryButton } from "~/components/PrimaryButton";
import { Skeleton } from "~/components/Skeleton";
import { SolidShadow } from "~/components/SolidShadow";
import {
  type Reminder,
  type ReminderSections,
  deleteReminder,
  fetchReminders,
  updateReminder,
} from "~/lib/api";

const WEEKDAY_INITIALS: Record<WeekdayCode, string> = {
  MO: "M",
  TU: "T",
  WE: "W",
  TH: "T",
  FR: "F",
  SA: "S",
  SU: "S",
};

function SectionLabel({ title }: { title: string }) {
  return (
    <Text className="text-[12px] font-medium uppercase tracking-wide text-ink/40 mb-2 mt-6 px-1">
      {title}
    </Text>
  );
}

function ReminderCard({ reminder, onPress }: { reminder: Reminder; onPress: () => void }) {
  const { schedule } = reminder;
  const time = schedule ? scheduleTimeLabel(schedule) : "—";
  const kind = schedule ? scheduleKindLabel(schedule) : "";
  const recurring = schedule?.type === "recurring";
  return (
    <SolidShadow radius={16} onPress={onPress} className="bg-white">
      <View className="p-4">
        <Text className="text-[16px] font-bold text-ink">{reminder.text}</Text>
        <View className="flex-row items-center justify-between mt-1.5">
          <Text className="text-[13px] text-ink/60">{time}</Text>
          <View className="flex-row items-center gap-1.5">
            <Text className="text-[13px] text-ink/60">{kind}</Text>
            {recurring ? <Repeat size={14} color="rgba(17,17,17,0.6)" strokeWidth={2.5} /> : null}
          </View>
        </View>
      </View>
    </SolidShadow>
  );
}

function SwipeableRow({
  reminder,
  onOpen,
  onDelete,
}: {
  reminder: Reminder;
  onOpen: () => void;
  onDelete: () => void;
}) {
  const deleteAction = () => (
    <Pressable
      onPress={onDelete}
      className="bg-ink rounded-2xl my-1 ml-2 w-20 items-center justify-center active:opacity-80"
      accessibilityLabel="Delete reminder"
    >
      <Trash2 size={20} color="#fff" strokeWidth={2.5} />
    </Pressable>
  );
  return (
    <Animated.View exiting={FadeOut.duration(200)} layout={LinearTransition} className="mb-2.5">
      <Swipeable renderRightActions={deleteAction} overshootRight={false}>
        <ReminderCard reminder={reminder} onPress={onOpen} />
      </Swipeable>
    </Animated.View>
  );
}

function EmptyState() {
  return (
    <View className="items-center px-8 pt-24">
      <Text className="text-[15px] leading-[1.6] text-ink/55 text-center">
        nothing on the books. tell me in chat and i'll remember for you
      </Text>
    </View>
  );
}

type SheetState = { mode: "once" | "recurring"; text: string; date: Date; days: WeekdayCode[] };

function initialSheetState(reminder: Reminder): SheetState {
  const schedule = reminder.schedule;
  if (schedule?.type === "recurring") {
    const { hour, minute } = parseTimeOfDay(schedule.time);
    const date = new Date();
    date.setHours(hour, minute, 0, 0);
    return { mode: "recurring", text: reminder.text, date, days: rruleWeekdays(schedule.rrule) };
  }
  if (schedule?.type === "once") {
    const wall = parseWallDateTime(schedule.at);
    return {
      mode: "once",
      text: reminder.text,
      date: new Date(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute),
      days: [],
    };
  }
  return { mode: "once", text: reminder.text, date: new Date(), days: [] };
}

function sheetSchedule(state: SheetState): Schedule {
  if (state.mode === "recurring") {
    const time = `${`${state.date.getHours()}`.padStart(2, "0")}:${`${state.date.getMinutes()}`.padStart(2, "0")}`;
    return { type: "recurring", rrule: weekdaysToRrule(state.days), time };
  }
  return {
    type: "once",
    at: formatWallDateTime({
      year: state.date.getFullYear(),
      month: state.date.getMonth() + 1,
      day: state.date.getDate(),
      hour: state.date.getHours(),
      minute: state.date.getMinutes(),
    }),
  };
}

function ModeChip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      className={`flex-1 items-center py-2.5 rounded-full ${selected ? "bg-sun" : "bg-field"}`}
    >
      <Text className={`text-[15px] font-bold ${selected ? "text-ink" : "text-ink/50"}`}>{label}</Text>
    </Pressable>
  );
}

function WeekdayToggle({
  code,
  selected,
  onPress,
}: {
  code: WeekdayCode;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      className={`w-9 h-9 rounded-full items-center justify-center ${selected ? "bg-ink" : "bg-field"}`}
      accessibilityLabel={code}
    >
      <Text className={`text-[13px] font-bold ${selected ? "text-white" : "text-ink/50"}`}>
        {WEEKDAY_INITIALS[code]}
      </Text>
    </Pressable>
  );
}

function EditSheet({
  reminder,
  onClose,
  onSave,
  saving,
}: {
  reminder: Reminder;
  onClose: () => void;
  onSave: (schedule: Schedule, text: string) => void;
  saving: boolean;
}) {
  const [state, setState] = useState<SheetState>(() => initialSheetState(reminder));

  const onPickTime = (_event: DateTimePickerEvent, picked?: Date) => {
    if (picked) {
      setState((prev) => ({ ...prev, date: picked }));
    }
  };
  const toggleDay = (code: WeekdayCode) => {
    setState((prev) => ({
      ...prev,
      days: prev.days.includes(code)
        ? prev.days.filter((d) => d !== code)
        : [...prev.days, code],
    }));
  };

  return (
    <BottomSheet visible onClose={onClose}>
      <Text className="text-[18px] font-extrabold text-ink mb-4">Edit reminder</Text>

      <TextInput
        value={state.text}
        onChangeText={(text) => setState((prev) => ({ ...prev, text }))}
        placeholder="what should i remind you about?"
        placeholderTextColor="rgba(17,17,17,0.35)"
        className="bg-field rounded-2xl px-4 py-3.5 text-[16px] text-ink"
        multiline
      />

      <View className="flex-row gap-2 mt-4">
        <ModeChip
          label="Once"
          selected={state.mode === "once"}
          onPress={() => setState((prev) => ({ ...prev, mode: "once" }))}
        />
        <ModeChip
          label="Recurring"
          selected={state.mode === "recurring"}
          onPress={() => setState((prev) => ({ ...prev, mode: "recurring" }))}
        />
      </View>

      <View className="items-center mt-2">
        <DateTimePicker
          value={state.date}
          mode={state.mode === "once" ? "datetime" : "time"}
          onChange={onPickTime}
        />
      </View>

      {state.mode === "recurring" ? (
        <View className="flex-row justify-between mt-2 mb-1">
          {WEEKDAYS.map((code) => (
            <WeekdayToggle
              key={code}
              code={code}
              selected={state.days.includes(code)}
              onPress={() => toggleDay(code)}
            />
          ))}
        </View>
      ) : null}

      <View className="mt-5">
        <PrimaryButton
          label="Save"
          loading={saving}
          disabled={
            state.text.trim().length === 0 ||
            (state.mode === "recurring" && state.days.length === 0)
          }
          onPress={() => onSave(sheetSchedule(state), state.text.trim())}
        />
      </View>
    </BottomSheet>
  );
}

function useReminders() {
  return useQuery<ReminderSections>({ queryKey: ["reminders"], queryFn: fetchReminders });
}

export default function Reminders() {
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const reminders = useReminders();
  const [editing, setEditing] = useState<Reminder | null>(null);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["reminders"] });

  const removeMutation = useMutation({
    mutationFn: (id: string) => deleteReminder(id),
    onSuccess: invalidate,
  });
  const saveMutation = useMutation({
    mutationFn: (input: { id: string; text: string; schedule: Schedule }) => updateReminder(input),
    onSuccess: () => {
      setEditing(null);
      invalidate();
    },
  });

  const onDelete = (id: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    removeMutation.mutate(id);
  };

  const sections = reminders.data;
  const isEmpty =
    sections &&
    sections.today.length === 0 &&
    sections.upcoming.length === 0 &&
    sections.paused.length === 0;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <View className="flex-1 bg-white" style={{ paddingTop: insets.top }}>
        <View className="flex-row items-center px-3 py-2">
          <Pressable
            onPress={() => router.back()}
            className="w-11 h-11 items-center justify-center active:opacity-60"
            accessibilityLabel="Back"
          >
            <ChevronLeft size={26} color="#111" strokeWidth={2.5} />
          </Pressable>
          <Text className="text-[20px] font-extrabold text-ink ml-1">Reminders</Text>
        </View>

        <ScrollView
          className="flex-1"
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 40 }}
          showsVerticalScrollIndicator={false}
        >
          {reminders.isPending ? (
            <View className="gap-2.5 pt-6">
              <Skeleton className="h-20 rounded-2xl" />
              <Skeleton className="h-20 rounded-2xl" />
            </View>
          ) : null}

          {isEmpty ? <EmptyState /> : null}

          {sections && sections.today.length > 0 ? <SectionLabel title="Today" /> : null}
          {(sections?.today ?? []).map((reminder) => (
            <SwipeableRow
              key={reminder.id}
              reminder={reminder}
              onOpen={() => setEditing(reminder)}
              onDelete={() => onDelete(reminder.id)}
            />
          ))}

          {sections && sections.upcoming.length > 0 ? <SectionLabel title="Upcoming" /> : null}
          {(sections?.upcoming ?? []).map((reminder) => (
            <SwipeableRow
              key={reminder.id}
              reminder={reminder}
              onOpen={() => setEditing(reminder)}
              onDelete={() => onDelete(reminder.id)}
            />
          ))}

          {sections && sections.paused.length > 0 ? <SectionLabel title="Paused" /> : null}
          {(sections?.paused ?? []).map((reminder) => (
            <SwipeableRow
              key={reminder.id}
              reminder={reminder}
              onOpen={() => setEditing(reminder)}
              onDelete={() => onDelete(reminder.id)}
            />
          ))}
        </ScrollView>

        {editing ? (
          <EditSheet
            reminder={editing}
            saving={saveMutation.isPending}
            onClose={() => setEditing(null)}
            onSave={(schedule, text) => saveMutation.mutate({ id: editing.id, text, schedule })}
          />
        ) : null}
      </View>
    </GestureHandlerRootView>
  );
}
