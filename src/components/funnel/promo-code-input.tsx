import { useState } from "react";
import { LuCheck, LuTag, LuX } from "react-icons/lu";
import { api } from "~/utils/trpc";
import type { AppliedCoupon } from "./constants";
import { discountLabel } from "./pricing";

function durationLabel(duration: string, durationInMonths: number | null): string {
	if (duration === "once") {
		return " · first payment";
	}
	if (duration === "repeating" && durationInMonths) {
		return ` · first ${durationInMonths} months`;
	}
	return "";
}

export function PromoCodeInput({
	appliedCoupon,
	onApply,
	onClear,
}: {
	appliedCoupon: AppliedCoupon | null;
	onApply: (coupon: AppliedCoupon) => void;
	onClear: () => void;
}) {
	const [expanded, setExpanded] = useState(false);
	const [code, setCode] = useState("");
	const [error, setError] = useState<string | null>(null);
	const validate = api.stripe.validatePromoCode.useMutation();

	const handleApply = async () => {
		setError(null);
		const result = await validate.mutateAsync({ code: code.trim() });
		if (result.valid) {
			onApply({
				code: result.code,
				promotionCodeId: result.promotionCodeId,
				percentOff: result.coupon.percentOff,
				amountOff: result.coupon.amountOff,
				durationLabel: durationLabel(result.coupon.duration, result.coupon.durationInMonths),
			});
			setExpanded(false);
			setCode("");
		} else {
			setError("That code isn't valid");
		}
	};

	if (appliedCoupon) {
		return (
			<div className="flex items-center justify-between gap-2 px-3.5 py-2.5 rounded-xl bg-green-50 border border-green-200">
				<div className="flex items-center gap-2 text-sm font-medium text-green-800">
					<LuCheck className="w-4 h-4 shrink-0" strokeWidth={3} />
					<span>
						Code <span className="font-bold tracking-wide">{appliedCoupon.code}</span> —{" "}
						{discountLabel(appliedCoupon)}
						{appliedCoupon.durationLabel}
					</span>
				</div>
				<button
					type="button"
					onClick={onClear}
					className="text-green-500 hover:text-green-700 transition shrink-0"
					aria-label="Remove code"
				>
					<LuX className="w-4 h-4" strokeWidth={3} />
				</button>
			</div>
		);
	}

	if (!expanded) {
		return (
			<button
				type="button"
				onClick={() => setExpanded(true)}
				className="flex items-center gap-1.5 text-sm text-stone-500 hover:text-stone-800 transition"
			>
				<LuTag className="w-3.5 h-3.5" />
				Have a discount code?
			</button>
		);
	}

	return (
		<div className="space-y-1.5">
			<div className="flex gap-2">
				<input
					value={code}
					onChange={(e) => {
						setCode(e.target.value);
						setError(null);
					}}
					onKeyDown={(e) => {
						if (e.key === "Enter") {
							e.preventDefault();
							void handleApply();
						}
					}}
					placeholder="Enter code"
					autoFocus
					className="flex-1 min-w-0 px-3.5 py-2.5 rounded-xl border border-stone-200 bg-white text-sm font-medium uppercase tracking-wide text-stone-900 placeholder:normal-case placeholder:tracking-normal placeholder:text-stone-400 focus:outline-none focus:border-stone-400"
				/>
				<button
					type="button"
					onClick={() => void handleApply()}
					disabled={!code.trim() || validate.isPending}
					className="px-4 py-2.5 rounded-xl bg-stone-900 text-white text-sm font-medium hover:bg-stone-800 transition disabled:opacity-40"
				>
					{validate.isPending ? "…" : "Apply"}
				</button>
			</div>
			{error ? <p className="text-xs text-red-600 px-1">{error}</p> : null}
		</div>
	);
}
