import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile, readdir, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, extname, join, resolve } from "node:path";
import { promisify } from "node:util";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { PluginOption } from "vite";

const execFileP = promisify(execFile);

// Dev-only "Sidekick Studio" backend. Mirrors the /api/chat plugin: the OpenAI
// key stays server-side and never reaches the client. Wraps OpenAI's images/edits
// endpoint (the same call the /illustrate skill makes) so we can iterate on
// on-model Sidekick renders from a browser UI and keep a persistent gallery.

const ROOT = process.cwd();
const ILLUSTRATE = resolve(ROOT, ".illustrate");
// Shop product renders posted by the dev-only /item-render route land here,
// where the Shop's product cards pick them up as static assets.
const SHOP_RENDERS_DIR = resolve(ROOT, "public", "shop-renders");
const REFS_DIR = join(ILLUSTRATE, "refs");
const STUDIO_DIR = join(ILLUSTRATE, "studio");
const SHEETS_DIR = join(STUDIO_DIR, "sheets");
const MANIFEST = join(STUDIO_DIR, "manifest.json");
const SHEETS_MANIFEST = join(SHEETS_DIR, "sheets.json");
// Graphic Assets: general on-brand renders (illustrations, hero art, empty-state
// graphics…) kept in their own dir/manifest so they don't mix with pose renders.
const GRAPHICS_DIR = join(STUDIO_DIR, "graphics");
const GRAPHICS_MANIFEST = join(GRAPHICS_DIR, "graphics.json");
// Cosmetics: a simple catalog of generated "looks" (character rendered with an
// outfit / accessory / environment via the character sheet as reference).
const ASSETS_STORE = join(STUDIO_DIR, "assets.json");
// Species-level guidelines (base model + variability) take precedence as the
// studio's headline spec; Sidekick's instance spec is the fallback.
const SPEC = existsSync(join(ILLUSTRATE, "sidekick-spec.md"))
	? join(ILLUSTRATE, "sidekick-spec.md")
	: join(ILLUSTRATE, "sidekick-spec.md");
const CONFIG = join(ILLUSTRATE, "config.json");
// The canonical character sheet — the neutral base-model proportion reference
// every other generation builds on. Sheet iterations can be promoted to overwrite it.
const CANONICAL_SHEET = join(REFS_DIR, "sidekick-base-sheet.png");

const MIME: Record<string, string> = {
	png: "image/png",
	webp: "image/webp",
	jpg: "image/jpeg",
	jpeg: "image/jpeg",
};

type GenEntry = {
	id: string;
	file: string;
	prompt: string;
	refs: string[];
	size: string;
	quality: string;
	createdAt: string;
};

function json(res: ServerResponse, code: number, body: unknown) {
	res.statusCode = code;
	res.setHeader("Content-Type", "application/json");
	res.end(JSON.stringify(body));
}

function readBody(req: IncomingMessage): Promise<string> {
	return new Promise((resolveBody) => {
		let b = "";
		req.on("data", (c) => (b += c));
		req.on("end", () => resolveBody(b));
	});
}

async function loadManifest(path = MANIFEST): Promise<GenEntry[]> {
	if (!existsSync(path)) return [];
	try {
		return JSON.parse(await readFile(path, "utf-8"));
	} catch {
		return [];
	}
}

async function serveImage(res: ServerResponse, dir: string, name: string) {
	// basename() prevents path traversal out of the intended directory.
	const file = join(dir, basename(name));
	if (!existsSync(file)) return json(res, 404, { error: "not found" });
	const ext = extname(file).slice(1).toLowerCase();
	res.statusCode = 200;
	res.setHeader("Content-Type", MIME[ext] ?? "application/octet-stream");
	res.setHeader("Cache-Control", "no-cache");
	res.end(await readFile(file));
}

async function listRefs(): Promise<string[]> {
	if (!existsSync(REFS_DIR)) return [];
	const all = await readdir(REFS_DIR);
	return all.filter((f) => /\.(png|webp|jpe?g)$/i.test(f)).sort();
}

async function handleProfile(res: ServerResponse) {
	const refs = await listRefs();
	let styleGuide = "";
	let palette: Record<string, string> = {};
	if (existsSync(CONFIG)) {
		try {
			const cfg = JSON.parse(await readFile(CONFIG, "utf-8"));
			styleGuide = cfg.styleGuide ?? "";
			palette = cfg.iconPalette ?? {};
		} catch {
			/* ignore malformed config */
		}
	}
	const spec = existsSync(SPEC) ? await readFile(SPEC, "utf-8") : "";
	// Anchor first (pins color/proportions hardest), then the character sheet.
	const ordered = [
		...refs.filter((r) => r.includes("anchor")),
		...refs.filter((r) => r.includes("character-sheet")),
		...refs.filter((r) => !r.includes("anchor") && !r.includes("character-sheet")),
	];
	json(res, 200, { styleGuide, spec, palette, refs: ordered });
}

// ---- Cosmetics catalog + hero-pose pipeline --------------------------------
// A "look" is a 4-step pipeline off a single base plate (the hero-pose character):
// base → generation (masked edit) → isolation (item cutout) → superimpose (item on base).
// A masked edit never redraws the base, so the item lands in the base's exact
// coordinates. `masks` holds a per-slot region (fractions of the frame) where each
// slot's items get inpainted. Items are stored verbatim; the client owns their shape.
type Region = { x: number; y: number; w: number; h: number };
type Store = {
	basePlate?: string;
	masks?: Record<string, Region>;
	items: Record<string, unknown>[];
};

async function loadStore(): Promise<Store> {
	if (!existsSync(ASSETS_STORE)) return { items: [] };
	try {
		const s = JSON.parse(await readFile(ASSETS_STORE, "utf-8")) as Store;
		return { basePlate: s.basePlate, masks: s.masks ?? {}, items: s.items ?? [] };
	} catch {
		return { items: [] };
	}
}

async function writeStore(store: Store) {
	await mkdir(STUDIO_DIR, { recursive: true });
	await writeFile(ASSETS_STORE, JSON.stringify(store, null, 2));
}

// Resolve an image name to a path, checking refs (base plates) then studio outputs.
function resolveImage(name: string): string | null {
	const b = basename(name);
	for (const dir of [REFS_DIR, STUDIO_DIR]) {
		const p = join(dir, b);
		if (existsSync(p)) return p;
	}
	return null;
}

async function handleAssets(res: ServerResponse) {
	json(res, 200, await loadStore());
}

// Persist the catalog. The client owns the full list it sends (base plate is set
// separately via /set-base, and preserved here).
async function handleAssetsSave(req: IncomingMessage, res: ServerResponse) {
	let payload: Partial<Store>;
	try {
		payload = JSON.parse((await readBody(req)) || "{}");
	} catch {
		return json(res, 400, { error: "invalid JSON body" });
	}
	const store = await loadStore();
	if (Array.isArray(payload.items)) store.items = payload.items;
	if (payload.masks && typeof payload.masks === "object") store.masks = payload.masks;
	await writeStore(store);
	json(res, 200, store);
}

// Set the hero-pose base plate from an uploaded image. It lives in REFS_DIR so it
// can be passed to generation as the reference we edit *from* (→ aligned frame).
async function handleSetBase(req: IncomingMessage, res: ServerResponse) {
	let payload: { dataUrl?: string };
	try {
		payload = JSON.parse((await readBody(req)) || "{}");
	} catch {
		return json(res, 400, { error: "invalid JSON body" });
	}
	const m = /^data:image\/(png|webp|jpe?g);base64,(.+)$/s.exec(payload.dataUrl ?? "");
	if (!m) return json(res, 400, { error: "expected a base64 png/webp/jpg image data URL" });
	const ext = m[1] === "jpeg" ? "jpg" : m[1];
	const name = `base-plate-${randomUUID().slice(0, 8)}.${ext}`;
	await mkdir(REFS_DIR, { recursive: true });
	await writeFile(join(REFS_DIR, name), Buffer.from(m[2], "base64"));
	const store = await loadStore();
	store.basePlate = name;
	await writeStore(store);
	json(res, 200, { basePlate: name });
}

const tmpFile = (tag: string) => join(tmpdir(), `sk-${randomUUID().slice(0, 8)}-${tag}.png`);

// The masked item pipeline. A region (fractions of the frame) marks where the item
// goes. We build a mask (transparent = editable) so a gpt-image masked edit adds the
// item there while leaving the base untouched (→ item lands in the base's exact
// coordinates). Then: drift-guard (did it honor the mask?), key the fill out of the
// region → item layer, superimpose onto the base. Returns the 4 pipeline stages.
async function handleMakeItem(req: IncomingMessage, res: ServerResponse, apiKey: string) {
	if (!apiKey) return json(res, 500, { error: "OPENAI_API_KEY not set" });
	let payload: {
		base?: string;
		region?: Region;
		desc?: string;
		model?: string;
		quality?: string;
	};
	try {
		payload = JSON.parse((await readBody(req)) || "{}");
	} catch {
		return json(res, 400, { error: "invalid JSON body" });
	}
	const basePath = payload.base ? resolveImage(payload.base) : null;
	if (!basePath) return json(res, 404, { error: "base plate not found" });
	const region = payload.region;
	if (!region || region.w <= 0 || region.h <= 0) {
		return json(res, 400, { error: "a mask region is required" });
	}
	const desc = (payload.desc ?? "").trim();
	if (!desc) return json(res, 400, { error: "item description is required" });
	const model = payload.model || "gpt-image-2";
	const quality = payload.quality || "high";

	const id = randomUUID().slice(0, 8);
	const genFile = `sidekick-${id}.png`;
	const isoFile = `isolation-${id}.png`;
	const superFile = `superimpose-${id}.png`;
	const genPath = join(STUDIO_DIR, genFile);
	const isoPath = join(STUDIO_DIR, isoFile);
	const superPath = join(STUDIO_DIR, superFile);
	const tRegion = tmpFile("region");
	const tMask = tmpFile("mask");
	const tBaseFlat = tmpFile("basef");
	const tGenFlat = tmpFile("genf");
	const tOut = tmpFile("outmask");
	const tDiff = tmpFile("diff");
	await mkdir(STUDIO_DIR, { recursive: true });
	try {
		const { stdout } = await execFileP("magick", ["identify", "-format", "%w %h", basePath]);
		const [W, H] = stdout.trim().split(" ").map(Number);
		const x1 = Math.round(region.x * W);
		const y1 = Math.round(region.y * H);
		const x2 = Math.round((region.x + region.w) * W);
		const y2 = Math.round((region.y + region.h) * H);
		// region: white rect on black (used for region-restrict + drift outside-mask)
		await execFileP("magick", [
			"-size", `${W}x${H}`, "xc:black", "-fill", "white",
			"-draw", `rectangle ${x1},${y1} ${x2},${y2}`, tRegion,
		]);
		// OpenAI mask: transparent (alpha 0) where editable → the rect is transparent.
		await execFileP("magick", [
			"-size", `${W}x${H}`, "xc:white",
			"(", tRegion, "-negate", ")", "-alpha", "off", "-compose", "CopyOpacity", "-composite", tMask,
		]);

		// Masked edit. Keep the prompt simple — extra fill instructions make the model
		// ignore the mask and regenerate the whole frame.
		const prompt = `Add ${desc}, worn naturally and correctly positioned on the character. Do not change anything else.`;
		const form = new FormData();
		form.append("model", model);
		form.append("prompt", prompt);
		form.append("size", `${W}x${H}`);
		form.append("quality", quality);
		form.append("n", "1");
		form.append("output_format", "png");
		const baseBuf = await readFile(basePath);
		const maskBuf = await readFile(tMask);
		form.append("image", new Blob([baseBuf], { type: "image/png" }), "base.png");
		form.append("mask", new Blob([maskBuf], { type: "image/png" }), "mask.png");
		const apiRes = await fetch("https://api.openai.com/v1/images/edits", {
			method: "POST",
			headers: { Authorization: `Bearer ${apiKey}` },
			body: form,
		});
		if (!apiRes.ok) {
			const text = await apiRes.text();
			return json(res, apiRes.status, { error: `OpenAI ${apiRes.status}: ${text}` });
		}
		const data = await apiRes.json();
		if (!data.data?.length) return json(res, 502, { error: "no image returned" });
		await writeFile(genPath, Buffer.from(data.data[0].b64_json, "base64"));

		// Drift-guard: how much did the area OUTSIDE the mask change vs the base? High
		// means the model ignored the mask and redrew the character (coords broken).
		await execFileP("magick", [basePath, "-alpha", "off", "-colorspace", "sRGB", "-resize", `${W}x${H}!`, tBaseFlat]);
		await execFileP("magick", [genPath, "-alpha", "off", "-colorspace", "sRGB", "-resize", `${W}x${H}!`, tGenFlat]);
		await execFileP("magick", [tRegion, "-negate", tOut]);
		await execFileP("magick", [tBaseFlat, tGenFlat, "-compose", "difference", "-composite", "-colorspace", "Gray", tDiff]);
		await execFileP("magick", [tDiff, tOut, "-compose", "multiply", "-composite", tDiff]);
		const { stdout: driftOut } = await execFileP("magick", [tDiff, "-format", "%[fx:mean*100]", "info:"]);
		const drift = Number(driftOut.trim()) || 0;

		// Isolate: keep only the region, key the (black) fill out → item layer.
		await execFileP("magick", [genPath, tRegion, "-alpha", "off", "-compose", "CopyOpacity", "-composite", "-colorspace", "sRGB", tGenFlat]);
		await execFileP("magick", [tGenFlat, "-fuzz", "30%", "-transparent", "black", "-colorspace", "sRGB", isoPath]);
		// Superimpose the item layer onto the untouched base.
		await execFileP("magick", [basePath, "-alpha", "off", "-colorspace", "sRGB", isoPath, "-compose", "over", "-composite", "-colorspace", "sRGB", superPath]);

		json(res, 200, {
			generation: genFile,
			isolation: isoFile,
			superimpose: superFile,
			drift: Math.round(drift * 100) / 100,
		});
	} catch (e) {
		json(res, 500, { error: `make-item failed: ${e instanceof Error ? e.message : String(e)}` });
	} finally {
		await Promise.all(
			[tRegion, tMask, tBaseFlat, tGenFlat, tOut, tDiff].map((f) => unlink(f).catch(() => {})),
		);
	}
}

// Accept a user-uploaded reference image (base64 data URL) and save it into
// REFS_DIR so it can be passed to generation like any built-in reference.
async function handleUploadRef(req: IncomingMessage, res: ServerResponse) {
	let payload: { dataUrl?: string };
	try {
		payload = JSON.parse((await readBody(req)) || "{}");
	} catch {
		return json(res, 400, { error: "invalid JSON body" });
	}
	const m = /^data:image\/(png|webp|jpe?g);base64,(.+)$/s.exec(payload.dataUrl ?? "");
	if (!m) return json(res, 400, { error: "expected a base64 png/webp/jpg image data URL" });
	const ext = m[1] === "jpeg" ? "jpg" : m[1];
	const name = `upload-${randomUUID().slice(0, 8)}.${ext}`;
	await mkdir(REFS_DIR, { recursive: true });
	await writeFile(join(REFS_DIR, name), Buffer.from(m[2], "base64"));
	json(res, 200, { name });
}

async function handleGenerate(req: IncomingMessage, res: ServerResponse, apiKey: string) {
	if (!apiKey) return json(res, 500, { error: "OPENAI_API_KEY not set" });
	let payload: {
		prompt?: string;
		refs?: string[];
		size?: string;
		quality?: string;
		n?: number;
		kind?: "pose" | "sheet" | "asset";
		model?: string; // "gpt-image-2" (default) | "gpt-image-1.5"
		background?: string; // "opaque" (default) | "transparent" | "auto"
		outputFormat?: string; // "png" (default) | "jpeg" | "webp"
		outputCompression?: number; // 0–100, jpeg/webp only
		moderation?: string; // "auto" (default) | "low"
		inputFidelity?: string; // "high" — gpt-image-1.5 only, strongest consistency lever
	};
	try {
		payload = JSON.parse((await readBody(req)) || "{}");
	} catch {
		return json(res, 400, { error: "invalid JSON body" });
	}
	const prompt = (payload.prompt ?? "").trim();
	if (!prompt) return json(res, 400, { error: "prompt is required" });

	// Sheet iterations and graphic assets each live in their own dir/manifest so
	// their history stays separate from one-off pose renders.
	const kind = payload.kind ?? "pose";
	const outDir = kind === "sheet" ? SHEETS_DIR : kind === "asset" ? GRAPHICS_DIR : STUDIO_DIR;
	const manifestPath =
		kind === "sheet" ? SHEETS_MANIFEST : kind === "asset" ? GRAPHICS_MANIFEST : MANIFEST;
	const filePrefix = kind === "sheet" ? "sheet" : kind === "asset" ? "asset" : "sidekick";

	const size = payload.size || "1024x1024";
	const quality = payload.quality || "high";
	const n = Math.min(10, Math.max(1, payload.n ?? 1));
	const model = payload.model || "gpt-image-2";
	const background = payload.background || "opaque";
	const outputFormat = payload.outputFormat || "png";
	// output_compression only applies to jpeg/webp.
	const compression =
		outputFormat !== "png" && typeof payload.outputCompression === "number"
			? Math.min(100, Math.max(0, payload.outputCompression))
			: undefined;
	const moderation = payload.moderation;
	const refNames = (payload.refs ?? [])
		.map((r) => basename(r))
		.filter((r) => existsSync(join(REFS_DIR, r)));

	const form = new FormData();
	form.append("model", model);
	form.append("prompt", prompt);
	form.append("size", size);
	form.append("quality", quality);
	form.append("n", String(n));
	form.append("output_format", outputFormat);
	form.append("background", background);
	if (compression !== undefined) form.append("output_compression", String(compression));
	if (moderation) form.append("moderation", moderation);
	if (payload.inputFidelity) form.append("input_fidelity", payload.inputFidelity);
	for (const name of refNames) {
		const buf = await readFile(join(REFS_DIR, name));
		const ext = extname(name).slice(1).toLowerCase();
		form.append("image[]", new Blob([buf], { type: MIME[ext] ?? "image/png" }), name);
	}

	// With references we hit images/edits; without, fall back to generations.
	const endpoint = refNames.length
		? "https://api.openai.com/v1/images/edits"
		: "https://api.openai.com/v1/images/generations";

	let apiRes: Response;
	if (refNames.length) {
		apiRes = await fetch(endpoint, {
			method: "POST",
			headers: { Authorization: `Bearer ${apiKey}` },
			body: form,
		});
	} else {
		apiRes = await fetch(endpoint, {
			method: "POST",
			headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
			body: JSON.stringify({
				model,
				prompt,
				size,
				quality,
				n,
				output_format: outputFormat,
				background,
				...(compression !== undefined ? { output_compression: compression } : {}),
				...(moderation ? { moderation } : {}),
				...(payload.inputFidelity ? { input_fidelity: payload.inputFidelity } : {}),
			}),
		});
	}

	if (!apiRes.ok) {
		const text = await apiRes.text();
		return json(res, apiRes.status, { error: `OpenAI ${apiRes.status}: ${text}` });
	}
	const data = await apiRes.json();
	if (!data.data?.length) return json(res, 502, { error: "no images returned" });

	await mkdir(outDir, { recursive: true });
	const manifest = await loadManifest(manifestPath);
	const createdAt = new Date().toISOString();
	const created: GenEntry[] = [];
	const fileExt = outputFormat === "jpeg" ? "jpg" : outputFormat; // png | jpg | webp
	for (const d of data.data) {
		const id = randomUUID().slice(0, 8);
		const file = `${filePrefix}-${id}.${fileExt}`;
		await writeFile(join(outDir, file), Buffer.from(d.b64_json, "base64"));
		created.push({ id, file, prompt, refs: refNames, size, quality, createdAt });
	}
	// Newest first.
	const next = [...created, ...manifest];
	await writeFile(manifestPath, JSON.stringify(next, null, 2));
	json(res, 200, { created, usage: data.usage ?? null });
}

// The character-sheet tab: current canonical sheet + the version history of
// generated iterations.
async function handleSheets(res: ServerResponse) {
	const versions = await loadManifest(SHEETS_MANIFEST);
	const hasCanonical = existsSync(CANONICAL_SHEET);
	json(res, 200, {
		current: hasCanonical ? { name: basename(CANONICAL_SHEET) } : null,
		versions,
	});
}

// Promote a sheet iteration to the canonical character sheet. Backs up the
// existing canonical sheet into the version history once, so the original is
// never lost on the first overwrite.
async function handlePromote(req: IncomingMessage, res: ServerResponse) {
	let payload: { file?: string };
	try {
		payload = JSON.parse((await readBody(req)) || "{}");
	} catch {
		return json(res, 400, { error: "invalid JSON body" });
	}
	const file = payload.file ? basename(payload.file) : "";
	const src = join(SHEETS_DIR, file);
	if (!file || !existsSync(src)) return json(res, 404, { error: "version not found" });

	await mkdir(SHEETS_DIR, { recursive: true });
	const versions = await loadManifest(SHEETS_MANIFEST);
	if (existsSync(CANONICAL_SHEET) && !versions.some((v) => v.id === "original")) {
		const backupFile = "sheet-original.png";
		await copyFile(CANONICAL_SHEET, join(SHEETS_DIR, backupFile));
		versions.push({
			id: "original",
			file: backupFile,
			prompt: "(original canonical sheet, backed up before first promote)",
			refs: [],
			size: "",
			quality: "",
			createdAt: new Date().toISOString(),
		});
		await writeFile(SHEETS_MANIFEST, JSON.stringify(versions, null, 2));
	}
	await copyFile(src, CANONICAL_SHEET);
	json(res, 200, { ok: true, current: { name: basename(CANONICAL_SHEET) } });
}

// Save a product render posted by /item-render: { name, dataUrl } → a PNG in
// public/shop-renders. Names are sanitized to slot-variant / slot-cHEX slugs.
async function handleShopRender(req: IncomingMessage, res: ServerResponse) {
	const { name, dataUrl } = JSON.parse((await readBody(req)) || "{}") as { name?: string; dataUrl?: string };
	const m = /^data:image\/png;base64,(.+)$/.exec(dataUrl ?? "");
	if (!name || !m) return json(res, 400, { error: "expected { name, dataUrl: data:image/png;base64,… }" });
	const safe = name.replace(/[^a-z0-9-]/gi, "");
	await mkdir(SHOP_RENDERS_DIR, { recursive: true });
	await writeFile(join(SHOP_RENDERS_DIR, `${safe}.png`), Buffer.from(m[1], "base64"));
	json(res, 200, { ok: true, file: `/shop-renders/${safe}.png` });
}

export function sidekickStudioPlugin(apiKey: string): PluginOption {
	return {
		name: "sidekick-studio-api",
		configureServer(server) {
			server.middlewares.use("/api/sidekick", async (req, res, next) => {
				const url = (req.url ?? "/").split("?")[0];
				try {
					if (req.method === "GET" && url === "/profile") return await handleProfile(res);
					if (req.method === "GET" && url === "/gallery")
						return json(res, 200, { items: await loadManifest() });
					if (req.method === "GET" && url === "/graphics")
						return json(res, 200, { items: await loadManifest(GRAPHICS_MANIFEST) });
					if (req.method === "GET" && url === "/sheets") return await handleSheets(res);
					if (req.method === "GET" && url === "/assets") return await handleAssets(res);
					if (req.method === "POST" && url === "/assets")
						return await handleAssetsSave(req, res);
					if (req.method === "POST" && url === "/upload-ref")
						return await handleUploadRef(req, res);
					if (req.method === "POST" && url === "/set-base")
						return await handleSetBase(req, res);
					if (req.method === "POST" && url === "/make-item")
						return await handleMakeItem(req, res, apiKey);
					if (req.method === "GET" && url.startsWith("/ref/"))
						return await serveImage(res, REFS_DIR, decodeURIComponent(url.slice(5)));
					if (req.method === "GET" && url.startsWith("/out/"))
						return await serveImage(res, STUDIO_DIR, decodeURIComponent(url.slice(5)));
					if (req.method === "GET" && url.startsWith("/graphic/"))
						return await serveImage(res, GRAPHICS_DIR, decodeURIComponent(url.slice(9)));
					if (req.method === "GET" && url.startsWith("/sheet/"))
						return await serveImage(res, SHEETS_DIR, decodeURIComponent(url.slice(7)));
					if (req.method === "POST" && url === "/generate")
						return await handleGenerate(req, res, apiKey);
					if (req.method === "POST" && url === "/promote")
						return await handlePromote(req, res);
					if (req.method === "POST" && url === "/shop-render")
						return await handleShopRender(req, res);
					return next();
				} catch (e) {
					json(res, 500, { error: e instanceof Error ? e.message : String(e) });
				}
			});
		},
	};
}
