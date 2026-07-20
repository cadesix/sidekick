import { createHash } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { type Database, adEvents, adProfiles, ads, users } from "@sidekick/db";
import type { FeatureFlags } from "@sidekick/shared";
import { logger } from "../logger";
import { adForwardMessages } from "../memory/ad-window";
import {
  type AdSkipReason,
  eligibilityGate,
  hasFrequencyHeadroom,
  recentWindowIsSensitive,
} from "./eligibility";
import type { AdDeviceSignals, AdNetworkClient } from "./gravity";
import { serveAd } from "./store";

/** Messages of filtered context forwarded to the network (05: a bounded window). */
const AD_CONTEXT_WINDOW = 12;

export const GRAVITY_CHAT_PLACEMENT = "bottom_page";
export const GRAVITY_CHAT_PLACEMENT_ID = "expo-chat-composer";

/** Relevancy bar (05 §high threshold, low fill). Lowered on high purchase intent. */
const RELEVANCY_DEFAULT = 0.6;
const RELEVANCY_HIGH_INTENT = 0.4;

/**
 * Static topic backstop (05 §sensitive-moment suppression): never match ads
 * against these, on top of per-message stripping and the whole-moment veto.
 */
const EXCLUDED_TOPICS = [
  "health",
  "mental health",
  "medical",
  "grief",
  "relationships",
  "body image",
  "finances",
  "politics",
  "religion",
];

/** How many recent dismissals feed the per-user excluded-topics signal. */
const DISMISSED_TOPICS_LIMIT = 20;

export type AdDecisionResult =
  | { status: "served"; adUnitId: string; messageId: number }
  | { status: "skipped"; reason: AdSkipReason };

/** The stored `ad_profiles.intents` jsonb, as written by the projection sweep. */
const adProfileIntentsSchema = z.array(
  z.object({ signal: z.string(), strength: z.string(), expires: z.string() }),
);

/**
 * The post-response ad-slotting decision (05 §integration architecture, invoked
 * from routers/chat.ts after the turn). Runs the full policy — eligibility →
 * sensitive-moment suppression → frequency → build the STRIPPED context window +
 * ad profile → request → serve. A minor / no-consent / flag-off / suppressed
 * turn returns before any network call: the conversation never leaves our server.
 * Every outcome is logged for the analytics seam (PostHog is not wired yet, 05
 * §metrics). Never throws into the caller — a failed ad path is a silent no-ad.
 */
export async function runAdDecision(
  deps: { db: Database; network: AdNetworkClient | null; flags: FeatureFlags },
  input: {
    userId: string;
    conversationId: string;
    turnMessageId: number;
    device?: AdDeviceSignals;
    now?: Date;
  },
): Promise<AdDecisionResult> {
  const { db, network, flags } = deps;
  const now = input.now ?? new Date();

  if (!network) {
    return logged(input, { status: "skipped", reason: "disabled" });
  }

  const userRows = await db
    .select({
      ageBracket: users.ageBracket,
      consent: users.personalizedAdsConsent,
      timezone: users.timezone,
      country: users.lastCountry,
      email: users.email,
    })
    .from(users)
    .where(eq(users.id, input.userId))
    .limit(1);
  const user = userRows[0];
  if (!user) {
    return logged(input, { status: "skipped", reason: "minor" });
  }

  const blocked = eligibilityGate(
    { ageBracket: user.ageBracket, personalizedAdsConsent: user.consent, country: user.country },
    flags,
  );
  if (blocked) {
    return logged(input, { status: "skipped", reason: blocked });
  }

  if (await recentWindowIsSensitive(db, input.conversationId)) {
    return logged(input, { status: "skipped", reason: "sensitive_moment" });
  }

  const headroom = await hasFrequencyHeadroom(db, {
    userId: input.userId,
    conversationId: input.conversationId,
    turnMessageId: input.turnMessageId,
    timezone: user.timezone,
    now,
  });
  if (!headroom) {
    return logged(input, { status: "skipped", reason: "frequency_cap" });
  }

  const [window, activeIntent, dismissedTopics] = await Promise.all([
    adForwardMessages(db, input.conversationId, AD_CONTEXT_WINDOW),
    hasActiveIntent(db, input.userId),
    dismissedAdTopics(db, input.userId),
  ]);
  const relevancy = activeIntent ? RELEVANCY_HIGH_INTENT : RELEVANCY_DEFAULT;

  const ad = await network.requestAd({
    messages: window.map((m) => ({ role: m.role, content: m.content })),
    sessionId: input.conversationId,
    userId: input.userId,
    emailHash: user.email
      ? createHash("sha256").update(user.email.trim().toLowerCase()).digest("hex")
      : undefined,
    placement: GRAVITY_CHAT_PLACEMENT,
    placementId: GRAVITY_CHAT_PLACEMENT_ID,
    relevancy,
    excludedTopics: [...EXCLUDED_TOPICS, ...dismissedTopics],
    device: {
      ...(user.country ? { country: user.country } : {}),
      ...(user.timezone ? { timezone: user.timezone } : {}),
      ...input.device,
    },
  });

  if (!ad) {
    return logged(input, { status: "skipped", reason: "no_fill" });
  }

  const served = await serveAd(db, {
    userId: input.userId,
    conversationId: input.conversationId,
    turnMessageId: input.turnMessageId,
    network: "gravity",
    ad,
    placement: GRAVITY_CHAT_PLACEMENT,
  });
  return logged(input, { status: "served", adUnitId: served.adUnitId, messageId: served.messageId });
}

/**
 * The user's "hide ads like this" feedback (05 §ad feedback loop), folded into
 * `excludedTopics` on every subsequent request. Derived from dismiss events —
 * each dismissed ad's brand name (lowercased) becomes an excluded topic — so no
 * extra state to maintain; bounded to the most recent dismissals.
 */
async function dismissedAdTopics(db: Database, userId: string): Promise<string[]> {
  const rows = await db
    .select({ brandName: ads.brandName })
    .from(adEvents)
    .innerJoin(ads, eq(adEvents.adId, ads.id))
    .where(and(eq(adEvents.userId, userId), eq(adEvents.type, "dismiss")))
    .orderBy(desc(adEvents.createdAt))
    .limit(DISMISSED_TOPICS_LIMIT);
  return [...new Set(rows.map((row) => row.brandName.toLowerCase()))];
}

/**
 * Whether the user has a live purchase intent, which is the only thing the ad
 * request derives from their profile — it raises the relevancy floor.
 */
async function hasActiveIntent(db: Database, userId: string): Promise<boolean> {
  const rows = await db
    .select({ eligible: adProfiles.eligible, intents: adProfiles.intents })
    .from(adProfiles)
    .where(eq(adProfiles.userId, userId))
    .limit(1);
  const profile = rows[0];
  if (!profile?.eligible) {
    return false;
  }
  const intents = adProfileIntentsSchema.safeParse(profile.intents);
  return intents.success && intents.data.some((intent) => intent.strength === "active");
}

function logged(
  input: { userId: string; conversationId: string; turnMessageId: number },
  result: AdDecisionResult,
): AdDecisionResult {
  logger.info(
    {
      event: "ad.decision",
      userId: input.userId,
      conversationId: input.conversationId,
      turnMessageId: input.turnMessageId,
      status: result.status,
      reason: result.status === "skipped" ? result.reason : undefined,
    },
    "ad decision",
  );
  return result;
}
