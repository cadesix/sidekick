import { useEffect, useMemo, useState } from "react";
import { LuCheck, LuLock } from "react-icons/lu";
import { api } from "~/utils/trpc";
import { captureFunnelEvent, type FunnelContext } from "./analytics";
import {
	type AppliedCoupon,
	APP_STORE_URL,
	type PlanDefinition,
	type PlanId,
	toPlanDefinition,
	TRIAL_DAYS,
} from "./constants";
import { type PlanDisplay, planDisplay } from "./pricing";
import { PromoCodeInput } from "./promo-code-input";
import { useCountdown } from "./use-countdown";
import type { PaywallVariant } from "./types";

// NOTE: This is the LOCAL MOCK paywall. The production version wired Stripe Elements
// (card + Apple/Google Pay) against a real SetupIntent. Here the payment surface is
// replaced with a mock CTA + a dummy card sheet that simply resolves the funnel.
// The pricing, plan selector, promo code, and trial timeline are all the real UI.

// The three reassurance points shown under the hero — kept short and scannable to
// match the app's own paywall. Variant-aware so the no-trial flow never promises
// "no payment required".
function benefits(variant: PaywallVariant): string[] {
	return variant === "trial"
		? ["No Payment Required", "Unlimited antique scans", "Cancel any time"]
		: ["7-day money-back guarantee", "Unlimited antique scans", "Cancel any time"];
}

function timer(minutes: number, seconds: number): string {
	return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function PaywallStep({
	prepare,
	variant,
	onSuccess,
	context,
}: {
	prepare: () => Promise<{ clientSecret: string; customerId: string; userId: string }>;
	variant: PaywallVariant;
	onSuccess: (meta: { variant: PaywallVariant; amountCents: number }) => void;
	context: FunnelContext;
}) {
	const [selectedPlanId, setSelectedPlanId] = useState<PlanId>("annual");
	const [appliedCoupon, setAppliedCoupon] = useState<AppliedCoupon | null>(null);
	const [ready, setReady] = useState(false);

	// Amounts are read from the live Stripe prices so the funnel can never show a
	// price we don't charge. (Locally these come from the mock api.)
	const pricingQuery = api.stripe.getPaywallPricing.useQuery();
	const plans = useMemo<PlanDefinition[]>(
		() => (pricingQuery.data ?? []).map(toPlanDefinition),
		[pricingQuery.data],
	);
	const selectedPlan = plans.find((plan) => plan.id === selectedPlanId) ?? null;
	const display = selectedPlan ? planDisplay(selectedPlan, appliedCoupon) : null;
	const isTrial = variant === "trial";

	useEffect(() => {
		captureFunnelEvent("funnel_paywall_shown", context);
	}, [context]);

	// Preserve the source flow: await the payment setup prepared at the results
	// reveal (mocked here), then mark the checkout interactive.
	useEffect(() => {
		let cancelled = false;
		prepare()
			.then(() => {
				if (!cancelled) {
					setReady(true);
					captureFunnelEvent("funnel_checkout_ready", context);
				}
			})
			.catch(() => {
				if (!cancelled) {
					setReady(true);
				}
			});
		return () => {
			cancelled = true;
		};
	}, []); // eslint-disable-line react-hooks/exhaustive-deps

	return (
		<>
			<div className="px-6 pt-6 pb-64">
				<h2 className="text-center font-serif text-[44px] leading-[1.04] tracking-[-0.01em] text-stone-900">
					{isTrial ? (
						<>
							We want you to
							<br />
							try Relic for free.
						</>
					) : (
						"Unlock Relic Pro."
					)}
				</h2>

				<div className="mt-7 flex flex-col items-center gap-3">
					{benefits(variant).map((benefit) => (
						<div key={benefit} className="flex items-center gap-2.5">
							<LuCheck className="w-5 h-5 text-green-600 shrink-0" strokeWidth={2.5} />
							<span className="text-[18px] font-semibold text-stone-800">{benefit}</span>
						</div>
					))}
				</div>

				<div className="mt-7">
					<PlanSelector
						plans={plans}
						selectedPlanId={selectedPlanId}
						onSelect={(id) => {
							setSelectedPlanId(id);
							captureFunnelEvent("funnel_plan_selected", context, { plan: id });
						}}
						coupon={appliedCoupon}
					/>
				</div>

				{isTrial ? (
					<div className="mt-6">
						<TrialTimeline />
					</div>
				) : null}

				<div className="mt-6">
					<PromoCodeInput
						appliedCoupon={appliedCoupon}
						onApply={(coupon) => {
							setAppliedCoupon(coupon);
							captureFunnelEvent("funnel_promo_applied", context, { code: coupon.code });
						}}
						onClear={() => {
							setAppliedCoupon(null);
							captureFunnelEvent("funnel_promo_cleared", context);
						}}
					/>
				</div>
			</div>

			{ready && selectedPlan && display ? (
				<MockCheckoutFooter
					variant={variant}
					plan={selectedPlan}
					display={display}
					onSuccess={onSuccess}
					context={context}
				/>
			) : (
				<FooterShell>
					<div className="h-12 rounded-xl bg-stone-200 animate-pulse" />
				</FooterShell>
			)}
		</>
	);
}

function CountdownBar() {
	const { minutes, seconds } = useCountdown();

	return (
		<div className="rounded-xl bg-gradient-to-r from-red-500 to-orange-500 px-4 py-2.5 flex items-center justify-center gap-2">
			<span className="relative flex h-2 w-2 shrink-0">
				<span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75" />
				<span className="relative inline-flex rounded-full h-2 w-2 bg-white" />
			</span>
			<span className="text-[13px] font-semibold text-white">
				Offer expires in <span className="font-bold tabular-nums">{timer(minutes, seconds)}</span>
			</span>
		</div>
	);
}

function PlanSelector({
	plans,
	selectedPlanId,
	onSelect,
	coupon,
}: {
	plans: PlanDefinition[];
	selectedPlanId: PlanId;
	onSelect: (id: PlanId) => void;
	coupon: AppliedCoupon | null;
}) {
	if (plans.length === 0) {
		return (
			<div className="space-y-2.5">
				<div className="h-[72px] rounded-2xl bg-stone-200 animate-pulse" />
				<div className="h-[72px] rounded-2xl bg-stone-200 animate-pulse" />
			</div>
		);
	}

	return (
		<div className="space-y-2.5">
			{plans.map((plan) => {
				const d = planDisplay(plan, coupon);
				return (
					<PlanCard
						key={plan.id}
						selected={selectedPlanId === plan.id}
						onSelect={() => onSelect(plan.id)}
						display={d}
						badge={plan.id === "annual" ? "Best value" : undefined}
					/>
				);
			})}
		</div>
	);
}

function PlanCard({
	selected,
	onSelect,
	display,
	badge,
}: {
	selected: boolean;
	onSelect: () => void;
	display: PlanDisplay;
	badge?: string;
}) {
	return (
		<button
			onClick={onSelect}
			className={`relative w-full flex items-center gap-3 text-left px-4 py-3.5 rounded-2xl border transition-all duration-150 ${
				selected
					? "border-amber-400 bg-amber-50 ring-1 ring-amber-300"
					: "border-stone-200 bg-white hover:bg-stone-50"
			}`}
		>
			<span
				className={`w-5 h-5 rounded-full border-2 shrink-0 flex items-center justify-center ${
					selected ? "border-amber-500 bg-amber-500" : "border-stone-300"
				}`}
			>
				{selected ? <LuCheck className="w-3 h-3 text-white" strokeWidth={3} /> : null}
			</span>
			<div className="flex-1 min-w-0">
				<div className="flex items-center gap-2">
					<span className="text-sm font-semibold text-stone-900">{display.title}</span>
					{badge ? (
						<span className="text-[11px] font-semibold text-green-700 bg-green-100 px-1.5 py-0.5 rounded-full">
							{badge}
						</span>
					) : null}
				</div>
				<p className="text-xs text-stone-500 mt-0.5">
					<span className="line-through">{display.regularLabel}</span>{" "}
					<span className="font-medium text-stone-700">{display.nowLabel}</span>{" "}
					{display.intervalLabel}
				</p>
			</div>
			<div className="text-right shrink-0">
				<p className="text-base font-semibold text-stone-900">{display.perWeekLabel}</p>
				{display.discountPct > 0 ? (
					<p className="text-[11px] font-semibold text-green-700">Save {display.discountPct}%</p>
				) : null}
			</div>
		</button>
	);
}

function TrialTimeline() {
	const reminderDay = Math.max(TRIAL_DAYS - 1, 1);
	const rows = [
		{ label: "Today", detail: "Full access unlocks instantly" },
		{ label: `Day ${reminderDay}`, detail: "We email a reminder before billing" },
		{ label: `Day ${TRIAL_DAYS}`, detail: "Your subscription begins, cancel anytime" },
	];

	return (
		<div className="bg-stone-50 border border-stone-200 rounded-xl p-4 space-y-3">
			{rows.map((row, i) => (
				<div key={row.label} className="flex items-center gap-3">
					<div
						className={`w-2.5 h-2.5 rounded-full shrink-0 ${i === 0 ? "bg-amber-500" : "bg-stone-300"}`}
					/>
					<span className="text-sm font-medium text-stone-900 w-16 shrink-0">{row.label}</span>
					<span className="text-sm text-stone-500">{row.detail}</span>
				</div>
			))}
		</div>
	);
}

/** The sticky bottom checkout bar. */
function FooterShell({ children }: { children: React.ReactNode }) {
	return (
		<div className="sticky bottom-0 left-0 right-0 bg-white/95 backdrop-blur-sm border-t border-stone-200 px-6 pt-3 pb-7 shadow-[0_-4px_16px_rgba(0,0,0,0.06)]">
			{children}
		</div>
	);
}

// --- Mock checkout (replaces the Stripe Elements footer) -----------------------

function MockCheckoutFooter({
	variant,
	plan,
	display,
	onSuccess,
	context,
}: {
	variant: PaywallVariant;
	plan: PlanDefinition;
	display: PlanDisplay;
	onSuccess: (meta: { variant: PaywallVariant; amountCents: number }) => void;
	context: FunnelContext;
}) {
	const [showCardForm, setShowCardForm] = useState(false);
	const [isProcessing, setIsProcessing] = useState(false);

	const isTrial = variant === "trial";
	const ctaLabel = isTrial ? "Try For Free" : "Get Relic Pro";
	const intervalNoun = plan.interval === "year" ? "yr" : "mo";
	const summary = isTrial
		? `$0.00 today · then ${display.nowLabel}/${intervalNoun} · cancel anytime`
		: `${display.nowLabel} today · then ${display.nowLabel}/${intervalNoun} · cancel anytime`;

	const complete = (method: "express" | "card") => {
		captureFunnelEvent("funnel_payment_method_selected", context, { method });
		setIsProcessing(true);
		// Simulate the confirm round-trip, then resolve the funnel.
		window.setTimeout(() => {
			onSuccess({ variant, amountCents: display.nowCents });
		}, 450);
	};

	return (
		<FooterShell>
			<div className="mb-2.5">
				<CountdownBar />
			</div>

			{/* Mock "wallet" primary action (stands in for Apple/Google Pay). */}
			<button
				type="button"
				disabled={isProcessing}
				onClick={() => complete("express")}
				className="w-full py-4 bg-stone-900 hover:bg-stone-800 active:bg-stone-700 text-white text-base font-medium rounded-xl transition-colors disabled:opacity-50"
			>
				{isProcessing ? "Processing…" : ctaLabel}
			</button>

			<button
				type="button"
				onClick={() => setShowCardForm(true)}
				className="mt-2 w-full text-center text-sm text-stone-500 hover:text-stone-800 transition-colors"
			>
				Or pay with card
			</button>

			<p className="mt-3 text-center text-[11px] text-stone-400">{summary}</p>

			<div className="flex items-center justify-center gap-1.5 mt-2 text-xs text-stone-400">
				<LuLock className="w-3 h-3" />
				<span>Secured by Stripe</span>
			</div>

			<div className="mt-3 flex items-center justify-center gap-2 text-[11px] text-stone-400">
				<a
					href="https://sans.software/relic/privacy"
					target="_blank"
					rel="noopener noreferrer"
					className="underline hover:text-stone-600"
				>
					Privacy Policy
				</a>
				<span className="text-stone-300">•</span>
				<a
					href={APP_STORE_URL}
					target="_blank"
					rel="noopener noreferrer"
					className="underline hover:text-stone-600"
				>
					Restore Purchase
				</a>
				<span className="text-stone-300">•</span>
				<a
					href="https://www.apple.com/legal/internet-services/itunes/dev/stdeula/"
					target="_blank"
					rel="noopener noreferrer"
					className="underline hover:text-stone-600"
				>
					Terms of Use
				</a>
			</div>

			{showCardForm ? (
				<MockCardSheet
					summary={summary}
					submitLabel={isTrial ? ctaLabel : `${ctaLabel} · ${display.nowLabel}`}
					isProcessing={isProcessing}
					onClose={() => {
						if (!isProcessing) {
							setShowCardForm(false);
						}
					}}
					onSubmit={() => complete("card")}
				/>
			) : null}
		</FooterShell>
	);
}

/** Lightweight bottom-sheet with dummy card fields (no Stripe, no Radix). */
function MockCardSheet({
	summary,
	submitLabel,
	isProcessing,
	onClose,
	onSubmit,
}: {
	summary: string;
	submitLabel: string;
	isProcessing: boolean;
	onClose: () => void;
	onSubmit: () => void;
}) {
	return (
		<div className="fixed inset-0 z-50 flex items-end justify-center">
			<button
				type="button"
				aria-label="Close"
				onClick={onClose}
				className="absolute inset-0 bg-black/40"
			/>
			<div className="relative w-full max-w-md mx-auto bg-white rounded-t-3xl max-h-[88vh] flex flex-col overflow-hidden border border-stone-200 animate-fade-in-up">
				<div className="px-5 pt-5 pb-3 border-b border-stone-200 text-left space-y-1">
					<h3 className="text-base font-semibold text-stone-900">Pay with card</h3>
					<p className="text-xs text-stone-400">{summary}</p>
				</div>

				<form
					onSubmit={(e) => {
						e.preventDefault();
						onSubmit();
					}}
					className="flex-1 flex flex-col min-h-0"
				>
					<div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
						<input
							type="email"
							placeholder="your@email.com"
							className="w-full px-4 py-3.5 rounded-xl border border-stone-300 bg-white text-base text-stone-900 placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-stone-800 focus:border-transparent"
						/>
						<input
							inputMode="numeric"
							placeholder="Card number"
							className="w-full px-4 py-3.5 rounded-xl border border-stone-300 bg-white text-base text-stone-900 placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-stone-800 focus:border-transparent"
						/>
						<div className="flex gap-3">
							<input
								inputMode="numeric"
								placeholder="MM / YY"
								className="flex-1 min-w-0 px-4 py-3.5 rounded-xl border border-stone-300 bg-white text-base text-stone-900 placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-stone-800 focus:border-transparent"
							/>
							<input
								inputMode="numeric"
								placeholder="CVC"
								className="flex-1 min-w-0 px-4 py-3.5 rounded-xl border border-stone-300 bg-white text-base text-stone-900 placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-stone-800 focus:border-transparent"
							/>
						</div>
					</div>

					<div className="px-5 pt-3 pb-7 border-t border-stone-200 bg-white">
						<button
							type="submit"
							disabled={isProcessing}
							className="w-full py-4 bg-stone-900 hover:bg-stone-800 active:bg-stone-700 text-white text-base font-medium rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
						>
							{isProcessing ? "Processing…" : submitLabel}
						</button>
						<div className="flex items-center justify-center gap-1.5 mt-2.5 text-xs text-stone-400">
							<LuLock className="w-3 h-3" />
							<span>Secured by Stripe</span>
						</div>
					</div>
				</form>
			</div>
		</div>
	);
}
