# Move chat to GPT-5.6 Sol (low) + upgrade transcription

## Goal
- **Chat model:** Anthropic `claude-sonnet-4-5` → OpenAI **`gpt-5.6-sol`** with
  `reasoningEffort: 'low'` (Responses API).
- **Transcription:** `gpt-4o-mini-transcribe` → **`gpt-4o-transcribe`** (better accuracy,
  ~$0.006/min, same OpenAI integration).
- **Web search:** it was an *Anthropic server-side* tool. Port it to OpenAI's native
  `web_search` (Responses API) so search keeps working under the new model.

## Why this is more than a config swap
`web_search`/`web_fetch` are provider-executed (`anthropic.tools.webSearch_20250305`).
Under an OpenAI model those tool schemas can't attach, so search must move to
`openai.tools.webSearch`. OpenAI's web search subsumes page fetching, so the separate
`web_fetch` tool goes away (its openPage/findInPage actions live inside web_search).

## Changes
1. **`packages/server/src/model.ts`**
   - `createModel` → `wrapLanguageModel(openai.responses('gpt-5.6-sol'), defaultSettingsMiddleware({ providerOptions: { openai: { reasoningEffort: 'low' } } }))`.
   - `createTranscriptionModel` default → `gpt-4o-transcribe`.
2. **`packages/shared/app/src/tools/search.ts`**
   - `buildSearchProviderTools` → `openai.tools.webSearch({ searchContextSize, userLocation })`.
   - Drop `web_fetch` from the provider set (keep constant for accounting).
   - Update Anthropic-specific comments.
3. **`packages/server/src/chat/turn.ts`**
   - `webSearchSources` reads OpenAI output shape (`output.sources[].url`; no title).
   - Replace `webSearchRequestsOf(anthropic meta)` with a count of web_search provider results.
   - `PROVIDER_TOOL_NAMES` → just `web_search`. Update pause/location comments.
4. **`packages/server/src/checkins/engine.ts`**
   - Opener's inline `anthropic.tools.webSearch_20250305` → `openai.tools.webSearch`.
5. **`packages/shared/app/src/tools/types.ts`** — provider-neutral comments.
6. **`packages/shared/app/package.json`** — add `@ai-sdk/openai`; `pnpm install`.
7. **`tests/web-search.test.ts`** — use OpenAI web_search output shape; drop web_fetch/encrypted-blob
   assertions (OpenAI has neither); request count comes from result count.

## Verify
- `pnpm -w typecheck`
- `pnpm vitest run tests/web-search.test.ts` (+ related chat tests)
