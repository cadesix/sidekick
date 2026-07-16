import { createOpenAI } from "@ai-sdk/openai";
import {
  type LanguageModel,
  type TranscriptionModel,
  defaultSettingsMiddleware,
  wrapLanguageModel,
} from "ai";
import type { ServerEnv } from "./env";

/**
 * The chat model (01-architecture.md): OpenAI `gpt-5.6-sol` on the Responses API
 * with `reasoningEffort: 'low'` baked into the model via middleware so call sites
 * (`streamText`/`generateText`) stay provider-agnostic. Tests never call this —
 * they inject a MockLanguageModelV2.
 */
export function createModel(env: ServerEnv): LanguageModel {
  const openai = createOpenAI({ apiKey: env.OPENAI_API_KEY });
  return wrapLanguageModel({
    model: openai.responses("gpt-5.6-sol"),
    middleware: defaultSettingsMiddleware({
      settings: { providerOptions: { openai: { reasoningEffort: "low" } } },
    }),
  });
}

/**
 * The voice-note transcription model (09 §audio): OpenAI `gpt-4o-transcribe`;
 * null when no OpenAI key is configured, in which case audio ingest fails
 * gracefully. Tests inject a MockTranscriptionModelV2.
 */
export function createTranscriptionModel(env: ServerEnv): TranscriptionModel | undefined {
  if (!env.OPENAI_API_KEY) {
    return undefined;
  }
  const openai = createOpenAI({ apiKey: env.OPENAI_API_KEY });
  return openai.transcription("gpt-4o-transcribe");
}

/** The model id we persist on messages/summaries, from either model form. */
export function modelName(model: LanguageModel): string {
  return typeof model === "string" ? model : model.modelId;
}
