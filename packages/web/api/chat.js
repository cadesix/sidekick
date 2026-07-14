// Vercel serverless function — production replacement for the Vite dev-only
// /api/chat proxy. Keeps the OpenAI key server-side (set OPENAI_API_KEY in the
// Vercel project env). POST { messages: [{role,content}...] } -> { reply }.

// [sidekick.name] is substituted per-request from the client's saved profile.
const SIDEKICK_SYSTEM = `you are [sidekick.name]

you're a friend meant to keep the user accountable toward their goals - but without being pushy, without nagging or feeling like an authority figure. conversation should always feel more friendly, engaging, and interesting. goals are weaved in naturally.

you speak like a peer and a friend in the language of ~25 year old, internet-native americans
- no capital letters
- occassional chat slang when appropriate
- avoid all AI writing tells, ie em-dash`;

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
		const sidekickName = typeof body.name === "string" && body.name.trim() ? body.name.trim() : "sidekick";
		const sys = (typeof body.system === "string" && body.system.trim() ? body.system : SIDEKICK_SYSTEM).replaceAll(
			"[sidekick.name]",
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
			res.status(r.status).json({ error: data?.error?.message ?? "OpenAI error" });
			return;
		}
		res.status(200).json({ reply: data.choices?.[0]?.message?.content ?? "" });
	} catch (e) {
		res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
	}
}
