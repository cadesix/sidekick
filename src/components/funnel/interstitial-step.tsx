import Image from "next/image";
import { useEffect, useState } from "react";
import { LuCamera, LuCheck, LuFileText, LuScanLine } from "react-icons/lu";
import { ILLUSTRATIONS } from "./illustrations";
import {
	PERSONA_CLOSING_TESTIMONIAL,
	PERSONA_TESTIMONIAL,
	PERSONA_WORD,
	resolvePersona,
} from "./persona";
import { RatingBar } from "./rating-bar";
import { TestimonialCard } from "./testimonial-card";
import type { FunnelAnswers, InterstitialConfig } from "./types";

export function InterstitialStep({
	config,
	answers,
}: {
	config: InterstitialConfig;
	answers: FunnelAnswers;
}) {
	const illustrationOnTop = config.illustrationPosition === "top";
	const centered = config.align === "center";
	const illustration = config.illustration ? (
		<Image
			src={config.illustration.src}
			alt={config.illustration.alt}
			width={config.illustration.width}
			height={config.illustration.height}
			priority
			unoptimized
			className="h-56 w-auto mx-auto mb-4 animate-fade-in"
		/>
	) : null;

	return (
		<div className="flex flex-col max-h-full">
			<div className="overflow-y-auto min-h-0 px-6 pt-7 pb-2">
				{illustrationOnTop ? illustration : null}
				<h2
					className={`whitespace-pre-line text-[24px] font-bold leading-tight tracking-[-0.02em] text-stone-900 mb-1.5 ${
						centered ? "text-center" : ""
					}`}
				>
					{config.title}
				</h2>
				{config.subtitle ? (
					<p
						className={`text-[14px] leading-relaxed text-stone-500 mb-4 ${
							centered ? "text-center" : ""
						}`}
					>
						{config.subtitle}
					</p>
				) : (
					<div className="mb-3" />
				)}
				{illustrationOnTop ? null : illustration}
				<InterstitialGraphic config={config} answers={answers} />
			</div>
		</div>
	);
}

function InterstitialGraphic({
	config,
	answers,
}: {
	config: InterstitialConfig;
	answers: FunnelAnswers;
}) {
	switch (config.kind) {
		case "authority":
			return <AuthorityGraphic />;
		case "micro-education":
			return <MicroEducationGraphic body={config.body} />;
		case "social-proof":
			return <SocialProofGraphic answers={answers} />;
		case "how-it-works":
			return <HowItWorksGraphic />;
		case "pre-paywall":
			return <PrePaywallGraphic answers={answers} />;
		default:
			return null;
	}
}

function AuthorityGraphic() {
	return (
		<div className="bg-white border border-stone-200 rounded-xl p-4 space-y-2.5">
			<div
				className="flex items-center justify-between animate-fade-in"
				style={{ animationDelay: "300ms" }}
			>
				<span className="text-sm text-stone-500">Seller&rsquo;s asking price</span>
				<span className="text-base text-stone-400 line-through tabular-nums">$1,200</span>
			</div>
			<div
				className="flex items-center justify-between animate-fade-in"
				style={{ animationDelay: "900ms" }}
			>
				<span className="text-sm font-medium text-stone-900">What buyers actually paid</span>
				<span className="text-base font-bold text-green-700 tabular-nums">$640</span>
			</div>
		</div>
	);
}

function MicroEducationGraphic({ body }: { body?: string }) {
	if (!body) {
		return null;
	}
	return <p className="text-[16px] leading-relaxed text-stone-800">{body}</p>;
}

const PEER_COUNT = "1,200+";

function SocialProofGraphic({ answers }: { answers: FunnelAnswers }) {
	const persona = resolvePersona(answers.persona);
	return (
		<div className="space-y-3">
			<div className="bg-white border border-stone-200 rounded-xl p-5 text-center">
				<p className="text-3xl font-bold tracking-tight text-stone-900">{PEER_COUNT}</p>
				<p className="text-sm text-stone-500 mt-1">
					{PERSONA_WORD[persona]} valued a find with Relic this week
				</p>
			</div>
			<div className="animate-fade-in" style={{ animationDelay: "250ms" }}>
				<TestimonialCard testimonial={PERSONA_TESTIMONIAL[persona]} />
			</div>
			<div className="animate-fade-in" style={{ animationDelay: "500ms" }}>
				<RatingBar vertical />
			</div>
		</div>
	);
}

const PIPELINE_STEPS = [
	{ icon: LuCamera, label: "Snap a photo" },
	{ icon: LuScanLine, label: "AI identifies maker, era & origin" },
	{ icon: LuFileText, label: "Value range from real sold prices" },
];

function HowItWorksGraphic() {
	const [active, setActive] = useState(-1);

	useEffect(() => {
		const timers = PIPELINE_STEPS.map((_, i) => setTimeout(() => setActive(i), 400 + i * 600));
		timers.push(
			setTimeout(() => setActive(PIPELINE_STEPS.length), 600 + PIPELINE_STEPS.length * 600),
		);
		return () => timers.forEach(clearTimeout);
	}, []);

	const showExample = active >= PIPELINE_STEPS.length;

	return (
		<div className="space-y-3">
			<div className="bg-white border border-stone-200 rounded-xl p-5 space-y-3">
				{PIPELINE_STEPS.map((step, i) => {
					const Icon = step.icon;
					const isActive = active >= i;
					return (
						<div
							key={step.label}
							className="flex items-center gap-3 transition-opacity duration-300"
							style={{ opacity: isActive ? 1 : 0.35 }}
						>
							<div
								className={`w-11 h-11 rounded-full flex items-center justify-center shrink-0 transition-all duration-300 ${
									isActive ? "bg-stone-900 text-white" : "bg-stone-100 text-stone-400"
								}`}
							>
								<Icon className="w-5 h-5" />
							</div>
							<span className="text-sm font-medium text-stone-800">{step.label}</span>
						</div>
					);
				})}
			</div>

			<div
				className="relative bg-white border border-stone-200 rounded-xl p-4 flex items-center gap-4 transition-all duration-500"
				style={{
					opacity: showExample ? 1 : 0,
					transform: showExample ? "translateY(0)" : "translateY(12px)",
				}}
			>
				<span className="absolute top-2.5 right-3 text-[10px] font-semibold text-stone-300 uppercase tracking-wide">
					Example
				</span>
				<Image
					src={ILLUSTRATIONS.blueVase.src}
					alt={ILLUSTRATIONS.blueVase.alt}
					width={ILLUSTRATIONS.blueVase.width}
					height={ILLUSTRATIONS.blueVase.height}
					unoptimized
					className="h-16 w-auto shrink-0"
				/>
				<div className="min-w-0">
					<p className="text-sm font-semibold text-stone-900">Blue & white export vase</p>
					<p className="text-xs text-stone-500 mt-0.5">Porcelain · late 19th century</p>
					<p className="text-sm font-bold text-green-700 mt-1.5 tabular-nums">Est. $480 – $720</p>
				</div>
			</div>
		</div>
	);
}

const SCAN_NOTIFICATIONS = [
	{ label: "New scan: Mid-century ceramic vase — $450", time: "just now" },
	{ label: "New scan: Victorian sterling brooch — $135", time: "2 min ago" },
];

function PrePaywallGraphic({ answers }: { answers: FunnelAnswers }) {
	const persona = resolvePersona(answers.persona);
	const [visibleCount, setVisibleCount] = useState(0);

	useEffect(() => {
		const timers = SCAN_NOTIFICATIONS.map((_, i) =>
			setTimeout(() => setVisibleCount(i + 1), 1000 + i * 800),
		);
		return () => timers.forEach(clearTimeout);
	}, []);

	return (
		<div className="space-y-4">
			<div className="animate-fade-in">
				<TestimonialCard testimonial={PERSONA_CLOSING_TESTIMONIAL[persona]} stars />
			</div>

			<div className="space-y-2">
				{SCAN_NOTIFICATIONS.map((notification, i) => (
					<div
						key={notification.label}
						className="bg-green-50 border border-green-200 rounded-xl px-4 py-3 flex items-center gap-3 transition-all duration-500"
						style={{
							opacity: visibleCount > i ? 1 : 0,
							transform: visibleCount > i ? "translateY(0)" : "translateY(12px)",
						}}
					>
						<div className="w-8 h-8 rounded-full bg-green-200 flex items-center justify-center shrink-0">
							<LuCheck className="w-4 h-4 text-green-700" />
						</div>
						<div>
							<p className="text-sm font-medium text-green-900">{notification.label}</p>
							<p className="text-xs text-green-600">{notification.time}</p>
						</div>
					</div>
				))}
			</div>
		</div>
	);
}
