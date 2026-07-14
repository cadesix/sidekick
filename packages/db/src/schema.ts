import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  bigint,
  bigserial,
  boolean,
  customType,
  date,
  integer,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const now = () =>
  timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow();

type MessageReaction = {
  type:
    | "heart"
    | "thumbsUp"
    | "thumbsDown"
    | "haha"
    | "exclamation"
    | "question"
    | `emoji:${string}`;
  from: "me" | "them";
};

/**
 * Postgres `tsvector`. Only ever written by a generated column and read through
 * `@@` in `chat.search`, so the TS-side representation is an opaque string.
 */
const tsvector = customType<{ data: string; driverData: string }>({
  dataType() {
    return "tsvector";
  },
});

/**
 * Long-term memory categories (user-memory.md §1). The one enum in the schema —
 * every other status/kind column is free text so feature engineers can add values
 * without a migration.
 */
export const memoryKind = pgEnum("memory_kind", [
  "identity",
  "work_school",
  "relationship",
  "schedule",
  "interest",
  "preference",
  "event",
  "emotional",
  "goal_context",
]);

/**
 * A user. Onboarding-derived columns (name, ageBracket, gender, personality,
 * sidekickName, sidekickColor) are nullable because an account exists from the
 * first anonymous device registration, before the funnel fills them in
 * (01-architecture.md "anonymous device account"). The funnel's cold-start
 * transaction (user-memory.md §6) populates them.
 */
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").unique(),
  passwordHash: text("password_hash"),
  name: text("name"),
  ageBracket: text("age_bracket"),
  gender: text("gender"),
  timezone: text("timezone").notNull().default("America/New_York"),
  personality: jsonb("personality"),
  sidekickName: text("sidekick_name"),
  sidekickColor: text("sidekick_color"),
  memoryVersion: bigint("memory_version", { mode: "number" }).notNull().default(1),
  contextScore: integer("context_score").notNull().default(0),
  reminderTime: text("reminder_time"),
  pushToken: text("push_token"),
  lastCity: text("last_city"),
  lastRegion: text("last_region"),
  lastCountry: text("last_country"),
  lastLocatedAt: timestamp("last_located_at", { withTimezone: true, mode: "date" }),
  ageGatePassed: boolean("age_gate_passed").notNull().default(false),
  ageGatePassedAt: timestamp("age_gate_passed_at", { withTimezone: true, mode: "date" }),
  personalizedAdsConsent: boolean("personalized_ads_consent"),
  /**
   * Set when the onboarding funnel completes. Nullable until then. Requested by
   * the onboarding engineer; nothing writes it yet (04 migration owner note).
   */
  onboardingCompletedAt: timestamp("onboarding_completed_at", {
    withTimezone: true,
    mode: "date",
  }),
  /**
   * Soft "sparks" currency (04 spinner pity-timer). Granted as a spinner fallback
   * and spent to redeem a chosen cosmetic. No purchasable currency in v1.
   */
  sparks: integer("sparks").notNull().default(0),
  createdAt: now(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
});

/**
 * Anonymous auth: one row per device, mapping an opaque bearer token to a user.
 * Registration is idempotent on deviceId, so a reinstall-less relaunch reuses
 * the same identity.
 */
export const devices = pgTable("devices", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id),
  deviceId: text("device_id").notNull().unique(),
  publicKey: text("public_key"),
  token: text("token").notNull().unique(),
  createdAt: now(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
});

export const conversations = pgTable("conversations", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id),
  kind: text("kind").notNull().default("main"),
  lastExtractedMessageId: bigint("last_extracted_message_id", { mode: "number" }),
  createdAt: now(),
});

/**
 * Append-only, immutable message log (08 invariant 1). `id` is a monotonic
 * bigserial used simultaneously as pagination cursor, compaction watermark and
 * extraction watermark.
 */
export const messages = pgTable(
  "messages",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id),
    role: text("role").notNull(),
    content: text("content").notNull(),
    replyToId: bigint("reply_to_id", { mode: "number" }).references(
      (): AnyPgColumn => messages.id,
      { onDelete: "set null" },
    ),
    reactions: jsonb("reactions").$type<MessageReaction[]>().notNull().default([]),
    toolCalls: jsonb("tool_calls"),
    adUnitId: text("ad_unit_id"),
    tokenEstimate: integer("token_estimate").notNull(),
    promptVersion: text("prompt_version"),
    model: text("model"),
    tokensIn: integer("tokens_in"),
    tokensOut: integer("tokens_out"),
    sensitive: boolean("sensitive").notNull().default(false),
    createdAt: now(),
    /**
     * Full-text index of `content` (08 §message search). A stored generated
     * column so search is one GIN lookup on immutable rows — no write path,
     * always in sync with `content`.
     */
    contentTsv: tsvector("content_tsv").generatedAlwaysAs(
      sql`to_tsvector('english', content)`,
    ),
  },
  (t) => [
    index("messages_conversation_id_idx").on(t.conversationId, t.id),
    index("messages_content_tsv_idx").using("gin", t.contentTsv),
  ],
);

/**
 * Rolling summary of the endless thread (08). `id` is bigserial so the latest
 * summary for a conversation is one indexed descending lookup.
 */
export const conversationSummaries = pgTable(
  "conversation_summaries",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id),
    coversToMessageId: bigint("covers_to_message_id", { mode: "number" }).notNull(),
    content: text("content").notNull(),
    tokenEstimate: integer("token_estimate").notNull(),
    supersedesId: bigint("supersedes_id", { mode: "number" }),
    model: text("model"),
    promptVersion: text("prompt_version"),
    createdAt: now(),
  },
  (t) => [index("conversation_summaries_conversation_id_id_idx").on(t.conversationId, t.id.desc())],
);

export const memories = pgTable(
  "memories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    kind: memoryKind("kind").notNull(),
    content: text("content").notNull(),
    eventDate: date("event_date"),
    confidence: text("confidence").notNull().default("stated"),
    status: text("status").notNull().default("active"),
    supersedesId: uuid("supersedes_id"),
    source: text("source").notNull(),
    sourceSessionId: uuid("source_session_id"),
    lastReinforcedAt: timestamp("last_reinforced_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    createdAt: now(),
  },
  (t) => [index("memories_user_id_status_kind_idx").on(t.userId, t.status, t.kind)],
);

/** Tombstones: deleted memories the extractor must never re-learn (user-memory.md §1). */
export const memorySuppressions = pgTable("memory_suppressions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id),
  content: text("content").notNull(),
  createdAt: now(),
});

export const goals = pgTable("goals", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id),
  slug: text("slug").notNull(),
  label: text("label"),
  status: text("status").notNull().default("active"),
  createdAt: now(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
});

export const actionItems = pgTable("action_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  goalId: uuid("goal_id")
    .notNull()
    .references(() => goals.id),
  slug: text("slug").notNull(),
  label: text("label").notNull(),
  cadence: jsonb("cadence").notNull(),
  status: text("status").notNull().default("active"),
  createdAt: now(),
});

/** One row per user per local day — the core retention table (03). */
export const checkIns = pgTable(
  "check_ins",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    date: date("date").notNull(),
    status: text("status").notNull().default("pending"),
    openerMessageId: bigint("opener_message_id", { mode: "number" }),
    completedAt: timestamp("completed_at", { withTimezone: true, mode: "date" }),
    createdAt: now(),
  },
  (t) => [uniqueIndex("check_ins_user_id_date_idx").on(t.userId, t.date)],
);

export const progressEvents = pgTable("progress_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  actionItemId: uuid("action_item_id")
    .notNull()
    .references(() => actionItems.id),
  checkInId: uuid("check_in_id").references(() => checkIns.id),
  date: date("date").notNull(),
  outcome: text("outcome").notNull(),
  note: text("note"),
  source: text("source").notNull(),
  messageId: bigint("message_id", { mode: "number" }),
  createdAt: now(),
});

export const reminders = pgTable(
  "reminders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    text: text("text").notNull(),
    schedule: jsonb("schedule").notNull(),
    timezone: text("timezone").notNull(),
    nextFireAt: timestamp("next_fire_at", { withTimezone: true, mode: "date" }),
    status: text("status").notNull().default("active"),
    createdFromMessageId: bigint("created_from_message_id", { mode: "number" }),
    createdAt: now(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [index("reminders_status_next_fire_at_idx").on(t.status, t.nextFireAt)],
);

export const attachments = pgTable("attachments", {
  id: uuid("id").primaryKey().defaultRandom(),
  messageId: bigint("message_id", { mode: "number" }),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id),
  kind: text("kind").notNull(),
  mime: text("mime").notNull(),
  bytes: integer("bytes").notNull(),
  storageKey: text("storage_key").notNull(),
  width: integer("width"),
  height: integer("height"),
  durationMs: integer("duration_ms"),
  waveform: jsonb("waveform").$type<number[]>(),
  transcript: text("transcript"),
  extractedText: text("extracted_text"),
  caption: text("caption"),
  /** PDF page count (09 §native document blocks). Null for non-PDFs / unparsed. */
  pages: integer("pages"),
  status: text("status").notNull().default("uploading"),
  createdAt: now(),
});

export const folders = pgTable("folders", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id),
  name: text("name").notNull(),
  emoji: text("emoji"),
  position: integer("position").notNull().default(0),
  createdAt: now(),
});

export const documents = pgTable("documents", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id),
  folderId: uuid("folder_id").references(() => folders.id),
  title: text("title").notNull(),
  content: text("content").notNull(),
  lastEditedBy: text("last_edited_by").notNull(),
  status: text("status").notNull().default("active"),
  createdAt: now(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
});

export const documentVersions = pgTable("document_versions", {
  id: uuid("id").primaryKey().defaultRandom(),
  /**
   * Monotonic insertion order for a document's history. `createdAt` is display
   * data only — it can tie when two writes land in the same clock tick — so this
   * bigserial is the source of truth every version query orders by.
   */
  seq: bigserial("seq", { mode: "number" }).notNull(),
  documentId: uuid("document_id")
    .notNull()
    .references(() => documents.id),
  content: text("content").notNull(),
  title: text("title").notNull(),
  editedBy: text("edited_by").notNull(),
  createdAt: now(),
});

/** Daily aggregate of on-device HealthKit data (12). Never enters ad projection. */
export const healthDays = pgTable(
  "health_days",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    date: date("date").notNull(),
    steps: integer("steps"),
    activeCalories: integer("active_calories"),
    sleepMinutes: integer("sleep_minutes"),
    sleepStart: timestamp("sleep_start", { withTimezone: true, mode: "date" }),
    sleepEnd: timestamp("sleep_end", { withTimezone: true, mode: "date" }),
    workouts: jsonb("workouts").notNull().default([]),
    syncedAt: timestamp("synced_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("health_days_user_id_date_idx").on(t.userId, t.date)],
);

/** Encrypted Apple Music user token store (12). */
export const musicAuth = pgTable("music_auth", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id),
  userToken: text("user_token").notNull(),
  storefront: text("storefront"),
  connectedAt: timestamp("connected_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
});

/** Derived ad-targeting projection — never the raw memories (user-memory.md §5). */
export const adProfiles = pgTable("ad_profiles", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id),
  eligible: boolean("eligible").notNull(),
  ageBracket: text("age_bracket"),
  gender: text("gender"),
  region: text("region"),
  interests: jsonb("interests").notNull().default([]),
  intents: jsonb("intents").notNull().default([]),
  generatedAt: timestamp("generated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
});

export const consents = pgTable("consents", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id),
  kind: text("kind").notNull(),
  granted: boolean("granted").notNull(),
  at: timestamp("at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
});

/**
 * A filled/served conversational ad (05-monetization.md). One row per delivered
 * Gravity (or other network) ad; the render payload the client draws the
 * `SponsoredCard` from lives here, keyed to the ad message row whose `adUnitId`
 * equals this `id` (that row is structurally excluded from the LLM view). Never
 * carries raw user memory — only what the network returned plus linkage.
 */
export const ads = pgTable(
  "ads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id),
    /** The ad message row (role='assistant', adUnitId=this id). Set after insert. */
    messageId: bigint("message_id", { mode: "number" }),
    /** The assistant turn this ad followed — powers the min-turns-apart cap. */
    turnMessageId: bigint("turn_message_id", { mode: "number" }),
    network: text("network").notNull().default("gravity"),
    /** The network's own ad id (Gravity's `id`) — attribution/feedback handle. */
    externalId: text("external_id"),
    brandName: text("brand_name").notNull(),
    faviconUrl: text("favicon_url"),
    title: text("title").notNull(),
    body: text("body").notNull(),
    cta: text("cta").notNull(),
    clickUrl: text("click_url").notNull(),
    impressionUrl: text("impression_url"),
    placement: text("placement").notNull().default("below_response"),
    createdAt: now(),
  },
  (t) => [index("ads_user_id_created_at_idx").on(t.userId, t.createdAt)],
);

/** Ad lifecycle events (05): `impression` (≥50% visible), `click`, `dismiss`. */
export const adEvents = pgTable(
  "ad_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    adId: uuid("ad_id")
      .notNull()
      .references(() => ads.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    type: text("type").notNull(),
    createdAt: now(),
  },
  (t) => [uniqueIndex("ad_events_ad_id_type_idx").on(t.adId, t.type)],
);

/**
 * Purchase-intent signals extracted from conversation (user-memory.md §5). Each
 * carries a strength and a TTL so stale intent lapses; the nightly projection
 * reads the non-expired rows into `ad_profiles.intents`. NEVER holds sensitive
 * categories — the extraction guardrail keeps health/relationship/etc. out.
 */
export const purchaseIntents = pgTable(
  "purchase_intents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    signal: text("signal").notNull(),
    strength: text("strength").notNull().default("active"),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
    sourceSessionId: uuid("source_session_id"),
    createdAt: now(),
  },
  (t) => [index("purchase_intents_user_id_expires_at_idx").on(t.userId, t.expiresAt)],
);

/**
 * A cosmetic a user owns (04). The catalog itself is code (`@sidekick/shared`
 * COSMETIC_CATALOG), so ownership references a stable `itemKey` rather than a
 * catalog-row FK. `slot` is denormalized so "unequip everything in this slot"
 * is one indexed write. Unique per (user, item) — re-granting a dupe is a no-op
 * and the roller instead awards sparks (04 pity timer).
 */
export const userCosmetics = pgTable(
  "user_cosmetics",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    itemKey: text("item_key").notNull(),
    slot: text("slot").notNull(),
    equipped: boolean("equipped").notNull().default(false),
    acquiredAt: timestamp("acquired_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    createdAt: now(),
  },
  (t) => [
    uniqueIndex("user_cosmetics_user_id_item_key_idx").on(t.userId, t.itemKey),
    index("user_cosmetics_user_id_slot_idx").on(t.userId, t.slot),
  ],
);

/**
 * Server-authoritative reward grants (04). The generic grant path every reward
 * source flows through: streak milestones, the daily spinner, and later
 * deep-talk `source:'event'` bonuses. `dedupeKey` makes every grant idempotent
 * (e.g. `spin:<checkInId>`, `streak:7`, `event:<sessionId>`), so a cron re-run
 * or a background-then-reopen never double-grants. `revealedAt` is null until
 * the client has animated the result — the spinner shows a granted-but-unseen
 * reward exactly once.
 */
export const rewards = pgTable(
  "rewards",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    source: text("source").notNull(),
    dedupeKey: text("dedupe_key").notNull(),
    kind: text("kind").notNull(),
    itemKey: text("item_key"),
    sparks: integer("sparks"),
    revealedAt: timestamp("revealed_at", { withTimezone: true, mode: "date" }),
    createdAt: now(),
  },
  (t) => [uniqueIndex("rewards_user_id_dedupe_key_idx").on(t.userId, t.dedupeKey)],
);
