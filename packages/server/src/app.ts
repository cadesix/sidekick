import { trpcServer } from "@hono/trpc-server";
import { attachments } from "@sidekick/db";
import { chatContinueInput, chatSendInput } from "@sidekick/shared";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { stream } from "hono/streaming";
import { beginTurn, continueTurn } from "./chat/turn";
import { buildCheckinCron } from "./checkins/cron";
import { buildRemindersCron } from "./reminders/cron";
import { buildRewardsCron } from "./rewards/cron";
import { runAdDecision } from "./ads/decision";
import { deviceSignalsFromHeaders } from "./ads/gravity";
import { type Services, createRequestContext } from "./context";
import { readEnv } from "./env";
import { runIdleSweep } from "./jobs/idle";
import { runAdProfileSweep } from "./memory/projection";
import { appleMusicEnvFromProcess, mintDeveloperToken } from "./music/dev-token";
import { appRouter } from "./routers";

/** Vercel-cron auth: a matching `Authorization: Bearer $CRON_SECRET` header. */
function authorizeCron(authorization: string | null): boolean {
  const secret = readEnv().CRON_SECRET;
  if (!secret) {
    return false;
  }
  return authorization === `Bearer ${secret}`;
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
 * The HTTP surface: tRPC under `/trpc/*` and a plain fetch-stream endpoint at
 * `/chat/stream` for token streaming (01: "SSE endpoint alongside tRPC").
 */
export function buildApp(services: Services) {
  const app = new Hono();

  app.use(
    "/trpc/*",
    trpcServer({
      router: appRouter,
      createContext: (_opts, c) =>
        createRequestContext(
          services,
          c.req.header("authorization") ?? null,
          deviceSignalsFromHeaders((name) => c.req.header(name)),
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
    /**
     * The post-response ad decision (05) for the streaming path — the one the
     * app actually uses. Kicked off once the turn has fully persisted, with the
     * REAL client device signals captured above; never delays the stream.
     */
    const { adNetwork } = services;
    if (adNetwork) {
      void done
        .then((outcome) =>
          services.scheduleBackground(() =>
            runAdDecision(
              { db: ctx.db, network: adNetwork, flags: ctx.flags },
              {
                userId,
                conversationId: input.conversationId,
                turnMessageId: outcome.message.id,
                device,
              },
            ),
          ),
        )
        .catch(() => {});
    }
    return stream(c, async (s) => {
      for await (const delta of textStream) {
        await s.write(delta);
      }
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
    void done.catch(() => {});
    return stream(c, async (s) => {
      for await (const delta of textStream) {
        await s.write(delta);
      }
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
    const bytes = new Uint8Array(await c.req.arrayBuffer());
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
        "content-type": rows[0]?.mime ?? "application/octet-stream",
        "accept-ranges": "bytes",
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
  app.get("/cron/idle", async (c) => {
    if (!authorizeCron(c.req.header("authorization") ?? null)) {
      return c.json({ error: "unauthorized" }, 401);
    }
    const result = await runIdleSweep(services.db, services.model, new Date());
    return c.json(result);
  });

  /**
   * Nightly ad-profile refresh (user-memory.md §5). The IAB classification pass is
   * env-gated: with `SIDEKICK_AD_IAB_CLASSIFY` set it runs a small-model pass over
   * interest sentences; otherwise the deterministic goal-slug map is the fallback.
   */
  app.get("/cron/ad-profiles", async (c) => {
    if (!authorizeCron(c.req.header("authorization") ?? null)) {
      return c.json({ error: "unauthorized" }, 401);
    }
    const classify = process.env.SIDEKICK_AD_IAB_CLASSIFY === "1";
    const result = await runAdProfileSweep(services.db, classify ? { model: services.model } : {});
    return c.json(result);
  });

  app.route("/cron", buildCheckinCron(services));
  app.route("/cron", buildRemindersCron(services));
  app.route("/cron", buildRewardsCron(services));

  return app;
}
