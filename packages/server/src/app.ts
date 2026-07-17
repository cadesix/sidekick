import { timingSafeEqual } from "node:crypto";
import { trpcServer } from "@hono/trpc-server";
import { createMiddleware } from "hono/factory";
import { attachments } from "@sidekick/db";
import { chatContinueInput, chatSendInput } from "@sidekick/shared";
import { PERSONA_PROMPT } from "@sidekick/shared/prompts";
import { streamText, type ModelMessage } from "ai";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { stream } from "hono/streaming";
import { z } from "zod";
import { beginTurn, continueTurn } from "./chat/turn";
import { buildCheckinCron } from "./checkins/cron";
import { buildRemindersCron } from "./reminders/cron";
import { buildNotificationsCron } from "./notifications/cron";
import { buildProactivityCron } from "./proactivity/cron";
import { runAdDecision } from "./ads/decision";
import { deviceSignalsFromHeaders } from "./ads/gravity";
import { type Services, createRequestContext } from "./context";
import { readEnv } from "./env";
import { runIdleSweep } from "./jobs/idle";
import { runAdProfileSweep } from "./memory/projection";
import { appleMusicEnvFromProcess, mintDeveloperToken } from "./music/dev-token";
import { appRouter } from "./routers";

/**
 * Vercel-cron auth: every `/cron/*` route requires a matching
 * `Authorization: Bearer $CRON_SECRET`. Fails closed — an unset secret locks the
 * routes rather than exposing jobs that mutate data and send pushes.
 */
const cronAuth = createMiddleware(async (c, next) => {
  const secret = readEnv().CRON_SECRET;
  const provided = c.req.header("authorization");
  if (!secret || !provided || !constantTimeEqual(provided, `Bearer ${secret}`)) {
    return c.json({ error: "unauthorized" }, 401);
  }
  return next();
});

/** Length-checked constant-time string compare — avoids leaking a shared secret byte-by-byte via timing. */
function constantTimeEqual(a: string, b: string): boolean {
  const aBytes = Buffer.from(a);
  const bBytes = Buffer.from(b);
  return aBytes.length === bBytes.length && timingSafeEqual(aBytes, bBytes);
}

/**
 * Attachment bytes are user-supplied and served back from this origin, so never
 * echo a content-type a browser will execute: `text/html`/`svg`/`xhtml` are
 * downgraded to an inert `application/octet-stream`. Paired with `nosniff` on the
 * response, this neutralizes stored-XSS while images/audio/pdf still render inline.
 */
function safeContentType(mime: string | undefined): string {
  const resolved = mime ?? "application/octet-stream";
  if (/^(?:text\/html|image\/svg\+xml|application\/xhtml\+xml)/i.test(resolved)) {
    return "application/octet-stream";
  }
  return resolved;
}

/** A single `bytes=` range, clamped to the object; null when absent or unsatisfiable. */
function parseByteRange(
  header: string | undefined,
  size: number,
): { start: number; end: number } | null {
  const match = header?.match(/^bytes=(\d*)-(\d*)$/);
  if (!match || (match[1] === "" && match[2] === "")) {
    return null;
  }
  const suffix = match[1] === "";
  const start = suffix ? Math.max(0, size - Number(match[2])) : Number(match[1]);
  const end = suffix || match[2] === "" ? size - 1 : Math.min(Number(match[2]), size - 1);
  if (start > end || start >= size) {
    return null;
  }
  return { start, end };
}

/**
 * Read a request body into memory but abort past `maxBytes`, so an oversized
 * upload can't balloon server memory even when it lies about (or omits)
 * `content-length`. Returns null once the cap is exceeded.
 */
async function readBodyWithLimit(
  body: ReadableStream<Uint8Array> | null,
  maxBytes: number,
): Promise<Uint8Array | null> {
  if (!body) {
    return new Uint8Array(0);
  }
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

async function serveTurnAd(
  services: Services,
  input: {
    db: Services["db"];
    flags: Services["flags"];
    userId: string;
    conversationId: string;
    turnMessageId: number;
    device: ReturnType<typeof deviceSignalsFromHeaders>;
    hasPendingDeviceTools: boolean;
  },
): Promise<void> {
  if (!services.adNetwork || input.hasPendingDeviceTools) {
    return;
  }
  try {
    await runAdDecision(
      { db: input.db, network: services.adNetwork, flags: input.flags },
      {
        userId: input.userId,
        conversationId: input.conversationId,
        turnMessageId: input.turnMessageId,
        device: input.device,
      },
    );
  } catch (error) {
    console.error("Gravity ad decision failed", error);
  }
}

/**
 * The HTTP surface: tRPC under `/trpc/*` and a plain fetch-stream endpoint at
 * `/chat/stream` for token streaming (01: "SSE endpoint alongside tRPC").
 */
/** Ephemeral, non-persisted turn for the dev Chat Lab (see `/dev/chat-lab`). */
const chatLabInput = z.object({
  system: z.string().optional(),
  messages: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string() }))
    .min(1),
});

export function buildApp(services: Services) {
  const app = new Hono();

  // Bearer-token auth (no cookies), so a permissive CORS policy is safe; it
  // lets the Expo Web preview call the API from its own dev origin.
  app.use("*", cors());

  app.use(
    "/trpc/*",
    trpcServer({
      router: appRouter,
      createContext: (_opts, c) =>
        createRequestContext(
          services,
          c.req.header("authorization") ?? null,
          deviceSignalsFromHeaders((name) => c.req.header(name)),
          c.req.header("x-sidekick-device-id"),
        ),
    }),
  );

  app.post("/chat/stream", async (c) => {
    const device = deviceSignalsFromHeaders((name) => c.req.header(name));
    const ctx = await createRequestContext(services, c.req.header("authorization") ?? null, device);
    const userId = ctx.userId;
    if (!userId) {
      return c.json({ error: "unauthorized" }, 401);
    }
    const input = chatSendInput.parse(await c.req.json());
    const { textStream, done } = await beginTurn(
      {
        db: ctx.db,
        model: ctx.model,
        flags: ctx.flags,
        userId,
        storage: ctx.storage,
        replyModel: ctx.captionModel,
      },
      input,
    );
    return stream(c, async (s) => {
      for await (const delta of textStream) {
        await s.write(delta);
      }
      const outcome = await done;
      await serveTurnAd(services, {
        db: ctx.db,
        flags: ctx.flags,
        userId,
        conversationId: input.conversationId,
        turnMessageId: outcome.message.id,
        device,
        hasPendingDeviceTools: outcome.deviceToolCalls.length > 0,
      });
    });
  });

  /**
   * Resume a turn after the client posted its device-tool results (12). Same SSE
   * shape as `/chat/stream` but no user text — `continueTurn` streams the model's
   * follow-up (and may itself surface another device-tool frame). Fire-and-forget
   * on `done` so a persistence error never surfaces as an unhandled rejection.
   */
  app.post("/chat/continue", async (c) => {
    const device = deviceSignalsFromHeaders((name) => c.req.header(name));
    const ctx = await createRequestContext(services, c.req.header("authorization") ?? null, device);
    const userId = ctx.userId;
    if (!userId) {
      return c.json({ error: "unauthorized" }, 401);
    }
    const input = chatContinueInput.parse(await c.req.json());
    const { textStream, done } = await continueTurn(
      {
        db: ctx.db,
        model: ctx.model,
        flags: ctx.flags,
        userId,
        storage: ctx.storage,
        replyModel: ctx.captionModel,
      },
      input,
    );
    return stream(c, async (s) => {
      for await (const delta of textStream) {
        await s.write(delta);
      }
      const outcome = await done;
      await serveTurnAd(services, {
        db: ctx.db,
        flags: ctx.flags,
        userId,
        conversationId: input.conversationId,
        turnMessageId: outcome.message.id,
        device,
        hasPendingDeviceTools: outcome.deviceToolCalls.length > 0,
      });
    });
  });

  /**
   * The object-store proxy the client PUTs attachment bytes to and the model/app
   * read them back from (09 §storage). Both storage implementations route through
   * here; direct-to-Blob presigning is a later optimization behind the interface.
   */
  app.put("/blob/*", async (c) => {
    const ctx = await createRequestContext(services, c.req.header("authorization") ?? null);
    if (!ctx.userId) {
      return c.json({ error: "unauthorized" }, 401);
    }
    const key = c.req.path.slice("/blob/".length);

    /**
     * Only bytes for an attachment THIS user reserved may be written, and never
     * more than the row's already-limit-checked size (`createUpload` capped it
     * per-kind). Without this, a client could declare 1KB at `createUploadUrl`
     * then stream an unbounded body straight into memory — so we reject an
     * oversized `content-length` up front and still stream-read under a hard cap,
     * defeating a lying/absent length.
     */
    const reservation = await services.db
      .select({ userId: attachments.userId, bytes: attachments.bytes, status: attachments.status })
      .from(attachments)
      .where(eq(attachments.storageKey, key))
      .limit(1);
    const row = reservation[0];
    if (!row || row.userId !== ctx.userId) {
      return c.json({ error: "not found" }, 404);
    }
    /**
     * The reservation is single-use: once it leaves `uploading` (the client has
     * marked the bytes uploaded and ingest derived caption/transcript/text from
     * them), a second PUT would swap the served bytes out from under that already-
     * ingested metadata. Reject it rather than let stored content diverge.
     */
    if (row.status !== "uploading") {
      return c.json({ error: "conflict" }, 409);
    }
    const declaredLength = Number(c.req.header("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > row.bytes) {
      return c.json({ error: "payload too large" }, 413);
    }
    const bytes = await readBodyWithLimit(c.req.raw.body, row.bytes);
    if (!bytes) {
      return c.json({ error: "payload too large" }, 413);
    }
    await services.storage.putObject(
      key,
      bytes,
      c.req.header("content-type") ?? "application/octet-stream",
    );
    return c.body(null, 204);
  });

  /**
   * Reads serve the attachment's stored mime and honour `Range`: AVPlayer (the
   * app's voice messages) probes a media URL with a byte range and won't play a
   * source that answers with the whole body or an unrecognized content type.
   */
  app.get("/blob/*", async (c) => {
    const key = c.req.path.slice("/blob/".length);
    try {
      const bytes = await services.storage.getObject(key);
      const rows = await services.db
        .select({ mime: attachments.mime })
        .from(attachments)
        .where(eq(attachments.storageKey, key))
        .limit(1);
      const headers: Record<string, string> = {
        "content-type": safeContentType(rows[0]?.mime),
        "accept-ranges": "bytes",
        "x-content-type-options": "nosniff",
      };
      const range = parseByteRange(c.req.header("range"), bytes.byteLength);
      if (!range) {
        headers["content-length"] = String(bytes.byteLength);
        return new Response(new Uint8Array(bytes), { headers });
      }
      const slice = bytes.slice(range.start, range.end + 1);
      headers["content-length"] = String(slice.byteLength);
      headers["content-range"] = `bytes ${range.start}-${range.end}/${bytes.byteLength}`;
      return new Response(new Uint8Array(slice), { status: 206, headers });
    } catch {
      return c.json({ error: "not found" }, 404);
    }
  });

  /**
   * Short-lived Apple Music developer token (12 §music). The `.p8` key never
   * ships to the client — the app fetches ES256 tokens here. Absent env → a clean
   * 501 so the client can hide the feature rather than crash.
   */
  app.get("/music/developer-token", async (c) => {
    const ctx = await createRequestContext(services, c.req.header("authorization") ?? null);
    if (!ctx.userId) {
      return c.json({ error: "unauthorized" }, 401);
    }
    const minted = await mintDeveloperToken(appleMusicEnvFromProcess(process.env));
    if (!minted) {
      return c.json({ error: "apple_music_not_configured" }, 501);
    }
    return c.json({ token: minted.token, expiresAt: minted.expiresAt.toISOString() });
  });

  /**
   * Session-idle sweep (01 §scheduled work): find idle conversations and run
   * extraction → compaction for each. Vercel Cron hits this on a schedule.
   */
  app.use("/cron/*", cronAuth);

  app.get("/cron/idle", async (c) => {
    const result = await runIdleSweep(services.db, services.model, new Date());
    return c.json(result);
  });

  /**
   * Nightly ad-profile refresh (user-memory.md §5). The IAB classification pass is
   * env-gated: with `SIDEKICK_AD_IAB_CLASSIFY` set it runs a small-model pass over
   * interest sentences; otherwise the deterministic goal-slug map is the fallback.
   */
  app.get("/cron/ad-profiles", async (c) => {
    const classify = process.env.SIDEKICK_AD_IAB_CLASSIFY === "1";
    const result = await runAdProfileSweep(services.db, classify ? { model: services.model } : {});
    return c.json(result);
  });

  app.route("/cron", buildCheckinCron(services));
  app.route("/cron", buildRemindersCron(services));
  app.route("/cron", buildNotificationsCron(services));
  app.route("/cron", buildProactivityCron(services));

  /**
   * DEV-ONLY Chat Lab turn. Runs the REAL prod model (`ctx.model`, gpt-5.6-sol)
   * so the voice matches production, but against an EPHEMERAL transcript with a
   * caller-supplied system prompt — so the Chat Lab dev tool can iterate on the
   * persona / texting traits. Tools are disabled (pure text) and nothing is
   * persisted (no DB writes, no `buildContextView`, no ads). Double-gated:
   * NODE_ENV=development + an authenticated user.
   */
  app.post("/dev/chat-lab", async (c) => {
    if (process.env.NODE_ENV !== "development") {
      return c.json({ error: "not found" }, 404);
    }
    const ctx = await createRequestContext(services, c.req.header("authorization") ?? null);
    if (!ctx.userId) {
      return c.json({ error: "unauthorized" }, 401);
    }
    const input = chatLabInput.parse(await c.req.json());
    const result = streamText({
      model: ctx.model,
      system: input.system?.trim() ? input.system : PERSONA_PROMPT.text,
      messages: input.messages as ModelMessage[],
      tools: {},
    });
    return stream(c, async (s) => {
      for await (const delta of result.textStream) {
        await s.write(delta);
      }
    });
  });

  return app;
}
