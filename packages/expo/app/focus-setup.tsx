import DateTimePicker, { type DateTimePickerEvent } from "@react-native-community/datetimepicker";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { SymbolView, type SFSymbol } from "expo-symbols";
import { useState } from "react";
import {
  Alert,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { DeviceActivitySelectionViewPersisted } from "react-native-device-activity";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  BUDGET_CHOICES,
  type FocusMode,
  type FocusScheduleConfig,
  selectionCount,
} from "@sidekick/shared";
import { PrimaryButton } from "~/components/PrimaryButton";
import { fetchMe } from "~/lib/api";
import {
  DEFAULT_FOCUS_SCHEDULE,
  activateFocus,
  disableFocus,
  focusAvailable,
  forceBlock,
  getLocalFocusSettings,
  requestFocusAuthorization,
  startFocusSession,
  temporaryUnlock,
} from "~/lib/focus";

type Step = "intro" | "picker" | "mode" | "review" | "detail";

const DAY_OPTIONS = [
  { value: 1, label: "S" },
  { value: 2, label: "M" },
  { value: 3, label: "T" },
  { value: 4, label: "W" },
  { value: 5, label: "T" },
  { value: 6, label: "F" },
  { value: 7, label: "S" },
];

function initialStep(): Step {
  return getLocalFocusSettings().enabled ? "detail" : "intro";
}

function timeDate(hour: number, minute: number): Date {
  const date = new Date();
  date.setHours(hour, minute, 0, 0);
  return date;
}

function timeLabel(hour: number, minute: number): string {
  return timeDate(hour, minute).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function modeTitle(mode: FocusMode): string {
  if (mode === "daily") {
    return "Daily allowance";
  }
  if (mode === "scheduled") {
    return "Scheduled Focus";
  }
  return "Only when I ask";
}

function modeDescription(mode: FocusMode): string {
  if (mode === "daily") {
    return "Use guarded apps until a shared daily allowance runs out.";
  }
  if (mode === "scheduled") {
    return "Block guarded apps during a recurring time window.";
  }
  return "Nothing blocks automatically. Start from here or ask Sidekick.";
}

function Fact({ symbol, children }: { symbol: SFSymbol; children: string }) {
  return (
    <View style={styles.fact}>
      <View style={styles.factIcon}>
        <SymbolView name={symbol} size={18} weight="semibold" tintColor="#0A84FF" />
      </View>
      <Text style={styles.factText}>{children}</Text>
    </View>
  );
}

function ChoiceCard({
  title,
  description,
  selected,
  onPress,
}: {
  title: string;
  description: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      onPress={onPress}
      style={[styles.choiceCard, selected ? styles.choiceCardSelected : null]}
    >
      <View style={[styles.radio, selected ? styles.radioSelected : null]}>
        {selected ? <View style={styles.radioDot} /> : null}
      </View>
      <View style={styles.choiceCopy}>
        <Text style={styles.choiceTitle}>{title}</Text>
        <Text style={styles.choiceDescription}>{description}</Text>
      </View>
    </Pressable>
  );
}

export default function FocusSetup() {
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const saved = getLocalFocusSettings();
  const [step, setStep] = useState<Step>(initialStep);
  const [mode, setMode] = useState<FocusMode>(saved.mode);
  const [budgetMinutes, setBudgetMinutes] = useState(saved.budgetMinutes ?? 30);
  const [count, setCount] = useState(saved.selectionCount);
  const [schedule, setSchedule] = useState<FocusScheduleConfig>(
    saved.schedule ?? DEFAULT_FOCUS_SCHEDULE,
  );
  const [showStartPicker, setShowStartPicker] = useState(false);
  const [showEndPicker, setShowEndPicker] = useState(false);
  const available = focusAvailable();

  const authorize = useMutation({
    mutationFn: requestFocusAuthorization,
    onSuccess: (approved) => {
      if (approved) {
        setStep("picker");
        return;
      }
      Alert.alert(
        "Screen Time access is off",
        "Allow Screen Time access in Settings to use Focus.",
        [
          { text: "Not now", style: "cancel" },
          { text: "Open Settings", onPress: () => void Linking.openSettings() },
        ],
      );
    },
    onError: () => {
      Alert.alert("Focus is unavailable", "Screen Time access couldn't be requested on this device.");
    },
  });

  const activate = useMutation({
    mutationFn: async () => {
      const me = await fetchMe();
      const selectedSchedule = mode === "scheduled" ? schedule : null;
      const selectedBudget = mode === "daily" ? budgetMinutes : null;
      const started = await activateFocus({
        mode,
        budgetMinutes: selectedBudget,
        schedule: selectedSchedule,
        selectionCount: count,
        sidekickName: me.sidekickName ?? "your sidekick",
      });
      if (!started) {
        throw new Error("focus activation failed");
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["focus-local"] });
      setStep("detail");
    },
    onError: () => {
      Alert.alert("Focus wasn't turned on", "Your choices are saved. Try again in a moment.");
    },
  });

  const command = useMutation({
    mutationFn: async (action: "block" | "session" | "unlock" | "disable") => {
      if (action === "block") {
        if (!forceBlock()) {
          throw new Error("no selection");
        }
      } else if (action === "session") {
        if (!(await startFocusSession(45))) {
          throw new Error("no selection");
        }
      } else if (action === "unlock") {
        await temporaryUnlock(15);
      } else {
        disableFocus();
      }
      return action;
    },
    onSuccess: (action) => {
      void queryClient.invalidateQueries({ queryKey: ["focus-local"] });
      if (action === "disable") {
        setStep("intro");
        return;
      }
      const message = action === "unlock" ? "Unlocked for 15 minutes." : "Focus is active.";
      Alert.alert(message);
    },
  });

  function updateTime(kind: "start" | "end", event: DateTimePickerEvent, date?: Date): void {
    if (kind === "start") {
      setShowStartPicker(false);
    } else {
      setShowEndPicker(false);
    }
    if (event.type !== "set" || !date) {
      return;
    }
    if (kind === "start") {
      setSchedule((current) => ({
        ...current,
        startHour: date.getHours(),
        startMinute: date.getMinutes(),
      }));
      return;
    }
    setSchedule((current) => ({
      ...current,
      endHour: date.getHours(),
      endMinute: date.getMinutes(),
    }));
  }

  function toggleDay(day: number): void {
    setSchedule((current) => {
      if (current.days.includes(day)) {
        if (current.days.length === 1) {
          return current;
        }
        return { ...current, days: current.days.filter((value) => value !== day) };
      }
      return { ...current, days: [...current.days, day].sort() };
    });
  }

  function title(): string {
    if (step === "picker") {
      return "Choose distractions";
    }
    if (step === "mode") {
      return "How Focus works";
    }
    if (step === "review") {
      return "Review Focus";
    }
    return "Focus";
  }

  function goBack(): void {
    if (step === "detail" || step === "intro") {
      router.back();
    } else if (step === "picker") {
      setStep("intro");
    } else if (step === "mode") {
      setStep("picker");
    } else {
      setStep("mode");
    }
  }

  const timeRangeValid =
    schedule.endHour * 60 + schedule.endMinute > schedule.startHour * 60 + schedule.startMinute;
  const reviewReady = count > 0 && (mode !== "scheduled" || timeRangeValid);

  return (
    <View style={styles.screen}>
      <View style={[styles.header, { paddingTop: insets.top + 6 }]}>
        <Pressable accessibilityLabel="Back" onPress={goBack} style={styles.headerButton}>
          <SymbolView name="chevron.left" size={20} weight="semibold" tintColor="#0A84FF" />
        </Pressable>
        <Text style={styles.headerTitle}>{title()}</Text>
        <View style={styles.headerButton} />
      </View>

      {step === "picker" ? (
        <View style={styles.pickerScreen}>
          <View style={styles.pickerIntro}>
            <Text style={styles.pickerHelper}>
              Pick the things you’d like a little help stepping away from.
            </Text>
            <Text style={styles.privacyCaption}>Sidekick can’t see what you choose.</Text>
          </View>
          <View style={styles.pickerFrame}>
            <DeviceActivitySelectionViewPersisted
              style={styles.picker}
              familyActivitySelectionId="focus"
              includeEntireCategory
              onSelectionChange={(event) => setCount(selectionCount(event.nativeEvent))}
            />
          </View>
          <View style={[styles.bottomBar, { paddingBottom: insets.bottom + 12 }]}>
            <PrimaryButton label="Next" disabled={count < 1} onPress={() => setStep("mode")} />
          </View>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 120 }]}
          showsVerticalScrollIndicator={false}
        >
          {step === "intro" ? (
            <View>
              <View style={styles.heroIcon}>
                <SymbolView
                  name="shield.lefthalf.filled"
                  size={46}
                  weight="semibold"
                  tintColor="#0A84FF"
                />
              </View>
              <Text style={styles.heroTitle}>Less autopilot. More of your day.</Text>
              <Text style={styles.heroBody}>
                Choose the apps and sites that pull you in. Apple handles the blocking on this iPhone.
              </Text>
              <View style={styles.factList}>
                <Fact symbol="iphone">Your choices stay on this iPhone.</Fact>
                <Fact symbol="bubble.left.and.bubble.right.fill">
                  Sidekick can change a limit when you ask.
                </Fact>
                <Fact symbol="arrow.uturn.backward.circle.fill">
                  You can pause or turn it off anytime.
                </Fact>
              </View>
              {!available ? (
                <View style={styles.notice}>
                  <Text style={styles.noticeTitle}>Focus isn’t available on this device</Text>
                  <Text style={styles.noticeBody}>Focus requires iOS 16 or later and Screen Time access.</Text>
                </View>
              ) : null}
            </View>
          ) : null}

          {step === "mode" ? (
            <View>
              <Text style={styles.sectionLead}>Choose one simple rule. You can change it anytime.</Text>
              <ChoiceCard
                title="Daily allowance"
                description={modeDescription("daily")}
                selected={mode === "daily"}
                onPress={() => setMode("daily")}
              />
              <ChoiceCard
                title="Scheduled Focus"
                description={modeDescription("scheduled")}
                selected={mode === "scheduled"}
                onPress={() => setMode("scheduled")}
              />
              <ChoiceCard
                title="Only when I ask"
                description={modeDescription("manual")}
                selected={mode === "manual"}
                onPress={() => setMode("manual")}
              />

              {mode === "daily" ? (
                <View style={styles.configCard}>
                  <Text style={styles.configTitle}>Daily allowance</Text>
                  <View style={styles.chipRow}>
                    {BUDGET_CHOICES.map((minutes) => (
                      <Pressable
                        key={minutes}
                        onPress={() => setBudgetMinutes(minutes)}
                        style={[styles.chip, budgetMinutes === minutes ? styles.chipSelected : null]}
                      >
                        <Text
                          style={[
                            styles.chipText,
                            budgetMinutes === minutes ? styles.chipTextSelected : null,
                          ]}
                        >
                          {minutes === 60 ? "1 hr" : `${minutes} min`}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                </View>
              ) : null}

              {mode === "scheduled" ? (
                <View style={styles.configCard}>
                  <Text style={styles.configTitle}>Days</Text>
                  <View style={styles.dayRow}>
                    {DAY_OPTIONS.map((day, index) => {
                      const selected = schedule.days.includes(day.value);
                      return (
                        <Pressable
                          key={`${day.value}-${index}`}
                          accessibilityLabel={`Day ${day.value}`}
                          onPress={() => toggleDay(day.value)}
                          style={[styles.dayChip, selected ? styles.dayChipSelected : null]}
                        >
                          <Text style={[styles.dayText, selected ? styles.dayTextSelected : null]}>
                            {day.label}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                  <Pressable style={styles.timeRow} onPress={() => setShowStartPicker(true)}>
                    <Text style={styles.timeLabel}>Starts</Text>
                    <Text style={styles.timeValue}>
                      {timeLabel(schedule.startHour, schedule.startMinute)}
                    </Text>
                  </Pressable>
                  <View style={styles.divider} />
                  <Pressable style={styles.timeRow} onPress={() => setShowEndPicker(true)}>
                    <Text style={styles.timeLabel}>Ends</Text>
                    <Text style={styles.timeValue}>
                      {timeLabel(schedule.endHour, schedule.endMinute)}
                    </Text>
                  </Pressable>
                  {!timeRangeValid ? (
                    <Text style={styles.errorText}>End time must be later than start time.</Text>
                  ) : null}
                  {showStartPicker ? (
                    <DateTimePicker
                      value={timeDate(schedule.startHour, schedule.startMinute)}
                      mode="time"
                      onChange={(event, date) => updateTime("start", event, date)}
                    />
                  ) : null}
                  {showEndPicker ? (
                    <DateTimePicker
                      value={timeDate(schedule.endHour, schedule.endMinute)}
                      mode="time"
                      onChange={(event, date) => updateTime("end", event, date)}
                    />
                  ) : null}
                </View>
              ) : null}
              <Text style={styles.helper}>You can change this here or ask Sidekick later.</Text>
            </View>
          ) : null}

          {step === "review" ? (
            <View>
              <View style={styles.statusIcon}>
                <SymbolView name="checkmark.shield.fill" size={42} weight="semibold" tintColor="#30D158" />
              </View>
              <Text style={styles.reviewTitle}>Ready when you are.</Text>
              <View style={styles.summaryCard}>
                <View style={styles.summaryRow}>
                  <Text style={styles.summaryLabel}>Guarding</Text>
                  <Text style={styles.summaryValue}>{count} selections</Text>
                </View>
                <View style={styles.divider} />
                <View style={styles.summaryRow}>
                  <Text style={styles.summaryLabel}>How it works</Text>
                  <Text style={styles.summaryValue}>{modeTitle(mode)}</Text>
                </View>
                {mode === "daily" ? (
                  <View>
                    <View style={styles.divider} />
                    <View style={styles.summaryRow}>
                      <Text style={styles.summaryLabel}>Allowance</Text>
                      <Text style={styles.summaryValue}>{budgetMinutes} min each day</Text>
                    </View>
                  </View>
                ) : null}
                {mode === "scheduled" ? (
                  <View>
                    <View style={styles.divider} />
                    <View style={styles.summaryRow}>
                      <Text style={styles.summaryLabel}>Window</Text>
                      <Text style={styles.summaryValue}>
                        {timeLabel(schedule.startHour, schedule.startMinute)}–
                        {timeLabel(schedule.endHour, schedule.endMinute)}
                      </Text>
                    </View>
                  </View>
                ) : null}
              </View>
              <View style={styles.privacyBox}>
                <SymbolView name="lock.fill" size={17} weight="semibold" tintColor="#0A84FF" />
                <Text style={styles.privacyBoxText}>
                  Your selections and Screen Time activity stay on this iPhone. Sidekick receives no usage data.
                </Text>
              </View>
            </View>
          ) : null}

          {step === "detail" ? (
            <View>
              <View style={styles.activeHero}>
                <View style={styles.activeIcon}>
                  <SymbolView
                    name="shield.lefthalf.filled"
                    size={34}
                    weight="semibold"
                    tintColor="#0A84FF"
                  />
                </View>
                <Text style={styles.activeTitle}>Focus is on</Text>
                <Text style={styles.activeSubtitle}>{modeDescription(saved.mode)}</Text>
              </View>
              <View style={styles.summaryCard}>
                <Pressable style={styles.detailRow} onPress={() => setStep("picker")}>
                  <View style={styles.detailCopy}>
                    <Text style={styles.detailTitle}>Guarded selections</Text>
                    <Text style={styles.detailSubtitle}>{saved.selectionCount} selected on this iPhone</Text>
                  </View>
                  <SymbolView name="chevron.right" size={14} weight="semibold" tintColor="#8E8E93" />
                </Pressable>
                <View style={styles.divider} />
                <Pressable style={styles.detailRow} onPress={() => setStep("mode")}>
                  <View style={styles.detailCopy}>
                    <Text style={styles.detailTitle}>How it works</Text>
                    <Text style={styles.detailSubtitle}>{modeTitle(saved.mode)}</Text>
                  </View>
                  <SymbolView name="chevron.right" size={14} weight="semibold" tintColor="#8E8E93" />
                </Pressable>
              </View>
              <Text style={styles.groupLabel}>QUICK ACTIONS</Text>
              <View style={styles.summaryCard}>
                <Pressable style={styles.detailRow} onPress={() => command.mutate("block")}>
                  <Text style={styles.detailTitle}>Block now</Text>
                  <SymbolView name="lock.fill" size={17} weight="semibold" tintColor="#0A84FF" />
                </Pressable>
                <View style={styles.divider} />
                <Pressable style={styles.detailRow} onPress={() => command.mutate("session")}>
                  <Text style={styles.detailTitle}>Start a 45-minute session</Text>
                  <SymbolView name="timer" size={18} weight="semibold" tintColor="#0A84FF" />
                </Pressable>
                <View style={styles.divider} />
                <Pressable style={styles.detailRow} onPress={() => command.mutate("unlock")}>
                  <Text style={styles.detailTitle}>Unlock for 15 minutes</Text>
                  <SymbolView name="lock.open.fill" size={18} weight="semibold" tintColor="#0A84FF" />
                </Pressable>
              </View>
              <Pressable style={styles.disableButton} onPress={() => command.mutate("disable")}>
                <Text style={styles.disableText}>Turn off Focus</Text>
              </Pressable>
              <Text style={styles.detailPrivacy}>
                Sidekick can carry out controls you request, but it can’t see which apps you chose or how you use them.
              </Text>
            </View>
          ) : null}
        </ScrollView>
      )}

      {step === "intro" ? (
        <View style={[styles.bottomBar, { paddingBottom: insets.bottom + 12 }]}>
          <PrimaryButton
            label="Continue with Screen Time"
            disabled={!available}
            loading={authorize.isPending}
            onPress={() => authorize.mutate()}
          />
          <Pressable onPress={() => router.back()} style={styles.secondaryAction}>
            <Text style={styles.secondaryActionText}>Not now</Text>
          </Pressable>
        </View>
      ) : null}
      {step === "mode" ? (
        <View style={[styles.bottomBar, { paddingBottom: insets.bottom + 12 }]}>
          <PrimaryButton
            label="Review Focus"
            disabled={!reviewReady}
            onPress={() => setStep("review")}
          />
        </View>
      ) : null}
      {step === "review" ? (
        <View style={[styles.bottomBar, { paddingBottom: insets.bottom + 12 }]}>
          <PrimaryButton
            label="Turn on Focus"
            loading={activate.isPending}
            onPress={() => activate.mutate()}
          />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#F2F2F7" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    paddingBottom: 10,
    backgroundColor: "#F2F2F7",
  },
  headerButton: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  headerTitle: { fontSize: 17, fontWeight: "700", color: "#000000" },
  content: { paddingHorizontal: 20, paddingTop: 12 },
  heroIcon: {
    width: 92,
    height: 92,
    borderRadius: 28,
    borderCurve: "continuous",
    backgroundColor: "#E5F2FF",
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "center",
    marginTop: 28,
  },
  heroTitle: {
    fontSize: 32,
    lineHeight: 37,
    letterSpacing: -0.7,
    fontWeight: "800",
    color: "#000000",
    textAlign: "center",
    marginTop: 28,
  },
  heroBody: {
    fontSize: 17,
    lineHeight: 24,
    color: "#636366",
    textAlign: "center",
    marginTop: 12,
  },
  factList: { gap: 18, marginTop: 34 },
  fact: { flexDirection: "row", alignItems: "center", gap: 14 },
  factIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#E5F2FF",
    alignItems: "center",
    justifyContent: "center",
  },
  factText: { flex: 1, fontSize: 16, lineHeight: 21, color: "#1C1C1E" },
  notice: { backgroundColor: "#FFF4E5", borderRadius: 14, padding: 16, marginTop: 28 },
  noticeTitle: { fontSize: 15, fontWeight: "700", color: "#7A4B00" },
  noticeBody: { fontSize: 14, lineHeight: 19, color: "#7A4B00", marginTop: 3 },
  bottomBar: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(242,242,247,0.96)",
    paddingHorizontal: 20,
    paddingTop: 12,
  },
  secondaryAction: { minHeight: 44, alignItems: "center", justifyContent: "center" },
  secondaryActionText: { fontSize: 16, fontWeight: "600", color: "#0A84FF" },
  pickerScreen: { flex: 1, paddingHorizontal: 16, paddingBottom: 110 },
  pickerIntro: { paddingHorizontal: 4, paddingTop: 6, paddingBottom: 12 },
  pickerHelper: { fontSize: 16, lineHeight: 22, color: "#3A3A3C", textAlign: "center" },
  privacyCaption: { fontSize: 13, color: "#0A84FF", textAlign: "center", marginTop: 6 },
  pickerFrame: {
    flex: 1,
    minHeight: 400,
    overflow: "hidden",
    borderRadius: 18,
    borderCurve: "continuous",
    backgroundColor: "#FFFFFF",
  },
  picker: { flex: 1 },
  sectionLead: { fontSize: 17, lineHeight: 23, color: "#636366", marginBottom: 18 },
  choiceCard: {
    flexDirection: "row",
    gap: 12,
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    borderCurve: "continuous",
    borderWidth: 2,
    borderColor: "transparent",
    padding: 16,
    marginBottom: 10,
  },
  choiceCardSelected: { borderColor: "#0A84FF", backgroundColor: "#F5FAFF" },
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: "#C7C7CC",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 1,
  },
  radioSelected: { borderColor: "#0A84FF" },
  radioDot: { width: 12, height: 12, borderRadius: 6, backgroundColor: "#0A84FF" },
  choiceCopy: { flex: 1 },
  choiceTitle: { fontSize: 17, fontWeight: "700", color: "#000000" },
  choiceDescription: { fontSize: 14, lineHeight: 19, color: "#636366", marginTop: 3 },
  configCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    borderCurve: "continuous",
    padding: 16,
    marginTop: 8,
  },
  configTitle: { fontSize: 15, fontWeight: "700", color: "#000000", marginBottom: 12 },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { borderRadius: 18, backgroundColor: "#E9E9EB", paddingHorizontal: 14, paddingVertical: 9 },
  chipSelected: { backgroundColor: "#0A84FF" },
  chipText: { fontSize: 14, fontWeight: "600", color: "#1C1C1E" },
  chipTextSelected: { color: "#FFFFFF" },
  dayRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 12 },
  dayChip: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#E9E9EB",
    alignItems: "center",
    justifyContent: "center",
  },
  dayChipSelected: { backgroundColor: "#0A84FF" },
  dayText: { fontSize: 14, fontWeight: "700", color: "#1C1C1E" },
  dayTextSelected: { color: "#FFFFFF" },
  timeRow: { minHeight: 50, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  timeLabel: { fontSize: 16, color: "#1C1C1E" },
  timeValue: { fontSize: 16, color: "#0A84FF" },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: "#D1D1D6", marginLeft: 16 },
  errorText: { color: "#FF3B30", fontSize: 13, marginTop: 8 },
  helper: { fontSize: 13, lineHeight: 18, color: "#8E8E93", margin: 14 },
  statusIcon: { alignItems: "center", marginTop: 30 },
  reviewTitle: {
    fontSize: 30,
    fontWeight: "800",
    color: "#000000",
    textAlign: "center",
    marginTop: 16,
    marginBottom: 26,
  },
  summaryCard: { backgroundColor: "#FFFFFF", borderRadius: 16, borderCurve: "continuous", overflow: "hidden" },
  summaryRow: { minHeight: 54, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, gap: 16 },
  summaryLabel: { fontSize: 16, color: "#1C1C1E" },
  summaryValue: { flex: 1, fontSize: 16, color: "#636366", textAlign: "right" },
  privacyBox: { flexDirection: "row", alignItems: "flex-start", gap: 10, backgroundColor: "#E5F2FF", borderRadius: 14, padding: 14, marginTop: 18 },
  privacyBoxText: { flex: 1, fontSize: 13, lineHeight: 18, color: "#285A8C" },
  activeHero: { alignItems: "center", marginTop: 18, marginBottom: 28 },
  activeIcon: { width: 72, height: 72, borderRadius: 24, borderCurve: "continuous", backgroundColor: "#E5F2FF", alignItems: "center", justifyContent: "center" },
  activeTitle: { fontSize: 28, fontWeight: "800", color: "#000000", marginTop: 16 },
  activeSubtitle: { fontSize: 15, lineHeight: 21, color: "#636366", textAlign: "center", marginTop: 5, paddingHorizontal: 20 },
  detailRow: { minHeight: 64, flexDirection: "row", alignItems: "center", paddingHorizontal: 16, gap: 12 },
  detailCopy: { flex: 1 },
  detailTitle: { fontSize: 16, fontWeight: "600", color: "#1C1C1E" },
  detailSubtitle: { fontSize: 13, color: "#8E8E93", marginTop: 3 },
  groupLabel: { fontSize: 13, color: "#8E8E93", marginLeft: 4, marginTop: 24, marginBottom: 8 },
  disableButton: { minHeight: 52, borderRadius: 14, borderWidth: 1, borderColor: "#FF3B30", alignItems: "center", justifyContent: "center", marginTop: 24 },
  disableText: { fontSize: 16, fontWeight: "600", color: "#FF3B30" },
  detailPrivacy: { fontSize: 13, lineHeight: 18, color: "#8E8E93", textAlign: "center", margin: 18 },
});
