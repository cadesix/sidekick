import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModel, TranscriptionModel } from "ai";
import type { ServerEnv } from "./env";

/**
 * The chat model, resolved from env (01-architecture.md: model id from env, via
 * the Vercel AI SDK). Tests never call this — they inject a MockLanguageModelV2.
 */
export function createModel(env: ServerEnv): LanguageModel {
  const anthropic = createAnthropic({ apiKey: env.ANTHROPIC_API_KEY });
  return anthropic(env.SIDEKICK_CHAT_MODEL ?? "claude-sonnet-4-5");
}

/**
 * The voice-note transcription model (09 §audio). OpenAI `gpt-4o-mini-transcribe`
 * by default; null when no OpenAI key is configured, in which case audio ingest
 * fails gracefully. Tests inject a MockTranscriptionModelV2.
 */
export function createTranscriptionModel(env: ServerEnv): TranscriptionModel | undefined {
  if (!env.OPENAI_API_KEY) {
    return undefined;
  }
  const openai = createOpenAI({ apiKey: env.OPENAI_API_KEY });
  return openai.transcription(env.SIDEKICK_TRANSCRIBE_MODEL ?? "gpt-4o-mini-transcribe");
}

/** The model id we persist on messages/summaries, from either model form. */
export function modelName(model: LanguageModel): string {
  return typeof model === "string" ? model : model.modelId;
}
