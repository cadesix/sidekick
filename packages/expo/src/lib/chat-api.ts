import type { Msg } from '../store/chat';

// The web app proxied /api/chat → OpenAI (key + system prompt server-side, see
// sidekick/vite.config.ts). On mobile there's no server in v1: if an OpenAI key
// is provided via env (EXPO_PUBLIC_OPENAI_API_KEY) we call the API directly;
// otherwise we fall back to a canned reply so the UI is fully usable offline.
//
// NOTE: a public/bundled key is fine for local dev only. For production, put a
// tiny proxy in front (matching the sans apps' tRPC backend) and call that.

const SYSTEM_PROMPT =
  "You are Sidekick, a warm, upbeat pocket companion. Keep replies short, casual, " +
  'and caring — like texting a good friend. Nudge gently toward healthy habits.';

const KEY = process.env.EXPO_PUBLIC_OPENAI_API_KEY;

const CANNED = [
  "love that. tell me more? 👀",
  "ok noted! have you had any water yet today?",
  "you've got this — one small step at a time 💪",
  "hmm, want to break that down together?",
  "proud of you for even thinking about it 🙌",
];

export async function fetchReply(messages: Msg[]): Promise<string> {
  if (!KEY) {
    // deterministic-ish canned reply so the flow works with no backend
    const i = messages.filter((m) => m.role === 'user').length % CANNED.length;
    await new Promise((r) => setTimeout(r, 500));
    return CANNED[i];
  }
  try {
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${KEY}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...messages],
        max_tokens: 200,
      }),
    });
    const data = await r.json();
    const reply = data?.choices?.[0]?.message?.content;
    return typeof reply === 'string' && reply.trim()
      ? reply.trim()
      : 'hmm, i blanked for a sec — say that again?';
  } catch {
    return 'ugh, connection hiccup. try again?';
  }
}
