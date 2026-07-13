/**
 * The ad-network seam (05-monetization.md §integration architecture). Gravity has
 * no React Native SDK, so the integration is server-side REST: our chat backend
 * calls their `/api/v1/ad` endpoint and the client renders the returned JSON. The
 * interface is deliberately network-agnostic (a `SponsoredCard` shape + a request
 * carrying a filtered message window) so Koah/Nexad are a config change (05
 * §backup & complements).
 */

/** Real device signals forwarded from the client request (05: never our server's). */
export type AdDeviceSignals = {
  ua?: string;
  ip?: string;
  os?: string;
  country?: string;
  id?: string;
  timezone?: string;
  locale?: string;
};

/** The device OS as Gravity wants it, sniffed from a mobile user-agent. */
function osFromUserAgent(ua: string): string | undefined {
  if (/iphone|ipad|ipod|ios/i.test(ua)) {
    return "ios";
  }
  if (/android/i.test(ua)) {
    return "android";
  }
  return undefined;
}

/**
 * Real device signals from the incoming request's headers (05 §CPM checklist:
 * "forward client ua/ip/os/country, never our server's"). `x-forwarded-for`'s
 * first hop is the client IP behind Vercel's proxy; `x-vercel-ip-country` is the
 * edge's geo lookup. Returns undefined when the request carries none, so a
 * headerless caller (tests, crons) sends no fabricated signals.
 */
export function deviceSignalsFromHeaders(
  header: (name: string) => string | null | undefined,
): AdDeviceSignals | undefined {
  const ua = header("x-sidekick-user-agent") ?? header("user-agent") ?? undefined;
  const forwarded = header("x-forwarded-for");
  const ip = forwarded ? forwarded.split(",")[0]?.trim() : (header("x-real-ip") ?? undefined);
  const country = header("x-vercel-ip-country") ?? undefined;
  const id = header("x-sidekick-device-id") ?? undefined;
  const timezone = header("x-sidekick-timezone") ?? undefined;
  const locale = header("accept-language")?.split(",")[0]?.trim() || undefined;
  const os = ua ? osFromUserAgent(ua) : undefined;
  if (!ua && !ip && !country && !id) {
    return undefined;
  }
  return {
    ...(ua ? { ua } : {}),
    ...(ip ? { ip } : {}),
    ...(os ? { os } : {}),
    ...(country ? { country } : {}),
    ...(id ? { id } : {}),
    ...(timezone ? { timezone } : {}),
    ...(locale ? { locale } : {}),
  };
}

/**
 * One ad request. `messages` is the ALREADY-FILTERED window (health/sensitive
 * rows stripped upstream — see ad-window.ts). No raw memory or inferred profile
 * crosses this boundary.
 */
export type AdRequest = {
  messages: { role: string; content: string }[];
  sessionId: string;
  userId: string;
  emailHash?: string;
  placement: string;
  placementId: string;
  relevancy: number;
  excludedTopics: string[];
  device?: AdDeviceSignals;
};

/**
 * A filled sponsored-suggestion card (05 §formats). `impUrl` fires on ≥50%
 * visibility, `clickUrl` on tap. A no-fill is a `null` return — never an error,
 * never blocks chat.
 */
export type SponsoredAd = {
  id?: string;
  brandName: string;
  favicon?: string;
  title: string;
  adText: string;
  cta: string;
  clickUrl: string;
  impUrl?: string;
};

export interface AdNetworkClient {
  requestAd(request: AdRequest): Promise<SponsoredAd | null>;
}

/** Gravity's env config (05 §CPM checklist). Absent key ⇒ ads disabled. */
export type GravityEnv = {
  GRAVITY_API_KEY?: string;
  GRAVITY_API_URL?: string;
  GRAVITY_PRODUCTION?: string;
};

const DEFAULT_GRAVITY_URL = "https://server.trygravity.ai";
const DEFAULT_TIMEOUT_MS = 3_000;

/**
 * The live Gravity REST client. `POST {baseUrl}/api/v1/ad` with the request body,
 * parses the response into a `SponsoredAd`, and treats a 204 / empty body / any
 * transport error as a no-fill (`null`) — an ad path must never surface an error
 * into the chat turn.
 */
export class GravityHttpClient implements AdNetworkClient {
  constructor(
    private readonly apiKey: string,
    private readonly baseUrl: string = DEFAULT_GRAVITY_URL,
    private readonly production: boolean = false,
    private readonly timeoutMs: number = DEFAULT_TIMEOUT_MS,
  ) {}

  async requestAd(request: AdRequest): Promise<SponsoredAd | null> {
    try {
      const response = await fetch(`${this.baseUrl}/api/v1/ad`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.apiKey}`,
        },
        signal: AbortSignal.timeout(this.timeoutMs),
        body: JSON.stringify({
          messages: request.messages,
          sessionId: request.sessionId,
          placements: [
            { placement: request.placement, placement_id: request.placementId },
          ],
          user: {
            id: request.userId,
            ...(request.emailHash ? { email_hash: request.emailHash } : {}),
          },
          relevancy: request.relevancy,
          excludedTopics: request.excludedTopics,
          testAd: !this.production,
          ...(request.device ? { device: request.device } : {}),
        }),
      });
      if (!response.ok || response.status === 204) {
        return null;
      }
      const body: unknown = await response.json();
      return parseGravityAd(body);
    } catch {
      return null;
    }
  }
}

function asObject(value: unknown): object | null {
  return typeof value === "object" && value !== null ? value : null;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function stringField(value: object, key: string): string | undefined {
  return asString(Reflect.get(value, key));
}

/**
 * Map Gravity's ad JSON to our `SponsoredAd`, tolerating their documented field
 * names. Returns null when the payload is a no-fill or is missing the fields we
 * must have to render a labeled card (title, brand, cta, click url).
 */
export function parseGravityAd(body: unknown): SponsoredAd | null {
  const first = Array.isArray(body) ? body[0] : body;
  const record = asObject(first);
  if (record === null) {
    return null;
  }
  const nestedAd = asObject(Reflect.get(record, "ad"));
  const ad = nestedAd ?? record;
  const id =
    stringField(ad, "campaignId") ??
    stringField(ad, "composition_id") ??
    stringField(ad, "id") ??
    stringField(ad, "adId");
  const brandName = stringField(ad, "brandName") ?? stringField(ad, "brand");
  const title = stringField(ad, "title");
  const cta = stringField(ad, "cta");
  const clickUrl = stringField(ad, "clickUrl") ?? stringField(ad, "url");
  const impUrl = stringField(ad, "impUrl") ?? stringField(ad, "impressionUrl");
  if (!brandName || !title || !cta || !clickUrl || !impUrl) {
    return null;
  }
  return {
    ...(id ? { id } : {}),
    brandName,
    favicon: stringField(ad, "favicon"),
    title,
    adText: stringField(ad, "adText") ?? stringField(ad, "body") ?? "",
    cta,
    clickUrl,
    impUrl,
  };
}

/**
 * Build the ad client from env, or `null` when no Gravity key is configured —
 * which is how ads stay OFF by default (05 §rollout: feature-flagged, US-first).
 * The rest of the ad path treats a null client as "ads disabled".
 */
export function gravityClientFromEnv(env: GravityEnv): AdNetworkClient | null {
  if (!env.GRAVITY_API_KEY) {
    return null;
  }
  return new GravityHttpClient(
    env.GRAVITY_API_KEY,
    env.GRAVITY_API_URL ?? DEFAULT_GRAVITY_URL,
    env.GRAVITY_PRODUCTION === "true",
  );
}

/**
 * A programmable in-process ad network for tests (real code, not a mock): it
 * records every request it receives and replies from a queued script of ads /
 * no-fills. Lets a test prove both the served path and — by asserting
 * `requests.length` — that ineligible turns NEVER reach the network.
 */
export class ScriptedAdClient implements AdNetworkClient {
  readonly requests: AdRequest[] = [];
  private readonly queue: (SponsoredAd | null)[];

  constructor(responses: (SponsoredAd | null)[] = []) {
    this.queue = [...responses];
  }

  async requestAd(request: AdRequest): Promise<SponsoredAd | null> {
    this.requests.push(request);
    return this.queue.length > 0 ? (this.queue.shift() ?? null) : null;
  }
}
