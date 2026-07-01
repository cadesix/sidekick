import { useEffect, useMemo, useRef, useState } from "react";
import {
	LuArrowUp,
	LuChevronLeft,
	LuChevronRight,
	LuImagePlus,
	LuPlus,
	LuSlidersHorizontal,
	LuX,
} from "react-icons/lu";

// Graphic Assets — a general on-brand image generator for Sidekick (illustrations,
// hero art, empty-state graphics, marketing visuals…), styled after Midjourney:
// one big prompt bar pinned at the top, config behind a filter icon, references
// behind an image icon (shown as thumbnails beside the bar), and an infinite
// gallery below. Backed by the dev-only /api/sidekick middleware, which calls
// gpt-image-2 and keeps the OpenAI key server-side.

type GenEntry = {
	id: string;
	file: string;
	prompt: string;
	// The user-written portion only (no brand context), tagged client-side at generate
	// time so "reuse" restores exactly what the user typed. Absent on older history.
	userPrompt?: string;
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

// The full set of parameters the gpt-image API exposes, as selector options.
const MODELS = ["gpt-image-2", "gpt-image-1.5"] as const;
const SIZES = ["1024x1024", "1024x1536", "1536x1024", "auto"] as const;
const QUALITIES = ["high", "medium", "low", "auto"] as const;
const BACKGROUNDS = ["opaque", "transparent", "auto"] as const;
const FORMATS = ["png", "jpeg", "webp"] as const;
const COMPRESSIONS = ["100", "90", "75", "50"] as const;
const MODERATIONS = ["auto", "low"] as const;
const FIDELITIES = ["low", "high"] as const;
const COUNTS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"] as const;

const COST_PER_IMG: Record<string, number> = { high: 0.17, medium: 0.07, low: 0.02 };

// Standing brand context describing what Sidekick is. Lives in the filter panel.
const DEFAULT_CONTEXT_PROMPT =
	"Brand context — these graphics are for \"Sidekick\", a warm, playful self-improvement " +
	"app. Its mascot is a chunky, squat, glossy soft-vinyl character in a muted golden-amber " +
	"yellow (#DC933F, never neon or oversaturated): a big round head with rounded bear ears, " +
	"simple flat black almond eyes, and one wide happy smile. The brand feel is friendly, cozy, " +
	"rounded and encouraging — soft studio lighting, clean flat backgrounds, smooth glossy " +
	"surfaces, no harsh edges, no corporate slickness.";

function refUrl(name: string) {
	return `/api/sidekick/ref/${encodeURIComponent(name)}`;
}
function graphicUrl(file: string) {
	return `/api/sidekick/graphic/${encodeURIComponent(file)}`;
}
function cost(quality: string, count: number) {
	return (COST_PER_IMG[quality] ?? 0.17) * count;
}

function fileToDataUrl(file: File): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve(String(reader.result));
		reader.onerror = () => reject(reader.error);
		reader.readAsDataURL(file);
	});
}

// A labelled dropdown, used for every image-API parameter.
function Select({
	label,
	value,
	options,
	onChange,
}: {
	label: string;
	value: string;
	options: readonly string[];
	onChange: (v: string) => void;
}) {
	return (
		<label className="flex flex-col gap-1">
			<span className="text-[10px] font-semibold uppercase tracking-wide text-neutral-400">
				{label}
			</span>
			<select
				value={value}
				onChange={(e) => onChange(e.target.value)}
				className="rounded-lg border border-neutral-200 bg-neutral-50 px-2.5 py-1.5 text-sm transition focus:border-amber-500 focus:bg-white focus:outline-none"
			>
				{options.map((o) => (
					<option key={o}>{o}</option>
				))}
			</select>
		</label>
	);
}

export default function GraphicAssets() {
	const [profile, setProfile] = useState<Profile | null>(null);
	const [uploadedRefs, setUploadedRefs] = useState<string[]>([]);
	const [attached, setAttached] = useState<string[]>([]);
	const [gallery, setGallery] = useState<GenEntry[]>([]);

	// Prompt bar — the standing brand/system context (small, above) + the big input below.
	const [userPrompt, setUserPrompt] = useState("");
	const [contextPrompt, setContextPrompt] = useState(DEFAULT_CONTEXT_PROMPT);
	const promptRef = useRef<HTMLTextAreaElement>(null);
	const contextRef = useRef<HTMLTextAreaElement>(null);

	// Which floating panel is open beneath the bar.
	const [panel, setPanel] = useState<null | "refs" | "filter">(null);

	// Image-API parameters.
	const [model, setModel] = useState("gpt-image-2");
	const [size, setSize] = useState("1024x1024");
	const [quality, setQuality] = useState("high");
	const [background, setBackground] = useState("opaque");
	const [format, setFormat] = useState("png");
	const [compression, setCompression] = useState("100");
	const [moderation, setModeration] = useState("auto");
	const [fidelity, setFidelity] = useState("low");
	const [count, setCount] = useState("1");

	// In-flight generations — each runs concurrently in the background and shows its
	// own placeholder tiles until it resolves. Send more while others are still running.
	const [jobs, setJobs] = useState<{ id: string; count: number }[]>([]);
	const [uploading, setUploading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [lightbox, setLightbox] = useState<GenEntry | null>(null);
	const fileInput = useRef<HTMLInputElement>(null);

	useEffect(() => {
		fetch("/api/sidekick/profile")
			.then((r) => r.json())
			.then((p: Profile) => {
				setProfile(p);
				setAttached(
					(p.refs ?? []).filter((r) => r.includes("anchor") || r.includes("character-sheet")),
				);
			})
			.catch(() => {});
		fetch("/api/sidekick/graphics")
			.then((r) => r.json())
			.then((d) => setGallery(d.items ?? []))
			.catch(() => {});
	}, []);

	const allRefs = useMemo(
		() => [...uploadedRefs, ...(profile?.refs ?? [])],
		[uploadedRefs, profile],
	);
	const available = useMemo(
		() => allRefs.filter((r) => !attached.includes(r)),
		[allRefs, attached],
	);
	const est = useMemo(() => cost(quality, Number(count)), [quality, count]);
	const canGenerate = Boolean(userPrompt.trim() || contextPrompt.trim());
	const pending = useMemo(() => jobs.reduce((sum, j) => sum + j.count, 0), [jobs]);

	const lbIndex = lightbox ? gallery.findIndex((g) => g.id === lightbox.id) : -1;

	// Move the lightbox selection through the gallery (used by arrows + on-screen buttons).
	function step(dir: 1 | -1) {
		setLightbox((cur) => {
			if (!cur) return cur;
			const idx = gallery.findIndex((g) => g.id === cur.id);
			const next = idx + dir;
			return next >= 0 && next < gallery.length ? gallery[next] : cur;
		});
	}

	// Lightbox arrow-key navigation across the whole gallery.
	useEffect(() => {
		if (!lightbox) return;
		function onKey(e: KeyboardEvent) {
			if (e.key === "Escape") setLightbox(null);
			else if (e.key === "ArrowRight") step(1);
			else if (e.key === "ArrowLeft") step(-1);
		}
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [lightbox, gallery]);

	function grow(el: HTMLTextAreaElement | null, max: number) {
		if (!el) return;
		el.style.height = "auto";
		el.style.height = `${Math.min(el.scrollHeight, max)}px`;
	}

	// Size the context box to its default text on mount.
	useEffect(() => {
		grow(contextRef.current, 140);
	}, []);

	// Recover just the user-written part of a stored (combined) prompt. Prefers the
	// tagged userPrompt; otherwise strips a leading brand-context block (current or default).
	function userPart(g: GenEntry) {
		if (g.userPrompt !== undefined) return g.userPrompt;
		const full = g.prompt;
		for (const ctx of [contextPrompt.trim(), DEFAULT_CONTEXT_PROMPT.trim()]) {
			if (ctx && full.startsWith(ctx)) return full.slice(ctx.length).replace(/^\n+/, "");
		}
		return full;
	}

	// Reuse a past generation — restore the user's prompt (not the brand context) and its refs.
	function reuse(g: GenEntry) {
		setUserPrompt(userPart(g));
		setAttached(g.refs ?? []);
		requestAnimationFrame(() => grow(promptRef.current, 220));
	}

	function detach(name: string) {
		setAttached((p) => p.filter((r) => r !== name));
	}
	function attach(name: string) {
		setAttached((p) => (p.includes(name) ? p : [...p, name]));
	}

	async function onUpload(e: React.ChangeEvent<HTMLInputElement>) {
		const file = e.target.files?.[0];
		e.target.value = "";
		if (!file) return;
		setUploading(true);
		setError(null);
		try {
			const dataUrl = await fileToDataUrl(file);
			const res = await fetch("/api/sidekick/upload-ref", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ dataUrl }),
			});
			const data = await res.json();
			if (!res.ok) throw new Error(data.error ?? "upload failed");
			setUploadedRefs((p) => [data.name, ...p]);
			setAttached((p) => [...p, data.name]);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setUploading(false);
		}
	}

	// Fire a generation and return immediately — it resolves in the background while the
	// user can queue more. Snapshots the prompt/params now so later edits don't affect it.
	function generate() {
		if (!canGenerate) return;
		const promptText = userPrompt.trim();
		const prompt = [contextPrompt.trim(), promptText].filter(Boolean).join("\n\n");
		const n = Number(count);
		const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
		const body = {
			prompt,
			refs: attached,
			kind: "asset",
			model,
			size,
			quality,
			background,
			outputFormat: format,
			moderation,
			n,
			...(format !== "png" ? { outputCompression: Number(compression) } : {}),
			...(model !== "gpt-image-2" ? { inputFidelity: fidelity } : {}),
		};

		setError(null);
		setPanel(null);
		setJobs((j) => [{ id, count: n }, ...j]);
		// Clear the input so the next prompt can be typed while this one renders.
		setUserPrompt("");
		requestAnimationFrame(() => grow(promptRef.current, 220));

		(async () => {
			try {
				const res = await fetch("/api/sidekick/generate", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify(body),
				});
				const data = await res.json();
				if (!res.ok) throw new Error(data.error ?? "generation failed");
				const created = (data.created as GenEntry[]).map((g) => ({ ...g, userPrompt: promptText }));
				setGallery((p) => [...created, ...p]);
			} catch (e) {
				setError(e instanceof Error ? e.message : String(e));
			} finally {
				setJobs((j) => j.filter((x) => x.id !== id));
			}
		})();
	}

	function togglePanel(which: "refs" | "filter") {
		setPanel((p) => (p === which ? null : which));
	}

	return (
		<div className="min-h-full bg-neutral-100 text-neutral-900">
			{/* ── Prompt bar (pinned) ─────────────────────────────────────────── */}
			<div className="sticky top-0 z-20 border-b border-neutral-200/70 bg-neutral-100/80 backdrop-blur">
				<div className="relative mx-auto max-w-[1100px] px-6 py-3">
					{/* System / brand context — small, editable, sits above the input bar */}
					<div className="mb-1.5 flex items-start gap-2 px-2">
						<span className="mt-1 shrink-0 text-[10px] font-semibold uppercase tracking-wide text-neutral-400">
							context
						</span>
						<textarea
							ref={contextRef}
							value={contextPrompt}
							onChange={(e) => {
								setContextPrompt(e.target.value);
								grow(contextRef.current, 140);
							}}
							rows={1}
							placeholder="System / brand context…"
							className="max-h-[140px] flex-1 resize-none bg-transparent text-[12px] leading-relaxed text-neutral-500 placeholder:text-neutral-400 focus:text-neutral-700 focus:outline-none"
						/>
					</div>

					{/* Input bar — prompt gets its own row; controls live on a separate row
					    so the layout stays stable as the prompt grows vertically. */}
					<div className="flex flex-col gap-2 rounded-2xl border border-neutral-200 bg-white px-3 py-2.5 shadow-sm focus-within:border-neutral-300">
						{/* Our own prompt — additional directions on top of the context above */}
						<textarea
							ref={promptRef}
							value={userPrompt}
							onChange={(e) => {
								setUserPrompt(e.target.value);
								grow(promptRef.current, 220);
							}}
							onKeyDown={(e) => {
								if (e.key === "Enter" && !e.shiftKey) {
									e.preventDefault();
									generate();
								}
							}}
							rows={1}
							placeholder="Add your prompt — extra directions on top of the context…"
							className="max-h-[220px] w-full resize-none bg-transparent px-1 text-[15px] leading-6 text-neutral-900 placeholder:text-neutral-400 focus:outline-none"
						/>

						{/* Controls row — fixed, never shifts when the prompt expands */}
						<div className="flex items-center gap-2">
							{/* References */}
							<button
								onClick={() => togglePanel("refs")}
								aria-label="references"
								className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl transition ${
									panel === "refs"
										? "bg-neutral-900 text-white"
										: "text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800"
								}`}
							>
								<LuImagePlus className="h-5 w-5" />
							</button>

							{/* Attached reference thumbnails */}
							{attached.length > 0 && (
								<div className="flex min-w-0 items-center gap-1.5 overflow-x-auto">
									{attached.map((name) => (
										<span
											key={name}
											className="group relative h-9 w-9 shrink-0 overflow-hidden rounded-lg border border-neutral-200 bg-neutral-50"
										>
											<img
												src={refUrl(name)}
												alt={name}
												className="h-full w-full object-contain"
											/>
											<button
												onClick={() => detach(name)}
												aria-label={`remove ${name}`}
												className="absolute inset-0 flex items-center justify-center bg-black/50 text-white opacity-0 transition group-hover:opacity-100"
											>
												<LuX className="h-3.5 w-3.5" />
											</button>
										</span>
									))}
								</div>
							)}

							<div className="flex-1" />

							{/* Filters / config */}
							<button
								onClick={() => togglePanel("filter")}
								aria-label="settings"
								className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl transition ${
									panel === "filter"
										? "bg-neutral-900 text-white"
										: "text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800"
								}`}
						>
							<LuSlidersHorizontal className="h-5 w-5" />
						</button>

							{/* Generate — non-blocking; queue more while others run */}
							<button
								onClick={generate}
								disabled={!canGenerate}
								title={
									pending > 0
										? `Generate · ~$${est.toFixed(2)} · ${pending} rendering…`
										: `Generate · ~$${est.toFixed(2)}`
								}
								className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-neutral-900 text-white transition hover:bg-neutral-700 disabled:opacity-30"
							>
								<LuArrowUp className="h-5 w-5" />
								{pending > 0 && (
									<span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-500 px-1 text-[10px] font-bold text-white">
										{jobs.length}
									</span>
								)}
							</button>
						</div>
					</div>

					{error && (
						<p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{error}</p>
					)}

					{/* Click-away backdrop for the panels */}
					{panel && (
						<div className="fixed inset-0 z-20" onClick={() => setPanel(null)} />
					)}

					{/* References panel */}
					{panel === "refs" && (
						<div className="absolute left-6 right-6 top-full z-30 mt-1 rounded-xl border border-neutral-200 bg-white p-4 shadow-xl sm:left-6 sm:right-auto sm:w-[440px]">
							<div className="mb-3 flex items-center justify-between">
								<h3 className="text-sm font-semibold text-neutral-700">References</h3>
								<button
									onClick={() => fileInput.current?.click()}
									disabled={uploading}
									className="rounded-md bg-neutral-900 px-2.5 py-1 text-xs font-medium text-white transition hover:bg-neutral-700 disabled:opacity-40"
								>
									{uploading ? "uploading…" : "upload new"}
								</button>
								<input
									ref={fileInput}
									type="file"
									accept="image/png,image/webp,image/jpeg"
									onChange={onUpload}
									className="hidden"
								/>
							</div>
							{attached.length > 0 && (
								<div className="mb-3 flex flex-wrap gap-2">
									{attached.map((name) => (
										<span
											key={name}
											className="group relative h-14 w-14 overflow-hidden rounded-lg border border-amber-400 bg-neutral-50"
										>
											<img
												src={refUrl(name)}
												alt={name}
												className="h-full w-full object-contain"
											/>
											<button
												onClick={() => detach(name)}
												aria-label={`remove ${name}`}
												className="absolute inset-0 flex items-center justify-center bg-black/50 text-white opacity-0 transition group-hover:opacity-100"
											>
												<LuX className="h-4 w-4" />
											</button>
										</span>
									))}
								</div>
							)}
							<p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-neutral-400">
								Add
							</p>
							{available.length === 0 ? (
								<p className="text-xs text-neutral-400">
									No more built-in references — upload one instead.
								</p>
							) : (
								<div className="flex flex-wrap gap-2">
									{available.map((name) => (
										<button
											key={name}
											onClick={() => attach(name)}
											title={name}
											className="relative h-14 w-14 overflow-hidden rounded-lg border border-neutral-200 bg-white transition hover:border-amber-500"
										>
											<img
												src={refUrl(name)}
												alt={name}
												className="h-full w-full object-contain"
											/>
											<span className="absolute bottom-0 right-0 flex h-4 w-4 items-center justify-center rounded-tl-md bg-neutral-900 text-white">
												<LuPlus className="h-3 w-3" />
											</span>
										</button>
									))}
								</div>
							)}
						</div>
					)}

					{/* Filter / config panel */}
					{panel === "filter" && (
						<div className="absolute left-6 right-6 top-full z-30 mt-1 rounded-xl border border-neutral-200 bg-white p-4 shadow-xl sm:left-auto sm:right-6 sm:w-[520px]">
							<div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
								<Select label="model" value={model} options={MODELS} onChange={setModel} />
								<Select label="size" value={size} options={SIZES} onChange={setSize} />
								<Select label="quality" value={quality} options={QUALITIES} onChange={setQuality} />
								<Select
									label="background"
									value={background}
									options={BACKGROUNDS}
									onChange={setBackground}
								/>
								<Select label="format" value={format} options={FORMATS} onChange={setFormat} />
								{format !== "png" && (
									<Select
										label="compression"
										value={compression}
										options={COMPRESSIONS}
										onChange={setCompression}
									/>
								)}
								<Select
									label="moderation"
									value={moderation}
									options={MODERATIONS}
									onChange={setModeration}
								/>
								{model !== "gpt-image-2" && (
									<Select
										label="fidelity"
										value={fidelity}
										options={FIDELITIES}
										onChange={setFidelity}
									/>
								)}
								<Select label="count" value={count} options={COUNTS} onChange={setCount} />
							</div>
							<p className="mt-3 border-t border-neutral-100 pt-3 text-xs text-neutral-400">
								{attached.length} reference{attached.length === 1 ? "" : "s"} · est ~$
								{est.toFixed(2)}
							</p>
						</div>
					)}
				</div>
			</div>

			{/* ── Gallery ─────────────────────────────────────────────────────── */}
			<div className="mx-auto max-w-[1100px] px-6 py-6">
				{gallery.length === 0 && pending === 0 && (
					<p className="text-sm text-neutral-400">
						Nothing yet — describe something above and hit generate.
					</p>
				)}
				<div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-3">
					{jobs.flatMap((job) =>
						Array.from({ length: job.count }).map((_, i) => (
							<div
								key={`${job.id}-${i}`}
								className="aspect-square animate-pulse rounded-xl bg-neutral-200"
							/>
						)),
					)}
					{gallery.map((g) => (
						<figure
							key={g.id}
							className="group relative overflow-hidden rounded-xl border border-neutral-200 bg-white"
						>
							<button onClick={() => setLightbox(g)} className="block w-full">
								<img
									src={graphicUrl(g.file)}
									alt={g.prompt}
									className="aspect-square w-full bg-neutral-50 object-cover"
								/>
							</button>
							<figcaption className="pointer-events-none absolute inset-x-0 bottom-0 translate-y-full bg-gradient-to-t from-black/80 to-transparent p-2 opacity-0 transition group-hover:translate-y-0 group-hover:opacity-100">
								<p className="line-clamp-2 text-[11px] leading-snug text-white/90">{g.prompt}</p>
								<button
									onClick={() => reuse(g)}
									className="pointer-events-auto mt-1 text-[11px] font-medium text-amber-300"
								>
									reuse prompt →
								</button>
							</figcaption>
						</figure>
					))}
				</div>
			</div>

			{lightbox && (
				<div
					onClick={() => setLightbox(null)}
					className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-8"
				>
					{/* Prev — arrow keys work too */}
					<button
						onClick={(e) => {
							e.stopPropagation();
							step(-1);
						}}
						disabled={lbIndex <= 0}
						aria-label="previous"
						className="absolute left-4 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/20 disabled:pointer-events-none disabled:opacity-20"
					>
						<LuChevronLeft className="h-6 w-6" />
					</button>

					<div
						onClick={(e) => e.stopPropagation()}
						className="flex max-h-full max-w-3xl flex-col gap-3 rounded-xl bg-white p-4"
					>
						<img
							src={graphicUrl(lightbox.file)}
							alt={lightbox.prompt}
							className="max-h-[70vh] w-auto rounded-lg bg-neutral-50 object-contain"
						/>
						<p className="text-sm text-neutral-600">{lightbox.prompt}</p>
						<div className="flex items-center gap-3 text-xs text-neutral-400">
							<span>{lightbox.size}</span>
							<span>·</span>
							<span>{lightbox.quality}</span>
							<span>·</span>
							<span>{new Date(lightbox.createdAt).toLocaleString()}</span>
							<span className="ml-auto tabular-nums">
								{lbIndex + 1} / {gallery.length}
							</span>
							<button
								onClick={() => {
									reuse(lightbox);
									setLightbox(null);
								}}
								className="font-medium text-amber-600"
							>
								reuse prompt →
							</button>
						</div>
					</div>

					{/* Next */}
					<button
						onClick={(e) => {
							e.stopPropagation();
							step(1);
						}}
						disabled={lbIndex >= gallery.length - 1}
						aria-label="next"
						className="absolute right-4 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/20 disabled:pointer-events-none disabled:opacity-20"
					>
						<LuChevronRight className="h-6 w-6" />
					</button>
				</div>
			)}
		</div>
	);
}
