import { useEffect, useState } from "react";
import { LuChevronLeft } from "react-icons/lu";
import { CompleteStep } from "./complete-step";
import { ResultStep } from "./result-step";
import { RevealStep } from "./reveal-step";
import { MeetStep } from "./meet-step";
import { ColorStep } from "./color-step";
import { NameSidekickStep } from "./name-sidekick-step";
import { OnboardingChat } from "./onboarding-chat";
import { FactStep } from "./fact-step";
import { NameStep } from "./name-step";
import { ChoiceStep } from "./choice-step";
import { StatementStep } from "./statement-step";
import { GoalsStep } from "./goals-step";
import { STEPS } from "./manifest";
import { PersonalityStep } from "./personality-step";
import { ProgressBar } from "./progress-bar";
import { QuizIntroStep } from "./quiz-intro-step";
import { TransitionStep } from "./transition-step";
import { WelcomeStep } from "./welcome-step";
import type { FunnelAnswers } from "./types";

// The funnel step is mirrored in the URL (?step=N) so FunnelHog can preview any
// step in isolation and browser back/forward navigates the flow.
function readStepFromUrl(): number {
	const raw = new URLSearchParams(window.location.search).get("step");
	const parsed = raw ? parseInt(raw, 10) : NaN;
	return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function useStepParam() {
	const [step, setStep] = useState(0);

	useEffect(() => {
		setStep(readStepFromUrl());
		const onPopState = () => setStep(readStepFromUrl());
		window.addEventListener("popstate", onPopState);
		return () => window.removeEventListener("popstate", onPopState);
	}, []);

	const goToStep = (next: number) => {
		setStep(next);
		const url = new URL(window.location.href);
		url.searchParams.set("step", String(next));
		window.history.pushState({}, "", url.toString());
	};

	return [step, goToStep] as const;
}

export function Funnel() {
	const [currentStepIndex, goToStep] = useStepParam();
	const [answers, setAnswers] = useState<FunnelAnswers>({});

	const steps = STEPS;
	const safeIndex = Math.min(Math.max(currentStepIndex, 0), steps.length - 1);
	const currentStep = steps[safeIndex];

	const isWelcome = currentStep?.type === "welcome";
	const isFullBleed =
		currentStep?.type === "complete" ||
		currentStep?.type === "result" ||
		currentStep?.type === "reveal" ||
		currentStep?.type === "meet" ||
		currentStep?.type === "choose-color" ||
		currentStep?.type === "name-sidekick" ||
		currentStep?.type === "onboarding-chat";
	const showBack = safeIndex > 0;

	const goNext = () => goToStep(Math.min(safeIndex + 1, steps.length - 1));
	const goPrev = () => goToStep(Math.max(safeIndex - 1, 0));

	if (!currentStep) {
		return null;
	}

	return (
		<div className="h-[100svh] flex flex-col overflow-hidden bg-white">
			{/* Welcome and the result card are full-bleed; every other step gets the
			    shared header: back control + step-progress bar. */}
			{!isWelcome && !isFullBleed ? (
				<header className="shrink-0 pt-3 z-10">
					<div className="max-w-md mx-auto w-full px-5">
						<div className="flex items-center h-9 pb-1">
							<button
								onClick={goPrev}
								className={`flex items-center gap-0.5 -ml-1 pr-2 text-[#111] font-semibold hover:opacity-70 transition ${
									showBack ? "" : "invisible"
								}`}
							>
								<LuChevronLeft className="w-5 h-5" strokeWidth={2.5} />
								<span className="text-[15px]">Back</span>
							</button>
						</div>
						<div className="pt-1 pb-1">
							<ProgressBar current={safeIndex} total={steps.length} />
						</div>
					</div>
				</header>
			) : null}

			<main className="flex-1 min-h-0">
				<div key={currentStep.id} className="max-w-md mx-auto w-full h-full animate-fade-up">
					{renderStepBody()}
				</div>
			</main>
		</div>
	);

	function renderStepBody() {
		if (!currentStep) {
			return null;
		}
		switch (currentStep.type) {
			case "welcome":
				return <WelcomeStep config={currentStep} onStart={goNext} />;
			case "name":
				return (
					<NameStep
						config={currentStep}
						initial={answers.name}
						onSubmit={(value) => {
							setAnswers((prev) => ({ ...prev, name: value }));
							goNext();
						}}
					/>
				);
			case "choice": {
				const key = currentStep.key;
				return (
					<ChoiceStep
						config={currentStep}
						selected={typeof answers[key] === "string" ? (answers[key] as string) : undefined}
						onSelect={(value) => {
							setAnswers((prev) => ({ ...prev, [key]: value }));
							goNext();
						}}
					/>
				);
			}
			case "statement":
				return <StatementStep config={currentStep} onContinue={goNext} />;
			case "goals":
				return (
					<GoalsStep
						config={currentStep.question}
						initial={answers.goals}
						onSubmit={(values) => {
							setAnswers((prev) => ({ ...prev, goals: values }));
							// Persist so the /home Stats tab can surface the chosen goals.
							try {
								localStorage.setItem("sidekick_goals_v1", JSON.stringify(values));
							} catch {
								// ignore storage failures
							}
							goNext();
						}}
					/>
				);
			case "transition": {
				// Resolve the user's selected goals to {label, icon} chips.
				const goalsStep = steps.find((s) => s.type === "goals");
				const opts = goalsStep && goalsStep.type === "goals" ? goalsStep.question.options : [];
				const selectedGoals = (answers.goals ?? [])
					.map((v) => opts.find((o) => o.value === v))
					.filter((o): o is NonNullable<typeof o> => Boolean(o))
					.map((o) => ({ label: o.label, icon: o.icon }));
				return <TransitionStep goals={selectedGoals} onContinue={goNext} />;
			}
			case "quiz-intro":
				return <QuizIntroStep config={currentStep} onContinue={goNext} />;
			case "fact":
				return <FactStep config={currentStep} onContinue={goNext} />;
			case "personality": {
				const qId = currentStep.question.id;
				return (
					<PersonalityStep
						question={currentStep.question}
						selected={answers.personality?.[qId]}
						onAnswer={(value) => {
							setAnswers((prev) => ({
								...prev,
								personality: { ...(prev.personality ?? {}), [qId]: value },
							}));
							goNext();
						}}
					/>
				);
			}
			case "complete":
				return <CompleteStep config={currentStep} />;
			case "result":
				return <ResultStep answers={answers.personality} onContinue={goNext} />;
			case "reveal":
				return <RevealStep config={currentStep} onContinue={goNext} />;
			case "meet":
				return <MeetStep config={currentStep} onDone={goNext} />;
			case "choose-color":
				return <ColorStep onContinue={goNext} />;
			case "name-sidekick":
				return <NameSidekickStep onContinue={goNext} />;
			case "onboarding-chat":
				return <OnboardingChat onDone={() => (window.location.href = "/home2")} />;
			default:
				return null;
		}
	}
}
