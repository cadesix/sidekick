import { and, desc, eq, gte } from "drizzle-orm";
import { type Database, ads, messages } from "@sidekick/db";
import { type FeatureFlags, localDate } from "@sidekick/shared";

/** The per-user flag that gates ads (05 §rollout). Off ⇒ never request. */
export const ADS_FLAG = "ads";

/** Frequency caps (05 §ad-slotting policy). Deliberately far tighter than Gravity's 30s floor. */
export const AD_MAX_PER_DAY = 3;
export const AD_MIN_TURNS_APART = 6;

/** How many recent messages define the "current moment" for sensitive suppression. */
export const AD_SENSITIVE_WINDOW = 8;

/**
 * Why a turn is not getting an ad (05). `flag_off` / `minor` / `no_consent` are
 * decided BEFORE any network call — an ineligible user's conversation never
 * leaves our server.
 */
export type AdSkipReason =
  | "disabled"
  | "flag_off"
  | "minor"
  | "no_consent"
  | "sensitive_moment"
  | "frequency_cap"
  | "no_fill";

export type EligibilityUser = {
  ageBracket: string | null;
  personalizedAdsConsent: boolean | null;
  /** Coarse country from the location surface (`users.lastCountry`), or null. */
  country: string | null;
};

const US_COUNTRY_NAMES = new Set(["US", "USA", "UNITED STATES", "UNITED STATES OF AMERICA"]);

/** Whether a `users.lastCountry` value means the United States. */
export function isUsCountry(country: string | null): boolean {
  if (country === null) {
    return false;
  }
  return US_COUNTRY_NAMES.has(country.trim().toUpperCase());
}

/**
 * Region-aware consent (05 §settings: "EU opt-in default, US opt-out"). An
 * explicit choice always wins, in either direction. With no choice recorded
 * (null): US users are consented by default (the opt-out model); everywhere
 * else — including an unknown region, conservatively — requires explicit opt-in
 * (the EEA/UK GDPR posture).
 */
export function hasAdConsent(
  user: Pick<EligibilityUser, "personalizedAdsConsent" | "country">,
): boolean {
  if (user.personalizedAdsConsent !== null) {
    return user.personalizedAdsConsent;
  }
  return isUsCountry(user.country);
}

/**
 * The synchronous eligibility gate (05 §eligibility gate before any request):
 * feature flag → 18+ with a known age (00's v1 posture) → region-aware
 * personalized-ads consent. Minors are excluded before consent is even
 * considered, regardless of region or any recorded choice. Pure, so the "minor
 * never triggers a request" guarantee is provable in isolation. Returns the
 * blocking reason, or null when eligible so far.
 */
export function eligibilityGate(user: EligibilityUser, flags: FeatureFlags): AdSkipReason | null {
  if (flags[ADS_FLAG] === false) {
    return "flag_off";
  }
  if (user.ageBracket === null || user.ageBracket === "under-18") {
    return "minor";
  }
  if (!hasAdConsent(user)) {
    return "no_consent";
  }
  return null;
}

/**
 * Sensitive-moment suppression (05): if the recent window holds any message
 * flagged `sensitive` (health-derived turns et al.), skip the ad entirely — the
 * same flag the ad-forward window strips, applied here as a whole-moment veto.
 */
export async function recentWindowIsSensitive(
  db: Database,
  conversationId: string,
): Promise<boolean> {
  const rows = await db
    .select({ sensitive: messages.sensitive })
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(desc(messages.id))
    .limit(AD_SENSITIVE_WINDOW);
  return rows.some((r) => r.sensitive);
}

/**
 * Frequency headroom (05 §frequency): at most `AD_MAX_PER_DAY` served ads on the
 * user's local day, and at least `AD_MIN_TURNS_APART` assistant turns since the
 * last one. Returns true when there is room for another ad.
 */
export async function hasFrequencyHeadroom(
  db: Database,
  input: { userId: string; conversationId: string; turnMessageId: number; timezone: string; now: Date },
): Promise<boolean> {
  const since = new Date(input.now.getTime() - 48 * 60 * 60 * 1000);
  const recent = await db
    .select({ turnMessageId: ads.turnMessageId, createdAt: ads.createdAt })
    .from(ads)
    .where(and(eq(ads.userId, input.userId), gte(ads.createdAt, since)))
    .orderBy(desc(ads.createdAt));

  const today = localDate(input.timezone, input.now);
  const servedToday = recent.filter((r) => localDate(input.timezone, r.createdAt) === today).length;
  if (servedToday >= AD_MAX_PER_DAY) {
    return false;
  }

  const lastTurn = recent[0]?.turnMessageId;
  if (lastTurn === null || lastTurn === undefined) {
    return true;
  }
  const assistantTurns = await db
    .select({ id: messages.id })
    .from(messages)
    .where(
      and(
        eq(messages.conversationId, input.conversationId),
        eq(messages.role, "assistant"),
        gte(messages.id, lastTurn),
      ),
    );
  return assistantTurns.length - 1 >= AD_MIN_TURNS_APART;
}
