import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { afterEach, expect, test } from "vitest";
import { GravityHttpClient, type AdRequest } from "@sidekick/server";

type RunningServer = { url: string; close: () => Promise<void> };

const servers: RunningServer[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function listen(
  handler: (request: IncomingMessage, response: ServerResponse) => Promise<void>,
): Promise<RunningServer> {
  const server = createServer((request, response) => {
    void handler(request, response);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (typeof address !== "object" || address === null) {
    throw new Error("test server did not bind a TCP port");
  }
  const running = {
    url: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    })),
  };
  servers.push(running);
  return running;
}

const REQUEST: AdRequest = {
  messages: [{ role: "user", content: "I need a database for my app" }],
  sessionId: "conversation-1",
  userId: "user-1",
  emailHash: "email-sha256",
  placement: "bottom_page",
  placementId: "expo-chat-composer",
  relevancy: 0.4,
  excludedTopics: ["health"],
  device: {
    ua: "Sidekick/1.0 (iPhone)",
    ip: "203.0.113.9",
    os: "ios",
    country: "US",
    id: "device-1",
    timezone: "America/New_York",
  },
};

test("Gravity client sends the documented request and parses an array response", async () => {
  let authorization: string | undefined;
  let body: unknown;
  const server = await listen(async (request, response) => {
    authorization = request.headers.authorization;
    body = await readJson(request);
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify([
      {
        campaignId: "campaign-1",
        brandName: "Neon",
        title: "Neon Postgres",
        adText: "Serverless Postgres that scales to zero.",
        cta: "Try Neon",
        clickUrl: "https://api.trygravity.ai/track/click?p=test",
        impUrl: "https://api.trygravity.ai/ack?p=test",
        placement: "bottom_page",
        placement_id: "expo-chat-composer",
      },
    ]));
  });

  const client = new GravityHttpClient("gravity-test-key", server.url, false);
  const ad = await client.requestAd(REQUEST);

  expect(authorization).toBe("Bearer gravity-test-key");
  expect(body).toEqual({
    messages: REQUEST.messages,
    sessionId: "conversation-1",
    placements: [{ placement: "bottom_page", placement_id: "expo-chat-composer" }],
    user: { id: "user-1", email_hash: "email-sha256" },
    relevancy: 0.4,
    excludedTopics: ["health"],
    testAd: true,
    device: REQUEST.device,
  });
  expect(ad).toMatchObject({
    id: "campaign-1",
    brandName: "Neon",
    title: "Neon Postgres",
  });
});

test("Gravity client treats a 204 as a silent no-fill", async () => {
  const server = await listen(async (_request, response) => {
    response.writeHead(204);
    response.end();
  });
  const client = new GravityHttpClient("gravity-test-key", server.url, false);
  await expect(client.requestAd(REQUEST)).resolves.toBeNull();
});

test("Gravity client only disables test ads when production is explicit", async () => {
  let body: unknown;
  const server = await listen(async (request, response) => {
    body = await readJson(request);
    response.writeHead(204);
    response.end();
  });
  const client = new GravityHttpClient("gravity-test-key", server.url, true);
  await client.requestAd(REQUEST);

  expect(body).toMatchObject({ testAd: false });
});
