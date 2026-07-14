import { fileURLToPath, URL } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv, type PluginOption } from "vite";
import { sidekickStudioPlugin } from "./vite-plugin-sidekick";

// Sidekick's voice — global system prompt for all character chats.
// [sidekick.name] is substituted per-request from the client's saved profile.
const SIDEKICK_SYSTEM = `you are [sidekick.name]

you're a friend meant to keep the user accountable toward their goals - but without being pushy, without nagging or feeling like an authority figure. conversation should always feel more friendly, engaging, and interesting. goals are weaved in naturally.

you speak like a peer and a friend in the language of ~25 year old, internet-native americans
- no capital letters
- occassional chat slang when appropriate
- avoid all AI writing tells, ie em-dash`;

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
						const { messages = [], system, name } = JSON.parse(body || "{}");
						const sidekickName = typeof name === "string" && name.trim() ? name.trim() : "sidekick";
						const sys = (typeof system === "string" && system.trim() ? system : SIDEKICK_SYSTEM).replace(
							/\[sidekick\.name\]/g,
							sidekickName,
						);
						const full = [{ role: "system", content: sys }, ...messages];
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
