import Image from "next/image";
import posthog from "posthog-js";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { LuChevronLeft } from "react-icons/lu";
import { api } from "~/utils/trpc";
import { AgreementStep } from "./agreement-step";
import { captureFunnelEvent, captureStepEvent, type FunnelContext } from "./analytics";
import { AuthStep } from "./auth-step";
import { DEFAULT_PAYWALL_VARIANT } from "./constants";
import { InterstitialStep } from "./interstitial-step";
import { LandingStep } from "./landing-step";
import { LoadingStep } from "./loading-step";
import { FUNNEL_MANIFESTS, resolveAssignment } from "./manifest";
import { MultiSelectStep } from "./multi-select-step";
import { PaywallStep } from "./paywall-step";
import { ProgressBar } from "./progress-bar";
import { QuizStep } from "./quiz-step";
import { ResultsStep } from "./results-step";
import { SuccessStep } from "./success-step";
import { trackPixelEvent } from "./meta-pixel";
import { getFunnelSession, setFunnelSession } from "~/utils/funnel-session";
import type { FunnelAnswers, FunnelAssignment, FunnelTrackingProps, PaywallVariant } from "./types";

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

function asStringArray(value: string | string[] | undefined): string[] {
	if (Array.isArray(value)) {
		return value;
	}
	return value ? [value] : [];
}

// The card animates its height between steps. For steps taller than the
// available area (the paywall), animating toward the full content height
// overshoots the visible cap, so the transition races through its first
// frames and the card snaps. Clamping the target to the available height
// keeps the grow smooth across the full duration; taller content scrolls.
function clampHeight(content: number, available: number): number {
	if (content <= 0) {
		return 0;
	}
	if (available <= 0) {
		return content;
	}
	return Math.min(content, available);
}

type PaymentSetup = { clientSecret: string; customerId: string; userId: string };

export function Funnel({ tracking }: { tracking: FunnelTrackingProps }) {
	const [currentStepIndex, goToStep] = useStepParam();
	const [answers, setAnswers] = useState<FunnelAnswers>({});
	const [contentHeight, setContentHeight] = useState(0);
	const [availableHeight, setAvailableHeight] = useState(0);
	const contentRef = useRef<HTMLDivElement>(null);
	const mainRef = useRef<HTMLElement>(null);
	const [paymentUserId, setPaymentUserId] = useState<string | null>(null);
	const [paymentVariant, setPaymentVariant] = useState<PaywallVariant>(DEFAULT_PAYWALL_VARIANT);
	const [paymentSetupPromise, setPaymentSetupPromise] = useState<Promise<PaymentSetup> | null>(
		null,
	);

	const { mutate: trackFunnelEvent } = api.funnel.trackEvent.useMutation();
	const { mutateAsync: linkAttribution } = api.funnel.linkAttribution.useMutation();
	const { mutateAsync: createAnonymousUser } = api.auth.anonymous.useMutation();
	const { mutateAsync: createSetupIntent } = api.stripe.createSetupIntent.useMutation();

	// Mint a throwaway account so the user can pay before creating a real login.
	// When they authenticate after paying, the backend merges this user (and its
	// subscription) into their real account. Idempotent across back/forward nav.
	const ensurePaymentUser = async () => {
		if (paymentUserId) {
			return paymentUserId;
		}
		const result = await createAnonymousUser();
		setFunnelSession({ userId: result.userId });
		setPaymentUserId(result.userId);
		// Stitch the anonymous browser session to the anon payment user so the
		// pre-auth funnel events collapse onto the same PostHog person once
		// identifyOnce(realUserId) runs after the post-paywall sign-in.
		posthog.alias(result.userId);
		// Persist the click identifiers onto the anon payer before they pay, so the
		// trial-start RevenueCat webhook and the 1h retention cron route as website
		// CAPI conversions. The post-paywall merge carries this onto the real account.
		await linkAttribution({
			userId: result.userId,
			fbc: tracking.fbc,
			fbp: tracking.fbp,
		});
		return result.userId;
	};

	// Mint the payment user + Stripe setup intent ahead of the paywall (kicked off
	// at the results reveal) so the checkout button is interactive the instant the
	// paywall mounts instead of showing a skeleton while the network round-trips.
	// Deduped on the in-flight promise so the reveal pre-warm and the paywall's own
	// call share one setup intent.
	const preparePayment = (): Promise<PaymentSetup> => {
		if (paymentSetupPromise) {
			return paymentSetupPromise;
		}
		const promise = ensurePaymentUser().then(async (uid) => {
			const result = await createSetupIntent({ userId: uid });
			return { clientSecret: result.clientSecret, customerId: result.customerId, userId: uid };
		});
		// Drop a failed setup from the cache so the paywall can retry instead of
		// inheriting the rejection; also marks the promise handled for the pre-warm
		// caller, which fires it fire-and-forget.
		void promise.catch(() => setPaymentSetupPromise(null));
		setPaymentSetupPromise(promise);
		return promise;
	};

	const trackConversion = (
		eventName: "Lead" | "CompleteRegistration" | "InitiateCheckout" | "Purchase",
		extra?: {
			email?: string;
			userId?: string;
			value?: number;
			currency?: string;
			pixelParams?: Record<string, unknown>;
		},
	) => {
		const eventId = trackPixelEvent(eventName, extra?.pixelParams);
		trackFunnelEvent({
			eventName,
			eventId,
			fbc: tracking.fbc,
			fbp: tracking.fbp,
			email: extra?.email,
			userId: extra?.userId,
			value: extra?.value,
			currency: extra?.currency,
			// The API is a separate origin, so the Referer header arrives path-stripped;
			// send the real page URL so Meta's event_source_url stays accurate per funnel.
			sourceUrl: window.location.origin + window.location.pathname,
		});
	};

	// Restore the payment/session identity (set before the paywall, and swapped
	// for the real account by the Google callback) after a refresh or redirect.
	useEffect(() => {
		const session = getFunnelSession();
		if (session?.userId) {
			setPaymentUserId(session.userId);
		}

		const params = new URLSearchParams(window.location.search);
		const encodedAnswers = params.get("answers");
		if (encodedAnswers) {
			const url = new URL(window.location.href);
			url.searchParams.delete("answers");
			window.history.replaceState({}, "", url.toString());
			try {
				const decoded = JSON.parse(atob(encodedAnswers)) as FunnelAnswers;
				setAnswers(decoded);
			} catch {
				// ignore invalid answers
			}
		}
	}, []);

	// Resolve the experiment arms once, pin them to the session, and stamp them on
	// every event so the variant can't drift across the post-paywall auth redirect.
	const [assignment] = useState<FunnelAssignment>(() =>
		resolveAssignment(getFunnelSession()?.assignment ?? null),
	);
	useEffect(() => {
		setFunnelSession({ assignment });
	}, [assignment]);

	const manifest = FUNNEL_MANIFESTS[assignment.variant];
	const paywallVariant = assignment.paywallVariant;
	const ctx = useMemo<FunnelContext>(
		() => ({ manifest, paywallVariant }),
		[manifest, paywallVariant],
	);
	const steps = manifest.steps;
	const safeIndex = Math.min(currentStepIndex, steps.length - 1);
	const currentStep = steps[safeIndex];
	const persona = answers.persona;
	// The landing and paywall both render full-bleed (no quiz card, no progress
	// bar) — the opening hook and the closing offer each own the whole screen.
	const isLanding = currentStep?.type === "landing";
	const isPaywall = currentStep?.type === "paywall";
	const hideProgressBar = isLanding || isPaywall || currentStep?.type === "success";
	const showBackButton =
		safeIndex > 0 &&
		currentStep?.type !== "paywall" &&
		currentStep?.type !== "success" &&
		currentStep?.type !== "loading";
	const showContinueButton =
		currentStep?.type === "interstitial" || currentStep?.type === "results";

	const goToNextStep = () => goToStep(Math.min(safeIndex + 1, steps.length - 1));
	const goToPrevStep = () => goToStep(Math.max(safeIndex - 1, 0));

	const trackStepCompleted = (extra?: Record<string, unknown>) => {
		if (!currentStep) {
			return;
		}
		captureStepEvent("funnel_step_completed", ctx, currentStep, safeIndex, { persona, ...extra });
	};

	useEffect(() => {
		if (safeIndex === 0 && currentStep) {
			captureFunnelEvent("funnel_started", ctx);
		}
	}, []); // eslint-disable-line react-hooks/exhaustive-deps

	useEffect(() => {
		if (!currentStep) {
			return;
		}
		if (currentStep.type === "results") {
			trackConversion("Lead");
			void preparePayment();
		}
		if (currentStep.type === "paywall") {
			trackConversion("InitiateCheckout", {
				userId: paymentUserId ?? undefined,
			});
		}
	}, [safeIndex]); // eslint-disable-line react-hooks/exhaustive-deps

	useLayoutEffect(() => {
		const el = contentRef.current;
		if (!el) {
			return;
		}
		const observer = new ResizeObserver((entries) => {
			const entry = entries[0];
			if (entry) {
				setContentHeight(entry.contentRect.height);
			}
		});
		observer.observe(el);
		return () => observer.disconnect();
	}, []);

	useLayoutEffect(() => {
		const el = mainRef.current;
		if (!el) {
			return;
		}
		const measure = () => {
			const style = getComputedStyle(el);
			const padding = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
			setAvailableHeight(el.clientHeight - padding);
		};
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(el);
		return () => observer.disconnect();
	}, []);

	const handleAnswer = (stepId: string, value: string) => {
		setAnswers((prev) => ({ ...prev, [stepId]: value }));
		trackStepCompleted({ answer: value });
		goToNextStep();
	};

	const handleMultiAnswer = (stepId: string, values: string[]) => {
		setAnswers((prev) => ({ ...prev, [stepId]: values }));
		trackStepCompleted({ answer: values });
		goToNextStep();
	};

	const handleContinue = () => {
		trackStepCompleted();
		goToNextStep();
	};

	const handleLandingStart = (response: string) => {
		trackStepCompleted({ answer: response });
		goToNextStep();
	};

	const handleAuth = (data: { userId: string; email: string }) => {
		// The backend has merged the paid anonymous user (and its subscription) into
		// data.userId and swapped the auth_token cookie to the real session; persist
		// the real userId for the client to read.
		setFunnelSession({ userId: data.userId });

		trackConversion("CompleteRegistration", {
			email: data.email || undefined,
			userId: data.userId,
		});

		void linkAttribution({
			userId: data.userId,
			fbc: tracking.fbc,
			fbp: tracking.fbp,
		});

		captureFunnelEvent("funnel_auth_completed", ctx, { step_index: safeIndex });
		goToNextStep();
	};

	const handlePaymentSuccess = (meta: { variant: PaywallVariant; amountCents: number }) => {
		setPaymentVariant(meta.variant);
		const isTrial = meta.variant === "trial";
		const value = isTrial ? 0 : meta.amountCents / 100;

		// Trial/subscribe money events are now authoritative from the RevenueCat
		// webhook (keyed on the merged account's persisted attribution), so the web
		// paywall no longer fires StartTrial. A non-trial purchase still fires
		// Purchase to match the browser pixel and dedupe server-side via event_id.
		if (!isTrial) {
			trackConversion("Purchase", {
				userId: paymentUserId ?? undefined,
				value,
				currency: "USD",
				pixelParams: { value, currency: "USD" },
			});
		}

		captureFunnelEvent("funnel_payment_completed", ctx, { persona, value, answers });
		goToNextStep();
	};

	const displayHeight = clampHeight(contentHeight, availableHeight);

	if (!currentStep) {
		return null;
	}

	return (
		<div
			className={`h-[100svh] flex flex-col overflow-hidden ${
				isPaywall ? "bg-white" : "bg-gradient-to-t from-orange-200 to-white"
			}`}
		>
			<div className="shrink-0 pt-3 z-30">
				<div className="max-w-md mx-auto w-full">
					<div className="flex items-center px-5 pb-1">
						<button
							onClick={goToPrevStep}
							className={`w-8 h-8 flex items-center justify-center rounded-full text-stone-400 hover:text-stone-900 hover:bg-stone-200/50 transition ${
								showBackButton ? "" : "invisible"
							}`}
						>
							<LuChevronLeft className="w-5 h-5" />
						</button>
						<div className="flex-1 flex items-center justify-center gap-2">
							<Image src="/logo.png" alt="Relic" width={24} height={24} className="rounded-md" />
							<span className="text-base font-bold tracking-tight text-stone-900">Relic</span>
						</div>
						<div className="w-8" />
					</div>
					{!hideProgressBar ? (
						<div className="px-5 pb-1 pt-1">
							<ProgressBar current={safeIndex} total={steps.length} />
						</div>
					) : null}
				</div>
			</div>

			<main
				ref={mainRef}
				className={`flex-1 flex flex-col min-h-0 ${isPaywall || isLanding ? "" : "justify-end px-3 pb-6"}`}
			>
				{isLanding ? (
					<LandingStep onStart={handleLandingStart} />
				) : (
					<div className={`max-w-md mx-auto w-full ${isPaywall ? "h-full" : "max-h-full"}`}>
						<div
							className={`bg-white overflow-x-hidden overflow-y-auto overscroll-y-contain ${
								isPaywall
									? "h-full"
									: "rounded-[28px] max-h-full transition-[height,opacity,transform] duration-300 ease-out"
							}`}
							style={!isPaywall && displayHeight > 0 ? { height: displayHeight } : undefined}
						>
							<div ref={contentRef}>
								<div key={currentStep.id} className="animate-fade-up">
									{renderStepBody()}

									{showContinueButton ? (
										<div className="sticky bottom-0 bg-white rounded-b-[28px] px-6 pb-7 pt-3">
											<button
												onClick={handleContinue}
												className="w-full py-4 bg-stone-900 hover:bg-stone-800 active:bg-stone-700 text-white text-base font-medium rounded-2xl transition-colors"
											>
												Continue
											</button>
										</div>
									) : null}
								</div>
							</div>
						</div>
					</div>
				)}
			</main>
		</div>
	);

	function renderStepBody() {
		if (!currentStep) {
			return null;
		}
		switch (currentStep.type) {
			case "quiz":
				return (
					<QuizStep
						question={currentStep.question}
						onAnswer={(value) => handleAnswer(currentStep.id, value)}
					/>
				);
			case "multi-select":
				return (
					<MultiSelectStep
						question={currentStep.question}
						initial={asStringArray(answers[currentStep.id])}
						onAnswer={(values) => handleMultiAnswer(currentStep.id, values)}
					/>
				);
			case "agreement":
				return (
					<AgreementStep
						config={currentStep.agreement}
						answers={answers}
						onAnswer={(value) => handleAnswer(currentStep.id, value)}
					/>
				);
			case "interstitial":
				return <InterstitialStep config={currentStep.interstitial} answers={answers} />;
			case "loading":
				return <LoadingStep onComplete={handleContinue} context={ctx} />;
			case "results":
				return <ResultsStep answers={answers} />;
			case "auth":
				return <AuthStep onAuthenticated={handleAuth} stepIndex={safeIndex} answers={answers} />;
			case "paywall":
				return (
					<PaywallStep
						prepare={preparePayment}
						variant={paywallVariant}
						onSuccess={handlePaymentSuccess}
						context={ctx}
					/>
				);
			case "success":
				return <SuccessStep variant={paymentVariant} context={ctx} />;
			default:
				return null;
		}
	}
}
