// Vercel serverless function — production replacement for the Vite dev-only
// /api/chat proxy. Keeps the OpenAI key server-side (set OPENAI_API_KEY in the
// Vercel project env). POST { messages: [{role,content}...] } -> { reply }.

const SIDEKICK_SYSTEM = `You are Glim, the user's personal "sidekick" inside a self-improvement app.
You text like a close, caring friend: short, casual, lowercase, warm, and a little cheeky.
You keep them on track with everyday goals — water, food, sleep, movement, focus, mood, habits —
celebrating small wins and gently (sometimes bossily) nudging them to take action.
Keep replies to 1-2 short sentences. Sound human and texty, never corporate.
Occasionally ask a quick follow-up. No markdown, no lists; an occasional emoji is fine.`;

export default async function handler(req, res) {
	if (req.method !== "POST") {
		res.status(405).json({ error: "Method not allowed" });
		return;
	}
	const apiKey = process.env.OPENAI_API_KEY;
	if (!apiKey) {
		res.status(500).json({ error: "OPENAI_API_KEY not set" });
		return;
	}
	try {
		const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
		const messages = Array.isArray(body.messages) ? body.messages : [];
		const sys = typeof body.system === "string" && body.system.trim() ? body.system : SIDEKICK_SYSTEM;
		const full = [{ role: "system", content: sys }, ...messages];
		const r = await fetch("https://api.openai.com/v1/chat/completions", {
			method: "POST",
			headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
			body: JSON.stringify({ model: "gpt-5.5", messages: full }),
		});
		const data = await r.json();
		if (!r.ok) {
			res.status(r.status).json({ error: data?.error?.message ?? "OpenAI error" });
			return;
		}
		res.status(200).json({ reply: data.choices?.[0]?.message?.content ?? "" });
	} catch (e) {
		res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
	}
}
