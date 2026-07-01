import { useEffect, useMemo, useState } from "react";
import CosmeticsTab from "./sidekick-cosmetics";

// Sidekick Studio — a lightweight dev surface for iterating on the Sidekick character.
//  • Generations tab: one-off pose/prop/scene renders against the canonical refs.
//  • Character Sheet tab: iterate on the neutral base-model turnaround itself, keep a
//    version history, and promote a version to become the canonical sheet.
// Backed by the dev-only /api/sidekick middleware (OpenAI key stays server-side).

type GenEntry = {
	id: string;
	file: string;
	prompt: string;
	refs: string[];
	size: string;
	quality: string;
	createdAt: string;
};

type Profile = {
	styleGuide: string;
	spec: string;
	palette: Record<string, string>;
	refs: string[];
};

const SIZES = ["1024x1024", "1024x1536", "1536x1024"] as const;
const QUALITIES = ["high", "medium", "low"] as const;
const COST_PER_IMG: Record<string, number> = { high: 0.17, medium: 0.07, low: 0.02 };

const DEFAULT_POSE_PROMPT =
	"Reproduce the EXACT character shown in the reference images — same color, " +
	"face, proportions, material and finish. Change only this: ";

const DEFAULT_SHEET_PROMPT =
	"Regenerate the neutral Sidekick base-model character sheet / turnaround on a clean " +
	"flat white background — render the body in NEUTRAL WHITE / soft light-grey (NOT any " +
	"hue): front, 3/4, side and back views plus a close-up of one oversized paw. Keep " +
	"EVERY locked feature identical (head ~45% of height, bear ears, 5-bump crest, simple " +
	"flat black almond eyes, the wide open smile with exactly 4 teeth, oversized mitten " +
	"hands with exactly 4 nub fingers, chunky proportions, pearl-white toe-beads). " +
	"Change only this: ";

function refUrl(name: string, bust = 0) {
	return `/api/sidekick/ref/${encodeURIComponent(name)}${bust ? `?v=${bust}` : ""}`;
}
function outUrl(file: string) {
	return `/api/sidekick/out/${encodeURIComponent(file)}`;
}
function sheetUrl(file: string) {
	return `/api/sidekick/sheet/${encodeURIComponent(file)}`;
}

function cost(quality: string, count: number) {
	return (COST_PER_IMG[quality] ?? 0.17) * count;
}

// ---------------------------------------------------------------------------

// The studio's sub-tabs, exported so the admin shell can render them inline in
// its top bar (controlled mode). Standalone (/sidekick) uses its own header.
export const STUDIO_TABS = [
	["cosmetics", "Cosmetics"],
	["poses", "Generations"],
	["sheet", "Character Sheet"],
] as const;
export type StudioTab = (typeof STUDIO_TABS)[number][0];

export default function SidekickStudio({
	tab: tabProp,
	onTabChange,
}: {
	tab?: StudioTab;
	onTabChange?: (t: StudioTab) => void;
} = {}) {
	const [tabState, setTabState] = useState<StudioTab>("cosmetics");
	const tab = tabProp ?? tabState;
	const setTab = onTabChange ?? setTabState;
	const controlled = onTabChange != null; // admin renders the nav; hide our own
	const [profile, setProfile] = useState<Profile | null>(null);

	useEffect(() => {
		fetch("/api/sidekick/profile")
			.then((r) => r.json())
			.then(setProfile)
			.catch(() => {});
	}, []);

	return (
		<div className="min-h-screen bg-neutral-100 text-neutral-900">
			{!controlled && (
				<header className="flex items-center gap-6 border-b border-neutral-200 bg-white px-6 py-3">
					<span className="text-lg font-semibold">Sidekick Studio</span>
					<nav className="flex gap-1">
						{STUDIO_TABS.map(([key, label]) => (
							<button
								key={key}
								onClick={() => setTab(key)}
								className={`rounded-full px-3 py-1 text-sm font-medium transition ${
									tab === key
										? "bg-amber-100 text-amber-700"
										: "text-neutral-500 hover:text-neutral-800"
								}`}
							>
								{label}
							</button>
						))}
					</nav>
				</header>
			)}
			{tab === "cosmetics" ? (
				<CosmeticsTab profile={profile} />
			) : tab === "poses" ? (
				<PosesTab profile={profile} />
			) : (
				<SheetTab profile={profile} />
			)}
		</div>
	);
}

// --- Generations tab -------------------------------------------------------

function PosesTab({ profile }: { profile: Profile | null }) {
	const [gallery, setGallery] = useState<GenEntry[]>([]);
	const [prompt, setPrompt] = useState(DEFAULT_POSE_PROMPT + "waving hello with one paw raised.");
	const [size, setSize] = useState("1024x1024");
	const [quality, setQuality] = useState("high");
	const [count, setCount] = useState(1);
	const [activeRefs, setActiveRefs] = useState<string[]>([]);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [lightbox, setLightbox] = useState<GenEntry | null>(null);
	const [showSpec, setShowSpec] = useState(false);

	useEffect(() => {
		if (profile) setActiveRefs(profile.refs);
	}, [profile]);
	useEffect(() => {
		fetch("/api/sidekick/gallery")
			.then((r) => r.json())
			.then((d) => setGallery(d.items ?? []))
			.catch(() => {});
	}, []);

	const est = useMemo(() => cost(quality, count), [quality, count]);

	function toggleRef(name: string) {
		setActiveRefs((p) => (p.includes(name) ? p.filter((r) => r !== name) : [...p, name]));
	}

	async function generate() {
		setBusy(true);
		setError(null);
		try {
			const res = await fetch("/api/sidekick/generate", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ prompt, size, quality, n: count, refs: activeRefs, kind: "pose" }),
			});
			const data = await res.json();
			if (!res.ok) throw new Error(data.error ?? "generation failed");
			setGallery((p) => [...(data.created as GenEntry[]), ...p]);
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		} finally {
			setBusy(false);
		}
	}

	return (
		<div className="mx-auto flex max-w-[1400px] gap-6 p-6">
			<aside className="sticky top-6 h-fit w-[300px] shrink-0">
				<div className="rounded-xl border border-neutral-200 bg-white p-4">
					<div className="mb-3 flex items-center justify-between">
						<h2 className="text-sm font-semibold text-neutral-700">References</h2>
						<button
							onClick={() => setShowSpec((s) => !s)}
							className="text-xs text-neutral-400 hover:text-neutral-700"
						>
							{showSpec ? "hide spec" : "spec"}
						</button>
					</div>
					<div className="space-y-3">
						{(profile?.refs ?? []).map((name) => {
							const on = activeRefs.includes(name);
							return (
								<button
									key={name}
									onClick={() => toggleRef(name)}
									className={`block w-full overflow-hidden rounded-lg border-2 text-left transition ${
										on ? "border-amber-500" : "border-transparent opacity-50 hover:opacity-80"
									}`}
								>
									<img src={refUrl(name)} alt={name} className="w-full bg-neutral-50" />
									<div className="flex items-center justify-between px-2 py-1 text-xs">
										<span className="truncate text-neutral-600">{name}</span>
										<span className={on ? "text-amber-600" : "text-neutral-400"}>
											{on ? "attached" : "off"}
										</span>
									</div>
								</button>
							);
						})}
						{!profile && <p className="text-xs text-neutral-400">loading references…</p>}
					</div>
				</div>
				{showSpec && profile?.spec && (
					<pre className="mt-4 max-h-[400px] overflow-auto whitespace-pre-wrap rounded-xl border border-neutral-200 bg-white p-3 text-[11px] leading-snug text-neutral-600">
						{profile.spec}
					</pre>
				)}
			</aside>

			<main className="min-w-0 flex-1">
				<Composer
					prompt={prompt}
					setPrompt={setPrompt}
					size={size}
					setSize={setSize}
					quality={quality}
					setQuality={setQuality}
					count={count}
					setCount={setCount}
					busy={busy}
					est={est}
					onGenerate={generate}
					footnote={`${activeRefs.length} reference${
						activeRefs.length === 1 ? "" : "s"
					} attached · gpt-image-2 · opaque PNG`}
					error={error}
				/>

				<h2 className="mb-3 mt-6 text-sm font-semibold text-neutral-700">
					Generations ({gallery.length})
				</h2>
				{gallery.length === 0 && !busy && (
					<p className="text-sm text-neutral-400">
						No generations yet — compose a pose above and hit Generate.
					</p>
				)}
				<div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-4">
					{busy &&
						Array.from({ length: count }).map((_, i) => (
							<div key={i} className="aspect-square animate-pulse rounded-xl bg-neutral-200" />
						))}
					{gallery.map((g) => (
						<figure
							key={g.id}
							className="group overflow-hidden rounded-xl border border-neutral-200 bg-white"
						>
							<button onClick={() => setLightbox(g)} className="block w-full">
								<img
									src={outUrl(g.file)}
									alt={g.prompt}
									className="aspect-square w-full bg-neutral-50 object-contain"
								/>
							</button>
							<figcaption className="space-y-1 p-2">
								<p className="line-clamp-2 text-[11px] leading-snug text-neutral-500">{g.prompt}</p>
								<button
									onClick={() => setPrompt(g.prompt)}
									className="text-[11px] font-medium text-amber-600 opacity-0 transition group-hover:opacity-100"
								>
									reuse prompt →
								</button>
							</figcaption>
						</figure>
					))}
				</div>
			</main>

			{lightbox && (
				<Lightbox
					src={outUrl(lightbox.file)}
					entry={lightbox}
					onClose={() => setLightbox(null)}
					onReuse={() => {
						setPrompt(lightbox.prompt);
						setLightbox(null);
					}}
				/>
			)}
		</div>
	);
}

// --- Character Sheet tab ---------------------------------------------------

function SheetTab({ profile }: { profile: Profile | null }) {
	const [current, setCurrent] = useState<{ name: string } | null>(null);
	const [versions, setVersions] = useState<GenEntry[]>([]);
	const [selected, setSelected] = useState<GenEntry | null>(null); // null = show current canonical
	const [prompt, setPrompt] = useState(
		DEFAULT_SHEET_PROMPT + "improve the legibility of the color-swatch strip.",
	);
	const [size, setSize] = useState("1536x1024");
	const [quality, setQuality] = useState("high");
	const [busy, setBusy] = useState(false);
	const [promoting, setPromoting] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [bust, setBust] = useState(1);

	async function loadSheets() {
		const d = await fetch("/api/sidekick/sheets").then((r) => r.json());
		setCurrent(d.current ?? null);
		setVersions(d.versions ?? []);
	}
	useEffect(() => {
		loadSheets().catch(() => {});
	}, []);

	const est = useMemo(() => cost(quality, 1), [quality]);
	// Iterate from the current canonical sheet (+ anchor) — promote a version first
	// to build on it instead. The canonical sheet name comes from /sheets so it
	// tracks whatever has been promoted.
	const refs = [
		...(current ? [current.name] : []),
		...(profile?.refs ?? []).filter((r) => r.includes("anchor")),
	];

	const largeSrc = selected
		? sheetUrl(selected.file)
		: current
			? refUrl(current.name, bust)
			: null;

	async function generate() {
		setBusy(true);
		setError(null);
		try {
			const res = await fetch("/api/sidekick/generate", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ prompt, size, quality, n: 1, refs, kind: "sheet" }),
			});
			const data = await res.json();
			if (!res.ok) throw new Error(data.error ?? "generation failed");
			const created = data.created as GenEntry[];
			setVersions((p) => [...created, ...p]);
			setSelected(created[0] ?? null); // show the fresh one large
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		} finally {
			setBusy(false);
		}
	}

	async function promote(file: string) {
		setPromoting(file);
		setError(null);
		try {
			const res = await fetch("/api/sidekick/promote", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ file }),
			});
			const data = await res.json();
			if (!res.ok) throw new Error(data.error ?? "promote failed");
			await loadSheets();
			setSelected(null); // jump back to the (now updated) canonical sheet
			setBust((b) => b + 1); // bust the <img> cache so the new sheet shows
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		} finally {
			setPromoting(null);
		}
	}

	return (
		<div className="mx-auto max-w-[1200px] p-6">
			{/* Masked-inpaint fidelity test result (dev note) */}
			<div className="mb-6 rounded-xl border border-neutral-200 bg-white p-4">
				<h2 className="mb-2 text-sm font-semibold text-neutral-700">
					Item-layer pipeline — coordinate-consistent (masked)
				</h2>
				<img
					src="/masktest.png"
					alt="masked item layer pipeline: base, masked edit, item layer, superimpose"
					className="w-full rounded-lg border border-neutral-200"
				/>
				<p className="mt-2 text-xs text-neutral-500">
					The free-generation/matte method drifted the character (~6% non-uniform), so extracted items
					didn't line up. Fix: a <b>masked edit never redraws the base</b> (panel 2 — same position as
					panel 1). The item lands on a keyable fill inside the mask; key it out → an <b>item layer in
					the base's exact coordinates</b> (panel 3) → superimpose and the character is identical, hat
					aligned (panel 4). Tradeoffs to solve in the build: per-slot masks, keyed fill limits dark
					items (needs a cleaner key), and a drift-guard to retry if a run ignores the mask.
				</p>
			</div>

			{/* Large current/selected sheet */}
			<div className="rounded-xl border border-neutral-200 bg-white p-4">
				<div className="mb-2 flex items-center justify-between">
					<h2 className="text-sm font-semibold text-neutral-700">
						{selected ? "Selected version" : "Current character sheet"}
						{selected && (
							<span className="ml-2 font-mono text-xs text-neutral-400">{selected.id}</span>
						)}
					</h2>
					{selected && (
						<div className="flex items-center gap-2">
							<button
								onClick={() => promote(selected.file)}
								disabled={promoting === selected.file}
								className="rounded-lg bg-amber-500 px-3 py-1 text-sm font-medium text-white hover:bg-amber-600 disabled:opacity-40"
							>
								{promoting === selected.file ? "promoting…" : "Set as current sheet"}
							</button>
							<button
								onClick={() => setSelected(null)}
								className="text-sm text-neutral-500 hover:text-neutral-800"
							>
								back to current
							</button>
						</div>
					)}
				</div>
				{largeSrc ? (
					<img
						src={largeSrc}
						alt="character sheet"
						className="max-h-[60vh] w-full rounded-lg bg-neutral-50 object-contain"
					/>
				) : (
					<p className="py-12 text-center text-sm text-neutral-400">
						No canonical character sheet found in .illustrate/refs/.
					</p>
				)}
				{selected && (
					<p className="mt-2 line-clamp-2 text-xs text-neutral-500">{selected.prompt}</p>
				)}
			</div>

			{/* Sheet composer */}
			<div className="mt-6">
				<Composer
					prompt={prompt}
					setPrompt={setPrompt}
					size={size}
					setSize={setSize}
					quality={quality}
					setQuality={setQuality}
					busy={busy}
					est={est}
					onGenerate={generate}
					footnote={`iterates from: ${refs.join(", ") || "(no refs found)"} · gpt-image-2`}
					error={error}
				/>
			</div>

			{/* Version history */}
			<h2 className="mb-3 mt-6 text-sm font-semibold text-neutral-700">
				Versions ({versions.length})
			</h2>
			{versions.length === 0 && !busy && (
				<p className="text-sm text-neutral-400">
					No iterations yet — describe a change above and Generate. Each version is kept; promote
					one to make it the canonical sheet.
				</p>
			)}
			<div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-4">
				{busy && <div className="aspect-[3/2] animate-pulse rounded-xl bg-neutral-200" />}
				{versions.map((v) => {
					const isSel = selected?.id === v.id;
					return (
						<figure
							key={v.id}
							className={`group overflow-hidden rounded-xl border-2 bg-white transition ${
								isSel ? "border-amber-500" : "border-neutral-200"
							}`}
						>
							<button onClick={() => setSelected(v)} className="block w-full">
								<img
									src={sheetUrl(v.file)}
									alt={v.prompt}
									className="aspect-[3/2] w-full bg-neutral-50 object-contain"
								/>
							</button>
							<figcaption className="flex items-center justify-between gap-2 p-2">
								<span className="font-mono text-[11px] text-neutral-400">{v.id}</span>
								<button
									onClick={() => promote(v.file)}
									disabled={promoting === v.file}
									className="text-[11px] font-medium text-amber-600 opacity-0 transition group-hover:opacity-100 disabled:opacity-40"
								>
									{promoting === v.file ? "promoting…" : "set as current →"}
								</button>
							</figcaption>
						</figure>
					);
				})}
			</div>
		</div>
	);
}

// --- shared bits -----------------------------------------------------------

function Composer(props: {
	prompt: string;
	setPrompt: (v: string) => void;
	size: string;
	setSize: (v: string) => void;
	quality: string;
	setQuality: (v: string) => void;
	count?: number;
	setCount?: (v: number) => void;
	busy: boolean;
	est: number;
	onGenerate: () => void;
	footnote: string;
	error: string | null;
}) {
	return (
		<div className="rounded-xl border border-neutral-200 bg-white p-4">
			<textarea
				value={props.prompt}
				onChange={(e) => props.setPrompt(e.target.value)}
				rows={4}
				className="w-full resize-y rounded-lg border border-neutral-300 p-3 text-sm focus:border-amber-500 focus:outline-none"
				placeholder="Describe only what changes…"
			/>
			<div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
				<label className="flex items-center gap-1">
					<span className="text-neutral-500">size</span>
					<select
						value={props.size}
						onChange={(e) => props.setSize(e.target.value)}
						className="rounded border border-neutral-300 px-2 py-1"
					>
						{SIZES.map((s) => (
							<option key={s}>{s}</option>
						))}
					</select>
				</label>
				<label className="flex items-center gap-1">
					<span className="text-neutral-500">quality</span>
					<select
						value={props.quality}
						onChange={(e) => props.setQuality(e.target.value)}
						className="rounded border border-neutral-300 px-2 py-1"
					>
						{QUALITIES.map((q) => (
							<option key={q}>{q}</option>
						))}
					</select>
				</label>
				{props.setCount && (
					<label className="flex items-center gap-1">
						<span className="text-neutral-500">count</span>
						<select
							value={props.count}
							onChange={(e) => props.setCount!(Number(e.target.value))}
							className="rounded border border-neutral-300 px-2 py-1"
						>
							{[1, 2, 3, 4].map((n) => (
								<option key={n}>{n}</option>
							))}
						</select>
					</label>
				)}
				<button
					onClick={props.onGenerate}
					disabled={props.busy || !props.prompt.trim()}
					className="ml-auto rounded-lg bg-amber-500 px-4 py-2 font-medium text-white transition hover:bg-amber-600 disabled:opacity-40"
				>
					{props.busy ? "generating…" : `Generate · ~$${props.est.toFixed(2)}`}
				</button>
			</div>
			<p className="mt-2 text-xs text-neutral-400">{props.footnote}</p>
			{props.error && (
				<p className="mt-2 rounded bg-red-50 px-3 py-2 text-xs text-red-600">{props.error}</p>
			)}
		</div>
	);
}

function Lightbox(props: {
	src: string;
	entry: GenEntry;
	onClose: () => void;
	onReuse: () => void;
}) {
	return (
		<div
			onClick={props.onClose}
			className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-8"
		>
			<div
				onClick={(e) => e.stopPropagation()}
				className="flex max-h-full max-w-3xl flex-col gap-3 rounded-xl bg-white p-4"
			>
				<img
					src={props.src}
					alt={props.entry.prompt}
					className="max-h-[70vh] w-auto rounded-lg bg-neutral-50 object-contain"
				/>
				<p className="text-sm text-neutral-600">{props.entry.prompt}</p>
				<div className="flex items-center gap-3 text-xs text-neutral-400">
					<span>{props.entry.size}</span>
					<span>·</span>
					<span>{props.entry.quality}</span>
					<span>·</span>
					<span>{new Date(props.entry.createdAt).toLocaleString()}</span>
					<button onClick={props.onReuse} className="ml-auto font-medium text-amber-600">
						reuse prompt →
					</button>
				</div>
			</div>
		</div>
	);
}
