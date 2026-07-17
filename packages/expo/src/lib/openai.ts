const KEY = process.env.EXPO_PUBLIC_OPENAI_API_KEY;
const LLM_TIMEOUT_MS = 20000;

// One OpenAI gpt-4o-mini turn with an inline system prompt → the reply text, or
// null on no-key / error / timeout (callers fall back to a scripted line). Bounded
// by a timeout so a hung request can't freeze the UI. Shared by the guided-session
// runner (SessionChat) and the Star Chat runner — on mobile there's no server, so
// both call OpenAI directly when EXPO_PUBLIC_OPENAI_API_KEY is set.
export async function llm(system: string, user: string, maxTokens = 200): Promise<string | null> {
  return llmChat(system, [{ role: 'user', content: user }], maxTokens);
}

export type ChatMsg = { role: 'user' | 'assistant'; content: string };

// Multi-turn variant of `llm`: an arbitrary system prompt + a running message
// list → the next assistant line. Same gpt-4o-mini / timeout / null-on-failure
// contract as `llm` (which now delegates here). Used by the Chat Lab dev tool to
// iterate on the sidekick voice with a live-editable system prompt.
export async function llmChat(
  system: string,
  messages: ChatMsg[],
  maxTokens = 200,
): Promise<string | null> {
  if (!KEY) return null;
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), LLM_TIMEOUT_MS);
  try {
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'system', content: system }, ...messages],
        max_tokens: maxTokens,
      }),
      signal: ctrl.signal,
    });
    const data = await r.json();
    const reply = data?.choices?.[0]?.message?.content;
    return typeof reply === 'string' && reply.trim() ? reply.trim() : null;
  } catch {
    return null;
  } finally {
    clearTimeout(to);
  }
}
