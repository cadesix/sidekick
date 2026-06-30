import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { basename, extname, join, resolve } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { PluginOption } from "vite";

// Dev-only "Sidekick Studio" backend. Mirrors the /api/chat plugin: the OpenAI
// key stays server-side and never reaches the client. Wraps OpenAI's images/edits
// endpoint (the same call the /illustrate skill makes) so we can iterate on
// on-model Sidekick renders from a browser UI and keep a persistent gallery.

const ROOT = process.cwd();
const ILLUSTRATE = resolve(ROOT, ".illustrate");
const REFS_DIR = join(ILLUSTRATE, "refs");
const STUDIO_DIR = join(ILLUSTRATE, "studio");
const SHEETS_DIR = join(STUDIO_DIR, "sheets");
const MANIFEST = join(STUDIO_DIR, "manifest.json");
const SHEETS_MANIFEST = join(SHEETS_DIR, "sheets.json");
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

async function handleGenerate(req: IncomingMessage, res: ServerResponse, apiKey: string) {
	if (!apiKey) return json(res, 500, { error: "OPENAI_API_KEY not set" });
	let payload: {
		prompt?: string;
		refs?: string[];
		size?: string;
		quality?: string;
		n?: number;
		kind?: "pose" | "sheet";
	};
	try {
		payload = JSON.parse((await readBody(req)) || "{}");
	} catch {
		return json(res, 400, { error: "invalid JSON body" });
	}
	const prompt = (payload.prompt ?? "").trim();
	if (!prompt) return json(res, 400, { error: "prompt is required" });

	// Sheet iterations live in their own dir/manifest so the version history of
	// the source-of-truth turnaround stays separate from one-off pose renders.
	const isSheet = payload.kind === "sheet";
	const outDir = isSheet ? SHEETS_DIR : STUDIO_DIR;
	const manifestPath = isSheet ? SHEETS_MANIFEST : MANIFEST;
	const filePrefix = isSheet ? "sheet" : "sidekick";

	const size = payload.size || "1024x1024";
	const quality = payload.quality || "high";
	const n = Math.min(4, Math.max(1, payload.n ?? 1));
	const refNames = (payload.refs ?? [])
		.map((r) => basename(r))
		.filter((r) => existsSync(join(REFS_DIR, r)));

	const form = new FormData();
	form.append("model", "gpt-image-2");
	form.append("prompt", prompt);
	form.append("size", size);
	form.append("quality", quality);
	form.append("n", String(n));
	form.append("output_format", "png");
	form.append("background", "opaque");
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
				model: "gpt-image-2",
				prompt,
				size,
				quality,
				n,
				output_format: "png",
				background: "opaque",
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
	for (const d of data.data) {
		const id = randomUUID().slice(0, 8);
		const file = `${filePrefix}-${id}.png`;
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
					if (req.method === "GET" && url === "/sheets") return await handleSheets(res);
					if (req.method === "GET" && url.startsWith("/ref/"))
						return await serveImage(res, REFS_DIR, decodeURIComponent(url.slice(5)));
					if (req.method === "GET" && url.startsWith("/out/"))
						return await serveImage(res, STUDIO_DIR, decodeURIComponent(url.slice(5)));
					if (req.method === "GET" && url.startsWith("/sheet/"))
						return await serveImage(res, SHEETS_DIR, decodeURIComponent(url.slice(7)));
					if (req.method === "POST" && url === "/generate")
						return await handleGenerate(req, res, apiKey);
					if (req.method === "POST" && url === "/promote")
						return await handlePromote(req, res);
					return next();
				} catch (e) {
					json(res, 500, { error: e instanceof Error ? e.message : String(e) });
				}
			});
		},
	};
}
