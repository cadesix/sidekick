import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { type LanguageModel, type TranscriptionModel, simulateReadableStream } from "ai";
import { MockLanguageModelV2, MockTranscriptionModelV2 } from "ai/test";
import {
  conversations,
  type Database,
  notificationPreferences,
  users,
} from "@sidekick/db";
import {
  type AdDeviceSignals,
  type AdNetworkClient,
  type AuthEmailSender,
  LocalStorage,
  type SmsSender,
  type Storage,
  appRouter,
  type BackgroundScheduler,
  createSession,
} from "@sidekick/server";

/**
 * A scripted model that streams one fixed reply — the sanctioned test fake
 * (AI SDK test model), the only stand-in for Anthropic since CI can't call it.
 */
export function textModel(text: string): LanguageModel {
  return new MockLanguageModelV2({
    doStream: async () => ({
      stream: simulateReadableStream({
        chunks: [
          { type: "text-start", id: "0" },
          { type: "text-delta", id: "0", delta: text },
          { type: "text-end", id: "0" },
          {
            type: "finish",
            finishReason: "stop",
            usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
          },
        ],
      }),
    }),
  });
}

/**
 * A scripted model for `generateText`/`generateObject` (the compaction and
 * extraction jobs call `doGenerate`, not `doStream`). Returns one fixed body.
 */
export function generateModel(text: string): LanguageModel {
  return new MockLanguageModelV2({
    doGenerate: async () => ({
      finishReason: "stop",
      usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
      content: [{ type: "text", text }],
      warnings: [],
    }),
  });
}

/** A scripted model whose body is a JSON object — drives `generateObject`. */
export function objectModel(value: unknown): LanguageModel {
  return generateModel(JSON.stringify(value));
}

/** A scripted transcription model returning one fixed transcript (09 §audio). */
export function transcriptionModel(text: string): TranscriptionModel {
  return new MockTranscriptionModelV2({
    doGenerate: async () => ({
      text,
      segments: [],
      language: "en",
      durationInSeconds: 3,
      warnings: [],
      response: { timestamp: new Date(0), modelId: "mock-transcribe", headers: {} },
    }),
  });
}

/** A throwaway on-disk object store for tests — real `LocalStorage`, no mock. */
export function testStorage(): Storage {
  return new LocalStorage(join(tmpdir(), `sidekick-blob-${randomUUID()}`), "http://test.local");
}

export type CallerOverrides = {
  scheduleBackground?: BackgroundScheduler;
  storage?: Storage;
  captionModel?: LanguageModel;
  transcriptionModel?: TranscriptionModel;
  adNetwork?: AdNetworkClient | null;
  authEmail?: AuthEmailSender;
  sms?: SmsSender;
  device?: AdDeviceSignals;
  installationId?: string;
};

export function makeCaller(
  db: Database,
  model: LanguageModel,
  userId: string | null,
  overrides: BackgroundScheduler | CallerOverrides = {},
) {
  const opts: CallerOverrides =
    typeof overrides === "function" ? { scheduleBackground: overrides } : overrides;
  return appRouter.createCaller({
    db,
    model,
    flags: {},
    userId,
    sessionId: null,
    scheduleBackground: opts.scheduleBackground ?? (() => {}),
    storage: opts.storage ?? testStorage(),
    captionModel: opts.captionModel ?? model,
    transcriptionModel: opts.transcriptionModel,
    adNetwork: opts.adNetwork ?? null,
    authEmail: opts.authEmail ?? { sendOtp: async () => {} },
    sms: opts.sms ?? { sendCode: async () => {}, verifyCode: async () => false },
    device: opts.device,
    installationId: opts.installationId,
  });
}

/**
 * Seed a bare signed-in user (+ notification preferences), the way a fresh
 * sign-in does. Returns the userId — the credential tests build on.
 */
export async function createUser(db: Database): Promise<string> {
  const inserted = await db.insert(users).values({}).returning({ id: users.id });
  const user = inserted[0];
  if (!user) {
    throw new Error("failed to create user");
  }
  await db.insert(notificationPreferences).values({ userId: user.id });
  return user.id;
}

/** A signed-in user plus a live session token for it. */
export async function createUserSession(
  db: Database,
): Promise<{ userId: string; token: string }> {
  const userId = await createUser(db);
  const { token } = await createSession(db, userId);
  return { userId, token };
}

export async function createConversation(db: Database, userId: string): Promise<string> {
  const inserted = await db
    .insert(conversations)
    .values({ userId, kind: "main" })
    .returning({ id: conversations.id });
  const row = inserted[0];
  if (!row) {
    throw new Error("failed to create conversation");
  }
  return row.id;
}
