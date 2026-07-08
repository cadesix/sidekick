import { type LanguageModel, generateObject } from "ai";
import { and, eq, gt, inArray } from "drizzle-orm";
import { z } from "zod";
import {
  type Database,
  adProfiles,
  goals,
  memories,
  purchaseIntents,
  users,
} from "@sidekick/db";
import { AD_PROJECTION_KINDS } from "@sidekick/shared";

/**
 * Deterministic slug → IAB-ish interest labels for our own goal taxonomy
 * (user-memory.md §5). Extends as goal slugs are added; unknown slugs simply
 * don't project. This map is the always-on baseline the small-model classifier
 * layers on top of, and the fallback when no classifier is supplied.
 */
const GOAL_INTERESTS: Record<string, { label: string; code?: string }> = {
  "get-fit": { label: "Healthy Living/Fitness", code: "IAB7-38" },
  "sleep-better": { label: "Healthy Living/Wellness", code: "IAB7" },
  "read-more": { label: "Books & Literature", code: "IAB1" },
  "manage-stress": { label: "Healthy Living/Wellness", code: "IAB7" },
  "be-productive": { label: "Careers", code: "IAB4" },
};

export type Interest = { label: string; code?: string };
export type AdProfileRow = typeof adProfiles.$inferSelect;

/**
 * Turns free-text interest sentences into IAB Content Taxonomy labels/codes
 * (user-memory.md §5). Real implementations call a small model; the deterministic
 * goal-slug map is always applied on top and is the fallback when this is absent.
 */
export type InterestClassifier = (sentences: string[]) => Promise<Interest[]>;

const iabClassificationSchema = z.object({
  interests: z.array(z.object({ label: z.string(), code: z.string().optional() })),
});

/**
 * A model-backed classifier (user-memory.md §5): one small-model call maps the
 * user's interest sentences onto IAB Content Taxonomy codes. Env/flag-gated at the
 * call site — never invoked when no model is wired, so the deterministic map is
 * the default and this is the opt-in upgrade.
 */
export function modelInterestClassifier(model: LanguageModel): InterestClassifier {
  return async (sentences) => {
    if (sentences.length === 0) {
      return [];
    }
    const { object } = await generateObject({
      model,
      schema: iabClassificationSchema,
      prompt: `Map each interest to the closest IAB Content Taxonomy category. Return one
{label, code} per distinct category (IAB label like "Healthy Living/Fitness" and its
code like "IAB7-38"). Drop anything sensitive (health conditions, sexuality, religion,
politics, finances). Interests:\n${sentences.map((s) => `- ${s}`).join("\n")}`,
    });
    return object.interests;
  };
}

/**
 * Regenerate a user's ad-targeting projection (user-memory.md §5). NEVER exposes
 * raw memory: only the allowlisted `interest` kind projects (classified into IAB
 * codes, or kept as-is when no classifier), plus deterministic goal-slug
 * interests and non-expired purchase intents. Every sensitive kind (emotional,
 * relationship, identity, work, schedule, preference, event, goal_context) is
 * excluded wholesale, and device health data (`health_days`) is excluded at the
 * table level — it is simply never read here. Minors and users without consent are
 * `eligible=false` with an empty projection.
 */
export async function projectAdProfile(
  db: Database,
  userId: string,
  options: { classifier?: InterestClassifier; now?: Date } = {},
): Promise<AdProfileRow> {
  const userRows = await db
    .select({
      ageBracket: users.ageBracket,
      gender: users.gender,
      region: users.lastRegion,
      consent: users.personalizedAdsConsent,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  const user = userRows[0];
  if (!user) {
    throw new Error("user not found");
  }

  const isMinor = user.ageBracket === "under-18" || user.ageBracket === null;
  const eligible = !isMinor && user.consent === true;

  const now = options.now ?? new Date();
  const interests = eligible ? await collectInterests(db, userId, options.classifier) : [];
  const intents = eligible ? await collectIntents(db, userId, now) : [];

  const values = {
    userId,
    eligible,
    ageBracket: eligible ? user.ageBracket : null,
    gender: eligible && user.gender !== "prefer-not" ? user.gender : null,
    region: eligible ? user.region : null,
    interests,
    intents,
    generatedAt: now,
  };

  const inserted = await db
    .insert(adProfiles)
    .values(values)
    .onConflictDoUpdate({ target: adProfiles.userId, set: values })
    .returning();
  const row = inserted[0];
  if (!row) {
    throw new Error("failed to write ad profile");
  }
  return row;
}

/**
 * Nightly refresh (user-memory.md §5): regenerate every user's ad projection,
 * isolating per-user failures so one bad row never aborts the sweep. Passing a
 * `model` turns on the IAB classification pass for the whole sweep.
 */
export async function runAdProfileSweep(
  db: Database,
  options: { model?: LanguageModel; now?: Date } = {},
): Promise<{ ran: number; errors: number }> {
  const classifier = options.model ? modelInterestClassifier(options.model) : undefined;
  const userRows = await db.select({ id: users.id }).from(users);
  let ran = 0;
  let errors = 0;
  for (const user of userRows) {
    try {
      await projectAdProfile(db, user.id, { classifier, now: options.now });
      ran += 1;
    } catch {
      errors += 1;
    }
  }
  return { ran, errors };
}

async function collectInterests(
  db: Database,
  userId: string,
  classifier: InterestClassifier | undefined,
): Promise<Interest[]> {
  const [interestRows, goalRows] = await Promise.all([
    db
      .select({ content: memories.content })
      .from(memories)
      .where(
        and(
          eq(memories.userId, userId),
          eq(memories.status, "active"),
          inArray(memories.kind, [...AD_PROJECTION_KINDS]),
        ),
      )
      .limit(30),
    db
      .select({ slug: goals.slug })
      .from(goals)
      .where(and(eq(goals.userId, userId), eq(goals.status, "active"))),
  ]);

  const sentences = interestRows.map((row) => row.content);
  const classified = classifier
    ? await classifier(sentences)
    : sentences.map((label) => ({ label }));

  const byLabel = new Map<string, Interest>();
  for (const interest of classified) {
    byLabel.set(interest.label, interest);
  }
  for (const goal of goalRows) {
    const mapped = GOAL_INTERESTS[goal.slug];
    if (mapped) {
      byLabel.set(mapped.label, mapped);
    }
  }
  return [...byLabel.values()];
}

async function collectIntents(
  db: Database,
  userId: string,
  now: Date,
): Promise<{ signal: string; strength: string; expires: string }[]> {
  const rows = await db
    .select({
      signal: purchaseIntents.signal,
      strength: purchaseIntents.strength,
      expiresAt: purchaseIntents.expiresAt,
    })
    .from(purchaseIntents)
    .where(and(eq(purchaseIntents.userId, userId), gt(purchaseIntents.expiresAt, now)));
  return rows.map((row) => ({
    signal: row.signal,
    strength: row.strength,
    expires: row.expiresAt.toISOString(),
  }));
}
