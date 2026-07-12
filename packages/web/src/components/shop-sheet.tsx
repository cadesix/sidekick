import { useEffect, useState, type MutableRefObject } from "react";
import { LuX, LuBan, LuCheck } from "react-icons/lu";
import type { Manifest } from "./sidekick-equipment";
import {
	WARDROBE_SLOTS,
	SLOT_LABEL,
	SHOP_COLORS,
	type WardrobeSlot,
	type Wardrobe,
	type CosmeticsControls,
} from "./sidekick-wardrobe";

// Bottom-sheet "Shop" (really a wardrobe for now): pick which shirt / pants / hat
// / shoes are worn and recolor each one. It drives the live character behind it
// through the canvas's imperative CosmeticsControls, so every tap updates the 3D
// model immediately. The sheet covers the lower half; the character is framed
// above it so you can see the outfit change.

export function ShopSheet({
	open,
	onClose,
	controlsRef,
}: {
	open: boolean;
	onClose: () => void;
	controlsRef: MutableRefObject<CosmeticsControls | null>;
}) {
	const [slot, setSlot] = useState<WardrobeSlot>("shirt");
	const [wardrobe, setWardrobe] = useState<Wardrobe | null>(null);
	const [manifest, setManifest] = useState<Manifest | null>(null);

	// snapshot the current outfit + catalog when the sheet opens
	useEffect(() => {
		if (!open) return;
		const c = controlsRef.current;
		if (!c) return;
		setWardrobe(c.getState());
		setManifest(c.manifest());
	}, [open, controlsRef]);

	const st = wardrobe?.[slot];
	const variants = manifest?.[slot]?.variants ?? [];
	const sync = () => {
		const c = controlsRef.current;
		if (c) setWardrobe(c.getState());
	};

	const pickVariant = (id: string) => {
		controlsRef.current?.equipVariant(slot, id);
		sync();
	};
	const pickColor = (color: string) => {
		controlsRef.current?.setColor(slot, color);
		sync();
	};
	const removeSlot = () => {
		controlsRef.current?.remove(slot);
		sync();
	};

	// which choice is currently active, for the highlight rings
	const activeColor = st?.equipped ? st.color : undefined;
	const activeVariant = st?.equipped && !st.color ? st.variantId : undefined;
	const isOff = !st?.equipped;

	return (
		<div
			className={`absolute inset-x-0 bottom-0 z-40 h-[52%] transition-transform duration-300 ease-out ${
				open ? "translate-y-0" : "pointer-events-none translate-y-full"
			}`}
		>
			<div className="flex h-full flex-col rounded-t-[28px] bg-white shadow-[0_-8px_40px_rgba(0,0,0,0.22)]">
				{/* grabber + header */}
				<div className="relative shrink-0 px-5 pt-3">
					<div className="mx-auto h-1.5 w-10 rounded-full bg-neutral-200" />
					<div className="mt-2 flex items-center justify-between">
						<div className="text-[22px] font-extrabold text-neutral-900">Shop</div>
						<button
							onClick={onClose}
							aria-label="Close shop"
							className="grid h-9 w-9 place-items-center rounded-full bg-neutral-100 text-neutral-500 active:bg-neutral-200"
						>
							<LuX className="h-5 w-5" strokeWidth={2.5} />
						</button>
					</div>
				</div>

				{/* slot tabs */}
				<div className="no-scrollbar mt-3 flex shrink-0 gap-2 overflow-x-auto px-5">
					{WARDROBE_SLOTS.map((s) => {
						const on = wardrobe?.[s]?.equipped;
						return (
							<button
								key={s}
								onClick={() => setSlot(s)}
								className={`relative whitespace-nowrap rounded-full px-4 py-2 text-[15px] font-bold transition ${
									slot === s ? "bg-neutral-900 text-white" : "bg-neutral-100 text-neutral-600 active:bg-neutral-200"
								}`}
							>
								{SLOT_LABEL[s]}
								{on ? (
									<span
										className={`absolute right-1.5 top-1.5 h-2 w-2 rounded-full ${
											slot === s ? "bg-emerald-400" : "bg-emerald-500"
										}`}
									/>
								) : null}
							</button>
						);
					})}
				</div>

				{/* scrolling content: styles then colors */}
				<div className="min-h-0 flex-1 overflow-y-auto px-5 pb-[max(env(safe-area-inset-bottom),16px)] pt-4">
					{/* Styles */}
					<div className="mb-1.5 text-[13px] font-semibold uppercase tracking-wide text-neutral-400">Style</div>
					<div className="grid grid-cols-[repeat(auto-fill,minmax(66px,1fr))] gap-2.5">
						{/* None / take off */}
						<button
							onClick={removeSlot}
							aria-label={`Remove ${SLOT_LABEL[slot]}`}
							className={`grid aspect-square place-items-center rounded-2xl border-2 bg-neutral-50 ${
								isOff ? "border-neutral-900" : "border-transparent"
							}`}
						>
							<LuBan className="h-6 w-6 text-neutral-400" strokeWidth={2} />
						</button>
						{variants.map((v) => {
							const selected = activeVariant === v.id;
							return (
								<button
									key={v.id}
									onClick={() => pickVariant(v.id)}
									aria-label={v.name}
									className={`relative aspect-square overflow-hidden rounded-2xl border-2 ${
										selected ? "border-neutral-900" : "border-transparent"
									}`}
									style={{ background: v.color ?? "#e9edf1" }}
								>
									{v.tex ? (
										<img src={v.tex} alt="" className="h-full w-full object-cover" draggable={false} />
									) : null}
									{selected ? (
										<span className="absolute right-1 top-1 grid h-5 w-5 place-items-center rounded-full bg-neutral-900">
											<LuCheck className="h-3.5 w-3.5 text-white" strokeWidth={3} />
										</span>
									) : null}
								</button>
							);
						})}
					</div>

					{/* Colors */}
					<div className="mb-1.5 mt-5 text-[13px] font-semibold uppercase tracking-wide text-neutral-400">Color</div>
					<div className="flex flex-wrap gap-2.5">
						{SHOP_COLORS.map((c) => {
							const selected = activeColor?.toLowerCase() === c.toLowerCase();
							return (
								<button
									key={c}
									onClick={() => pickColor(c)}
									aria-label={`Color ${c}`}
									className={`grid h-10 w-10 place-items-center rounded-full ring-2 ring-offset-2 ring-offset-white transition ${
										selected ? "ring-neutral-900" : "ring-black/5"
									}`}
									style={{ background: c }}
								>
									{selected ? (
										<LuCheck
											className="h-5 w-5"
											strokeWidth={3}
											style={{ color: pickTextColor(c) }}
										/>
									) : null}
								</button>
							);
						})}
					</div>
				</div>
			</div>
		</div>
	);
}

// black or white check depending on swatch luminance
function pickTextColor(hex: string): string {
	const h = hex.replace("#", "");
	const r = parseInt(h.slice(0, 2), 16);
	const g = parseInt(h.slice(2, 4), 16);
	const b = parseInt(h.slice(4, 6), 16);
	const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
	return lum > 0.6 ? "#111" : "#fff";
}
