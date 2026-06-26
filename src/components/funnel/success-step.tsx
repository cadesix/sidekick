import Image from "next/image";
import { useEffect } from "react";
import { captureFunnelEvent, type FunnelContext } from "./analytics";
import { APP_STORE_URL, TRIAL_DAYS } from "./constants";
import { ILLUSTRATIONS } from "./illustrations";
import type { PaywallVariant } from "./types";

const NEXT_STEPS = [
	"Open Relic — you're already signed in",
	"Snap or upload a photo of your first item",
	"Get its real value, history, and what it's sold for",
];

// Art-directed confetti burst — warm antique palette with a couple of pops.
// Static (not random) so it paints identically every render and under SSR.
const CONFETTI = [
	{ left: "6%", color: "bg-amber-400", delay: "0ms", spin: "320deg" },
	{ left: "15%", color: "bg-orange-400", delay: "140ms", spin: "-280deg" },
	{ left: "24%", color: "bg-rose-400", delay: "60ms", spin: "400deg" },
	{ left: "33%", color: "bg-amber-300", delay: "220ms", spin: "-360deg" },
	{ left: "42%", color: "bg-emerald-400", delay: "100ms", spin: "300deg" },
	{ left: "50%", color: "bg-orange-500", delay: "300ms", spin: "-420deg" },
	{ left: "58%", color: "bg-amber-400", delay: "40ms", spin: "360deg" },
	{ left: "67%", color: "bg-rose-300", delay: "200ms", spin: "-300deg" },
	{ left: "76%", color: "bg-emerald-300", delay: "120ms", spin: "380deg" },
	{ left: "85%", color: "bg-orange-400", delay: "260ms", spin: "-340deg" },
	{ left: "94%", color: "bg-amber-300", delay: "80ms", spin: "320deg" },
];

export function SuccessStep({
	variant,
	context,
}: {
	variant: PaywallVariant;
	context: FunnelContext;
}) {
	const isTrial = variant === "trial";

	useEffect(() => {
		captureFunnelEvent("funnel_success_shown", context);
	}, [context]);

	return (
		<div className="relative overflow-hidden flex flex-col items-center gap-7 px-6 pt-9 pb-7">
			<div className="pointer-events-none absolute inset-x-0 top-0 h-0 z-20">
				{CONFETTI.map((piece, i) => {
					const style: React.CSSProperties & Record<`--${string}`, string> = {
						left: piece.left,
						animationDelay: piece.delay,
						"--confetti-spin": piece.spin,
					};
					return (
						<span
							key={i}
							className={`absolute top-0 h-2.5 w-1.5 rounded-[1px] animate-confetti ${piece.color}`}
							style={style}
						/>
					);
				})}
			</div>

			<div className="relative flex items-center justify-center">
				<div className="absolute h-48 w-48 rounded-full bg-gradient-to-tr from-amber-300 via-orange-300 to-rose-300 blur-2xl animate-glow-pulse" />
				<Image
					src={ILLUSTRATIONS.chest.src}
					alt={ILLUSTRATIONS.chest.alt}
					width={ILLUSTRATIONS.chest.width}
					height={ILLUSTRATIONS.chest.height}
					priority
					unoptimized
					className="relative h-44 w-auto animate-scale-in"
				/>
			</div>

			<div className="text-center animate-fade-in-up" style={{ animationDelay: "120ms" }}>
				<span className="inline-block mb-3 px-3 py-1 rounded-full bg-amber-100 text-amber-700 text-xs font-semibold tracking-wide uppercase">
					{isTrial ? `${TRIAL_DAYS}-day trial unlocked` : "Relic Pro unlocked"}
				</span>
				<h2 className="text-3xl font-bold text-stone-900 leading-tight">Your vault is open!</h2>
				<p className="text-stone-500 mt-2 max-w-sm">
					Everything&apos;s ready — let&apos;s put a real value on your first find right now.
				</p>
			</div>

			<div className="flex flex-col gap-4 w-full">
				<div className="space-y-2.5">
					{NEXT_STEPS.map((step, i) => (
						<div
							key={step}
							className="flex items-center gap-3 animate-fade-in-up"
							style={{ animationDelay: `${260 + i * 90}ms` }}
						>
							<span className="w-7 h-7 rounded-full bg-gradient-to-br from-amber-400 to-orange-500 text-white text-xs font-bold flex items-center justify-center shrink-0 shadow-sm">
								{i + 1}
							</span>
							<span className="text-sm text-stone-700">{step}</span>
						</div>
					))}
				</div>

				<a
					href="/app"
					onClick={() => captureFunnelEvent("funnel_open_web_clicked", context)}
					className="w-full py-4 bg-stone-900 hover:bg-stone-800 active:bg-stone-700 text-white text-base font-semibold rounded-2xl transition-colors text-center block shadow-lg shadow-amber-500/20 animate-fade-in-up"
					style={{ animationDelay: "540ms" }}
				>
					Open Relic &amp; start scanning
				</a>

				<a
					href={APP_STORE_URL}
					onClick={() => captureFunnelEvent("funnel_app_store_clicked", context)}
					className="w-full py-4 bg-white border border-stone-300 hover:bg-stone-50 active:bg-stone-100 text-stone-900 text-base font-semibold rounded-2xl transition-colors text-center block animate-fade-in-up"
					style={{ animationDelay: "600ms" }}
				>
					Download the Relic iPhone App
				</a>
			</div>

			<div
				className="flex flex-col items-center gap-2 text-xs text-stone-400 animate-fade-in"
				style={{ animationDelay: "640ms" }}
			>
				<p>
					Prefer your phone?{" "}
					<a
						href={APP_STORE_URL}
						onClick={() => captureFunnelEvent("funnel_app_store_clicked", context)}
						className="underline hover:text-stone-600"
					>
						Get the iPhone app
					</a>
				</p>
				{isTrial ? <p>Your trial lasts {TRIAL_DAYS} days. Cancel anytime.</p> : null}
				<p>
					Need help?{" "}
					<a href="mailto:app.support@sans.software" className="underline hover:text-stone-600">
						Contact support
					</a>
				</p>
			</div>
		</div>
	);
}
