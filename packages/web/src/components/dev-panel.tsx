import { useState } from "react";
import { BOND_KEY, loadBond } from "./sidekick-bond";
import { COINS_KEY, INV_KEY, loadCoins, loadInventory } from "./sidekick-economy";
import { STREAK_KEY } from "./sidekick-streak";
import {
	ONBOARDING_KEY,
	ONBOARDING_PHASES,
	PERSONAS,
	applyPersona,
	loadOnboardingPhase,
	resetProfile,
} from "./sidekick-profile";
import { SHOP_COLORS, WARDROBE_SLOTS } from "./sidekick-wardrobe";

// Dev-only user-state panel (the tiny DEV chip, top-left). Hop between whole
// user personas in one tap, or nudge individual dials — bond, streak, coins,
// inventory, onboarding phase. Every mutation writes localStorage and reloads:
// all stores re-read at mount, so a reload IS a clean, honest state swap.
// Never rendered in production builds (home4 gates on import.meta.env.DEV).

function write(key: string, value: string): void {
	try {
		localStorage.setItem(key, value);
	} catch {
		// storage blocked
	}
	window.location.reload();
}

function localDay(): string {
	const d = new Date();
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// every product key in the catalog (variants come from the manifest)
async function allProductKeys(): Promise<string[]> {
	const manifest = await fetch("/cosmetics/manifest.json").then((r) => r.json());
	const keys: string[] = [];
	for (const slot of WARDROBE_SLOTS) {
		const def = manifest[slot];
		if (!def) continue;
		for (const v of def.variants) keys.push(`${slot}-${v.id}`);
		for (const c of SHOP_COLORS) keys.push(`${slot}-c${c.slice(1)}`);
	}
	return keys;
}

export function DevPanel() {
	const [open, setOpen] = useState(false);
	const bond = loadBond();
	const coins = loadCoins();
	const owned = loadInventory().size;
	const phase = loadOnboardingPhase();
	let streak = 0;
	try {
		streak = JSON.parse(localStorage.getItem(STREAK_KEY) ?? "{}")?.count ?? 0;
	} catch {
		// unreadable — show 0
	}

	const chip = "rounded-md bg-neutral-700 px-2 py-1 text-[11px] font-bold text-white active:bg-neutral-600";

	return (
		<>
			<button
				onClick={() => setOpen(!open)}
				className="absolute left-3 top-[max(env(safe-area-inset-top),16px)] z-50 rounded-md bg-black/60 px-2 py-1 font-mono text-[10px] font-bold tracking-wider text-lime-300"
			>
				DEV
			</button>
			{open ? (
				<div className="absolute left-3 top-[max(env(safe-area-inset-top),48px)] z-50 w-72 space-y-3 rounded-xl bg-neutral-900/95 p-3 font-mono text-[11px] text-neutral-300 shadow-2xl backdrop-blur">
					<div className="text-[10px] uppercase tracking-widest text-neutral-500">Personas</div>
					<div className="grid grid-cols-2 gap-1.5">
						{Object.entries(PERSONAS).map(([id, p]) => (
							<button key={id} onClick={() => applyPersona(id)} className="rounded-md bg-neutral-800 px-2 py-1.5 text-left active:bg-neutral-700">
								<div className="font-bold text-white">{p.label}</div>
								<div className="text-[10px] text-neutral-500">{p.blurb}</div>
							</button>
						))}
					</div>

					<div className="text-[10px] uppercase tracking-widest text-neutral-500">
						Bond <span className="text-lime-300">{bond}%</span>
					</div>
					<div className="flex gap-1.5">
						{[10, 25, 40, 55, 70, 85, 100].map((v) => (
							<button key={v} onClick={() => write(BOND_KEY, String(v))} className={chip}>
								{v}
							</button>
						))}
					</div>

					<div className="text-[10px] uppercase tracking-widest text-neutral-500">
						Streak <span className="text-lime-300">{streak}d</span>
					</div>
					<div className="flex gap-1.5">
						{[1, 3, 6, 9, 13, 29, 89, 364].map((v) => (
							<button
								key={v}
								onClick={() => write(STREAK_KEY, JSON.stringify({ count: v, last: localDay() }))}
								className={chip}
							>
								{v}
							</button>
						))}
					</div>

					<div className="text-[10px] uppercase tracking-widest text-neutral-500">
						Coins <span className="text-lime-300">{coins}</span>
					</div>
					<div className="flex gap-1.5">
						{[0, 50, 250, 1000, 5000].map((v) => (
							<button key={v} onClick={() => write(COINS_KEY, String(v))} className={chip}>
								{v}
							</button>
						))}
					</div>

					<div className="text-[10px] uppercase tracking-widest text-neutral-500">
						Inventory <span className="text-lime-300">{owned} items</span>
					</div>
					<div className="flex gap-1.5">
						<button
							onClick={() => allProductKeys().then((keys) => write(INV_KEY, JSON.stringify(keys)))}
							className={chip}
						>
							Own all
						</button>
						<button onClick={() => write(INV_KEY, "[]")} className={chip}>
							Own none
						</button>
					</div>

					<div className="text-[10px] uppercase tracking-widest text-neutral-500">
						Onboarding <span className="text-lime-300">{phase}</span>
					</div>
					<div className="flex flex-wrap gap-1.5">
						{ONBOARDING_PHASES.map((ph) => (
							<button key={ph} onClick={() => write(ONBOARDING_KEY, ph)} className={chip}>
								{ph}
							</button>
						))}
					</div>

					<button
						onClick={resetProfile}
						className="w-full rounded-md bg-red-900/70 px-2 py-1.5 font-bold text-red-200 active:bg-red-800"
					>
						Reset profile (wipe all keys)
					</button>
				</div>
			) : null}
		</>
	);
}
