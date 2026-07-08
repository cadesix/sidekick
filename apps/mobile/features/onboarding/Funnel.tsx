import { useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, Text, View } from "react-native";
import Animated, { Easing, useAnimatedStyle, withTiming } from "react-native-reanimated";
import { ChevronLeft } from "lucide-react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { completeOnboarding, updateProfile, type ProfileUpdate } from "~/lib/api";
import { interestWords } from "./interests";
import { canGoBack, nextIndex, prevIndex, progressSegments, stepAt } from "./navigation";
import { computePersonality, type Personality } from "./personality";
import { assembleGoalChoices } from "./plan";
import type { FunnelAnswers } from "./types";
import { ChoiceStep, GoalsStep, InterestsStep, NameStep, PersonalityStep } from "./steps/QuestionSteps";
import {
  FactStep,
  MeetStep,
  QuizIntroStep,
  RevealStep,
  StatementStep,
  TransitionStep,
  WelcomeStep,
} from "./steps/InterstitialSteps";
import { ResultStep } from "./steps/ResultStep";
import { ColorStep, NameSidekickStep } from "./steps/CustomizeSteps";
import { OnboardingChatStep, type OnboardingChatResult } from "./steps/OnboardingChatStep";

const FULL_BLEED = new Set([
  "welcome",
  "result",
  "reveal",
  "meet",
  "choose-color",
  "name-sidekick",
  "onboarding-chat",
]);

function personalityPayload(p: Personality) {
  return { archetype: p.name, tagline: p.tagline, blurb: p.blurb, percents: p.percents };
}

function Segment({ percent }: { percent: number }) {
  const style = useAnimatedStyle(
    () => ({
      transform: [
        { scaleX: withTiming(percent / 100, { duration: 500, easing: Easing.out(Easing.ease) }) },
      ],
    }),
    [percent],
  );
  return (
    <View className="flex-1 h-2 rounded-full bg-field overflow-hidden">
      <Animated.View
        style={[{ position: "absolute", left: 0, top: 0, bottom: 0, right: 0, transformOrigin: "left" }, style]}
        className="bg-sky rounded-full"
      />
    </View>
  );
}

export function Funnel() {
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<FunnelAnswers>({});
  const step = stepAt(index);

  const complete = useMutation({
    mutationFn: completeOnboarding,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["me"] });
      await queryClient.invalidateQueries({ queryKey: ["goals"] });
      router.replace("/");
    },
  });

  const goNext = () => setIndex((i) => nextIndex(i));
  const goPrev = () => setIndex((i) => prevIndex(i));
  const patch = (next: FunnelAnswers) => setAnswers((prev) => ({ ...prev, ...next }));
  const save = (update: ProfileUpdate) => {
    void updateProfile(update).catch(() => undefined);
  };

  const onChatFinish = (result: OnboardingChatResult) => {
    const personality = computePersonality(answers.personality);
    complete.mutate({
      name: answers.name ?? "friend",
      ageBracket: answers.age ?? "18-24",
      gender: answers.gender ?? "prefer-not",
      personality: personalityPayload(personality),
      sidekickName: answers.sidekickName ?? "Sidekick",
      sidekickColor: answers.sidekickColor ?? "yellow",
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      reminderTime: result.reminderTime ?? undefined,
      pushToken: result.pushToken ?? undefined,
      interests: interestWords(answers.interests ?? []),
      goals: assembleGoalChoices(answers.goals ?? [], result.patches),
    });
  };

  const showHeader = !FULL_BLEED.has(step.type);
  const segments = progressSegments(index);

  return (
    <View className="flex-1 bg-white" style={{ paddingTop: insets.top }}>
      {showHeader ? (
        <View className="px-5 pt-2 pb-1">
          <Pressable
            onPress={goPrev}
            className={`flex-row items-center -ml-1 h-9 ${canGoBack(index) ? "" : "opacity-0"}`}
            disabled={!canGoBack(index)}
            accessibilityLabel="Back"
          >
            <ChevronLeft size={22} color="#111" strokeWidth={2.5} />
            <Text className="text-[15px] font-semibold text-ink">Back</Text>
          </Pressable>
          <View className="flex-row gap-1.5 pt-1">
            {segments.map((pct, i) => (
              <Segment key={i} percent={pct} />
            ))}
          </View>
        </View>
      ) : null}

      <KeyboardAvoidingView className="flex-1" behavior={Platform.OS === "ios" ? "padding" : undefined}>
        {renderStep()}
      </KeyboardAvoidingView>
    </View>
  );

  function renderStep() {
    switch (step.type) {
      case "welcome":
        return <WelcomeStep title={step.title} cta={step.cta} onStart={goNext} />;
      case "goals":
        return (
          <GoalsStep
            config={step.question}
            initial={answers.goals}
            onSubmit={(values) => {
              patch({ goals: values });
              goNext();
            }}
          />
        );
      case "transition":
        return <TransitionStep goals={answers.goals ?? []} onContinue={goNext} />;
      case "quiz-intro":
        return <QuizIntroStep title={step.title} imageKey={step.imageKey} onContinue={goNext} />;
      case "statement":
        return <StatementStep title={step.title} imageKey={step.imageKey} cta={step.cta} onContinue={goNext} />;
      case "fact":
        return <FactStep title={step.title} onContinue={goNext} />;
      case "personality": {
        const id = step.question.id;
        return (
          <PersonalityStep
            item={step.question}
            selected={answers.personality?.[id]}
            onAnswer={(value) => {
              patch({ personality: { ...(answers.personality ?? {}), [id]: value } });
              goNext();
            }}
          />
        );
      }
      case "name":
        return (
          <NameStep
            title={step.title}
            placeholder={step.placeholder}
            initial={answers.name}
            onSubmit={(value) => {
              patch({ name: value });
              save({ name: value });
              goNext();
            }}
          />
        );
      case "choice":
        return (
          <ChoiceStep
            title={step.title}
            options={step.options}
            selected={step.key === "age" ? answers.age : answers.gender}
            onSelect={(value) => {
              if (step.key === "age") {
                patch({ age: value });
                save({ ageBracket: value });
              } else {
                patch({ gender: value });
                save({ gender: value });
              }
              goNext();
            }}
          />
        );
      case "interests":
        return (
          <InterestsStep
            config={step.question}
            initial={answers.interests}
            onSubmit={(values) => {
              patch({ interests: values });
              goNext();
            }}
          />
        );
      case "result":
        return (
          <ResultStep
            answers={answers.personality}
            onContinue={(personality) => {
              save({ personality: personalityPayload(personality) });
              goNext();
            }}
          />
        );
      case "reveal":
        return <RevealStep title={step.title} subtitle={step.subtitle} cta={step.cta} onContinue={goNext} />;
      case "meet":
        return <MeetStep cta={step.cta} onDone={goNext} />;
      case "choose-color":
        return (
          <ColorStep
            initial={answers.sidekickColor}
            onContinue={(colorId) => {
              patch({ sidekickColor: colorId });
              save({ sidekickColor: colorId });
              goNext();
            }}
          />
        );
      case "name-sidekick":
        return (
          <NameSidekickStep
            colorId={answers.sidekickColor}
            initial={answers.sidekickName}
            onContinue={(name) => {
              patch({ sidekickName: name });
              save({ sidekickName: name });
              goNext();
            }}
          />
        );
      case "onboarding-chat":
        return (
          <OnboardingChatStep
            goalSlugs={answers.goals ?? []}
            sidekickName={answers.sidekickName ?? "your sidekick"}
            finishing={complete.isPending}
            onFinish={onChatFinish}
          />
        );
      default:
        return null;
    }
  }
}
