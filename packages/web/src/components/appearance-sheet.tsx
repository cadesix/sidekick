import { useEffect, useMemo, useState, type MutableRefObject } from "react";
import { LuCheck, LuX } from "react-icons/lu";
import type { Manifest } from "./sidekick-equipment";
import { buildProducts, ProductImage, type Product } from "./shop-sheet";
import { loadInventory } from "./sidekick-economy";
import { SKIN_COLORS, applySkin, currentSkinId, type SkinColor } from "./sidekick-skin";
import { SLOT_LABEL, WARDROBE_SLOTS, type Wardrobe, type CosmeticsControls } from "./sidekick-wardrobe";

// Appearance sheet — opened from the avatar button (top right). Presented like
// the Shop: the host swaps the scene to the solid studio backdrop and frames
// the full character in the band above this half-sheet, so outfit changes are
// visible in real time. Skin color swatches up top, then the Closet (owned
// cosmetics, moved here from the Shop). Tapping an owned item wears it;
// tapping again takes it off. Buying still happens in the Shop.

export function AppearanceSheet({
	open,
	onClose,
	controlsRef,
	onSkin,
}: {
	open: boolean;
	onClose: () => void;
	controlsRef: MutableRefObject<CosmeticsControls | null>;
	// live recolor of the mounted canvas (handleRef.setColors); persistence is ours
	onSkin?: (c: SkinColor) => void;
}) {
	const [wardrobe, setWardrobe] = useState<Wardrobe | null>(null);
	const [manifest, setManifest] = useState<Manifest | null>(null);
	const [inventory, setInventory] = useState<Set<string>>(loadInventory);
	const [skin, setSkin] = useState(currentSkinId);

	useEffect(() => {
		if (!open) return;
		setInventory(loadInventory());
		setSkin(currentSkinId());
		const c = controlsRef.current;
		if (!c) return;
		setWardrobe(c.getState());
		setManifest(c.manifest());
	}, [open, controlsRef]);

	const products = useMemo(() => (manifest ? buildProducts(manifest) : []), [manifest]);
	const owned = products.filter((p) => inventory.has(p.renderKey));

	const sync = () => {
		const c = controlsRef.current;
		if (c) setWardrobe(c.getState());
	};
	const isWorn = (p: Product) => {
		const st = wardrobe?.[p.slot];
		if (!st?.equipped) return false;
		return p.variantId ? st.variantId === p.variantId && !st.color : st.color?.toLowerCase() === p.color?.toLowerCase();
	};
	const toggleWear = (p: Product) => {
		const c = controlsRef.current;
		if (!c) return;
		if (isWorn(p)) c.remove(p.slot);
		else if (p.variantId) c.equipVariant(p.slot, p.variantId);
		else if (p.color) c.setColor(p.slot, p.color);
		sync();
	};
	const pickSkin = (c: SkinColor) => {
		setSkin(c.id);
		applySkin(c);
		onSkin?.(c);
	};

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
						<div className="text-[22px] font-extrabold text-neutral-900">Appearance</div>
						<button
							onClick={onClose}
							aria-label="Close appearance"
							className="grid h-9 w-9 place-items-center rounded-full bg-neutral-100 text-neutral-500 active:bg-neutral-200"
						>
							<LuX className="h-5 w-5" strokeWidth={2.5} />
						</button>
					</div>
				</div>

				<div className="no-scrollbar min-h-0 flex-1 overflow-y-auto px-6 pb-[max(env(safe-area-inset-bottom),20px)]">
					{/* skin color */}
					<div className="mt-3 text-[17px] font-extrabold text-neutral-900">Color</div>
					<div className="mt-2.5 flex gap-3">
						{SKIN_COLORS.map((c) => {
							const selected = skin === c.id;
							return (
								<button
									key={c.id}
									onClick={() => pickSkin(c)}
									aria-label={c.id}
									className={`grid h-11 w-11 shrink-0 place-items-center rounded-full ring-2 ring-offset-2 ring-offset-white transition ${
										selected ? "ring-neutral-900" : "ring-black/10"
									}`}
									style={{ background: c.body }}
								>
									{selected ? <LuCheck className="h-5 w-5 text-white" strokeWidth={3} /> : null}
								</button>
							);
						})}
					</div>

					{/* closet: owned items, tap to wear / take off */}
					<div className="mt-8 text-[17px] font-extrabold text-neutral-900">Closet</div>
					{owned.length ? (
						WARDROBE_SLOTS.map((slot) => {
							const items = owned.filter((p) => p.slot === slot);
							if (!items.length) return null;
							return (
								<div key={slot} className="pt-5">
									<div className="mb-2 text-[13px] font-semibold uppercase tracking-wide text-neutral-400">
										{SLOT_LABEL[slot]}
									</div>
									<div className="no-scrollbar -mx-6 flex gap-4 overflow-x-auto px-6">
										{items.map((p) => (
											<button key={p.renderKey} onClick={() => toggleWear(p)} className="w-[112px] shrink-0 text-left">
												<div className="relative aspect-square w-full">
													<ProductImage p={p} className="h-full w-full" />
													{isWorn(p) ? (
														<span className="absolute right-1 top-1 grid h-5 w-5 place-items-center rounded-full bg-neutral-900">
															<LuCheck className="h-3.5 w-3.5 text-white" strokeWidth={3} />
														</span>
													) : null}
												</div>
												<div className="mt-1 truncate text-[12px] font-semibold text-neutral-700">{p.name}</div>
											</button>
										))}
									</div>
								</div>
							);
						})
					) : (
						<div className="mt-6 text-center text-[14px] font-medium text-neutral-400">
							Nothing here yet — grab something in the Shop!
						</div>
					)}
				</div>
			</div>
		</div>
	);
}
