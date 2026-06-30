import { fileURLToPath, URL } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv, type PluginOption } from "vite";
import { sidekickStudioPlugin } from "./vite-plugin-sidekick";

// Sidekick's voice — a warm, slightly cheeky accountability-buddy sidekick.
const SIDEKICK_SYSTEM = `You are Sidekick, the user's personal "sidekick" inside a self-improvement app.
You text like a close, caring friend: short, casual, lowercase, warm, and a little cheeky.
You keep them on track with everyday goals — water, food, sleep, movement, focus, mood, habits —
celebrating small wins and gently (sometimes bossily) nudging them to take action.
Keep replies to 1-2 short sentences. Sound human and texty, never corporate.
Occasionally ask a quick follow-up. No markdown, no lists; an occasional emoji is fine.`;

// Dev-only proxy so the OpenAI key stays server-side (never shipped to the client).
// POST /api/chat { messages: [{role,content}...] } -> { reply }.
function chatApiPlugin(apiKey: string): PluginOption {
	return {
		name: "sidekick-chat-api",
		configureServer(server) {
			server.middlewares.use("/api/chat", (req, res, next) => {
				if (req.method !== "POST") return next();
				let body = "";
				req.on("data", (c) => (body += c));
				req.on("end", async () => {
					res.setHeader("Content-Type", "application/json");
					if (!apiKey) {
						res.statusCode = 500;
						res.end(JSON.stringify({ error: "OPENAI_API_KEY not set" }));
						return;
					}
					try {
						const { messages = [] } = JSON.parse(body || "{}");
						const full = [{ role: "system", content: SIDEKICK_SYSTEM }, ...messages];
						const r = await fetch("https://api.openai.com/v1/chat/completions", {
							method: "POST",
							headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
							body: JSON.stringify({ model: "gpt-5.5", messages: full }),
						});
						const data = await r.json();
						if (!r.ok) {
							res.statusCode = r.status;
							res.end(JSON.stringify({ error: data?.error?.message ?? "OpenAI error" }));
							return;
						}
						res.end(JSON.stringify({ reply: data.choices?.[0]?.message?.content ?? "" }));
					} catch (e) {
						res.statusCode = 500;
						res.end(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }));
					}
				});
			});
		},
	};
}

export default defineConfig(({ mode }) => {
	const env = loadEnv(mode, process.cwd(), "");
	return {
		plugins: [
			react(),
			chatApiPlugin(env.OPENAI_API_KEY ?? ""),
			sidekickStudioPlugin(env.OPENAI_API_KEY ?? ""),
		],
		resolve: {
			alias: {
				"~": fileURLToPath(new URL("./src", import.meta.url)),
			},
		},
		server: { port: 3100 },
	};
});
