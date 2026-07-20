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
 * A user. Created by the first successful sign-in (19-auth.md) — email/phone
 * come from the provider identity. Onboarding-derived columns (name, ageBracket,
 * gender, personality, sidekickName, sidekickColor) are nullable because a fresh
 * signup has a blank profile until the funnel's cold-start transaction
 * (user-memory.md §6) populates them.
 *
 * `email`/`phone` are NOT unique: identity is keyed on `(provider,
 * providerAccountId)` in `accounts`. A verified email is shared by linking (a new
 * trusted provider carrying the same *verified* email attaches to the existing
 * user — see `findOrCreateUserForProvider`), but an *unverified* email can still
 * coexist as a separate weak identity, so the column can hold duplicates. A unique
 * constraint would make those legitimate cases fail with a unique violation.
 */
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email"),
  phone: text("phone"),
  emailVerified: timestamp("email_verified", { withTimezone: true, mode: "date" }),
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
  coins: integer("coins").notNull().default(0),
  bond: integer("bond").notNull().default(10),
  streakCount: integer("streak_count").notNull().default(0),
  streakLastDay: date("streak_last_day"),
  astral: jsonb("astral"),
  skin: jsonb("skin"),
  stateVersion: bigint("state_version", { mode: "number" }).notNull().default(1),
  createdAt: now(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
});

/**
 * Post-auth device metadata (19-auth.md): one row per installation, mapping a
 * physical device to the user currently signed in on it. Push-token registration
 * resolves through `(userId, deviceId)`. Upserted on `deviceId`, repointing
 * `userId` so a device that signs into a different account moves with it.
 */
export const devices = pgTable("devices", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id),
  deviceId: text("device_id").notNull().unique(),
  publicKey: text("public_key"),
  createdAt: now(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
});

/**
 * Session credential (19-auth.md): the SHA-256 hash of an opaque bearer token,
 * never the token itself. 30-day sliding expiry — every authed request pushes
 * `expiresAt` forward. Logout soft-deletes via `deletedAt`.
 */
export const authSessions = pgTable(
  "auth_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    hashedToken: text("hashed_token").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true, mode: "date" }),
    createdAt: now(),
  },
  (t) => [index("auth_sessions_user_id_idx").on(t.userId)],
);

/**
 * A provider identity mapped to a user (19-auth.md). `(provider,
 * providerAccountId)` is unique — the find-or-create key that signs an existing
 * identity in or creates a new user. No merging.
 */
export const accounts = pgTable(
  "accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    providerAccountId: text("provider_account_id").notNull(),
    createdAt: now(),
  },
  (t) => [
    uniqueIndex("accounts_provider_provider_account_id_idx").on(t.provider, t.providerAccountId),
    index("accounts_user_id_idx").on(t.userId),
  ],
);

/**
 * Email OTP codes (19-auth.md). The SHA-256 hash of a 6-digit code with a 10-min
 * expiry; prior codes are invalidated on re-request and verify consumes atomically
 * with an `attempts < 5` guard.
 */
export const emailVerificationCodes = pgTable("email_verification_codes", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull(),
  hashedCode: text("hashed_code").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
  attempts: integer("attempts").notNull().default(0),
  consumedAt: timestamp("consumed_at", { withTimezone: true, mode: "date" }),
  invalidatedAt: timestamp("invalidated_at", { withTimezone: true, mode: "date" }),
  createdAt: now(),
});

export const conversations = pgTable("conversations", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id),
  kind: text("kind").notNull().default("main"),
  lastExtractedMessageId: bigint("last_extracted_message_id", { mode: "number" }),
  lastUserMessageAt: timestamp("last_user_message_at", { withTimezone: true, mode: "date" }),
  createdAt: now(),
});

export const notificationPreferences = pgTable("notification_preferences", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  proactiveEnabled: boolean("proactive_enabled").notNull().default(false),
  checkinsEnabled: boolean("checkins_enabled").notNull().default(true),
  remindersEnabled: boolean("reminders_enabled").notNull().default(true),
  awakeStart: text("awake_start").notNull().default("09:00"),
  awakeEnd: text("awake_end").notNull().default("21:30"),
  createdAt: now(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
});

export const devicePushTokens = pgTable(
  "device_push_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    deviceId: uuid("device_id")
      .notNull()
      .references(() => devices.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expoToken: text("expo_token").notNull().unique(),
    platform: text("platform").notNull(),
    projectId: text("project_id").notNull(),
    permissionStatus: text("permission_status").notNull(),
    status: text("status").notNull().default("active"),
    lastRegisteredAt: timestamp("last_registered_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    invalidatedAt: timestamp("invalidated_at", { withTimezone: true, mode: "date" }),
    lastError: text("last_error"),
    createdAt: now(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    index("device_push_tokens_user_status_idx").on(t.userId, t.status),
    uniqueIndex("device_push_tokens_device_project_idx").on(t.deviceId, t.projectId),
  ],
);

export const proactiveTurns = pgTable(
  "proactive_turns",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    kind: text("kind").notNull().default("friend"),
    localSlotDate: date("local_slot_date").notNull(),
    scheduledFor: timestamp("scheduled_for", { withTimezone: true, mode: "date" }).notNull(),
    eligibilityUserMessageAt: timestamp("eligibility_user_message_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    status: text("status").notNull().default("scheduled"),
    cancellationReason: text("cancellation_reason"),
    promptVersion: text("prompt_version"),
    model: text("model"),
    openedAt: timestamp("opened_at", { withTimezone: true, mode: "date" }),
    repliedAt: timestamp("replied_at", { withTimezone: true, mode: "date" }),
    createdAt: now(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("proactive_turns_user_slot_kind_idx").on(t.userId, t.localSlotDate, t.kind),
    index("proactive_turns_status_scheduled_idx").on(t.status, t.scheduledFor),
  ],
);

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
    /**
     * The mini-game match this row is a turn card for (plan 21). One row per
     * turn (user turn → role 'user', sidekick turn → role 'assistant', empty
     * content); the history join adds the live match payload and marks the
     * match's latest row. Mirrors the `adUnitId` precedent above.
     */
    gameMatchId: uuid("game_match_id").references(() => gameMatches.id),
    tokenEstimate: integer("token_estimate").notNull(),
    promptVersion: text("prompt_version"),
    model: text("model"),
    tokensIn: integer("tokens_in"),
    tokensOut: integer("tokens_out"),
    sensitive: boolean("sensitive").notNull().default(false),
    proactiveTurnId: uuid("proactive_turn_id").references(() => proactiveTurns.id, {
      onDelete: "set null",
    }),
    proactiveSequence: integer("proactive_sequence"),
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
    uniqueIndex("messages_proactive_turn_sequence_idx").on(
      t.proactiveTurnId,
      t.proactiveSequence,
    ),
  ],
);

export const notificationOutbox = pgTable(
  "notification_outbox",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    devicePushTokenId: uuid("device_push_token_id")
      .notNull()
      .references(() => devicePushTokens.id, { onDelete: "cascade" }),
    messageId: bigint("message_id", { mode: "number" }).references(() => messages.id, {
      onDelete: "cascade",
    }),
    kind: text("kind").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    data: jsonb("data").$type<Record<string, unknown>>().notNull(),
    availableAt: timestamp("available_at", { withTimezone: true, mode: "date" }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }),
    status: text("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    expoTicketId: text("expo_ticket_id"),
    lastError: text("last_error"),
    sentAt: timestamp("sent_at", { withTimezone: true, mode: "date" }),
    createdAt: now(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("notification_outbox_token_message_kind_idx").on(
      t.devicePushTokenId,
      t.messageId,
      t.kind,
    ),
    index("notification_outbox_status_available_idx").on(t.status, t.availableAt),
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
    source: text("source").notNull().default("chat"),
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
 * A cosmetic a user owns (plan 20). The catalog itself is code (the
 * `@sidekick/core` catalog), so ownership references a stable `itemKey` — now a
 * renderKey (`${slot}-${variantId}` / `${slot}-c<hex>`) — rather than a
 * catalog-row FK. `slot` is denormalized so "unequip everything in this slot"
 * is one indexed write. Unique per (user, item) gives purchase/grant
 * idempotency — re-granting a dupe is a no-op. `source` records how the item
 * was acquired; the price paid lives on the ledger row.
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
    source: text("source").notNull().default("reward"),
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
 * The single signed ledger every coin and item movement flows through (plan 20
 * decision 2). Grants insert positive `coins` rows, spends insert negative ones,
 * always in the same transaction as the `users.coins` update — so the invariant
 * is simply `users.coins = sum(ledger.coins)`. Even the opening balance is a row
 * (`starter:coins`, +150 at registration), leaving no special cases. `dedupeKey`
 * (unique per user) makes every movement idempotent — cron re-runs and client
 * retries are no-ops; keys look like `starter:coins`, `daily-box:<date>`,
 * `session:<sessionId>`, `purchase:<renderKey>`, `dev-adjust:<uuid>`. `coins` is
 * nullable because item-kind rows carry no coins. `meta` holds the full awarded
 * payload for structured rewards (e.g. daily-box contents + UTC claim instant) so
 * an idempotent replay returns exactly what was granted. `revealedAt` is null
 * until the client has animated the result.
 */
export const ledger = pgTable(
  "ledger",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    source: text("source").notNull(),
    dedupeKey: text("dedupe_key").notNull(),
    kind: text("kind").notNull(),
    itemKey: text("item_key"),
    coins: integer("coins"),
    meta: jsonb("meta"),
    revealedAt: timestamp("revealed_at", { withTimezone: true, mode: "date" }),
    createdAt: now(),
  },
  (t) => [uniqueIndex("ledger_user_id_dedupe_key_idx").on(t.userId, t.dedupeKey)],
);

/**
 * A user's progress through a guided (star) session (plan 20 decision 9). The
 * server holds the authoritative transcript — every answer is posted here — so
 * `extract`/`complete` operate on server-stored `answers` plus the scripted asks
 * from core's `SESSIONS` catalog. `beat` is the current step; `done` guards the
 * one-way completion transition. Unique per (user, session).
 */
export const guidedSessions = pgTable(
  "guided_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    sessionId: text("session_id").notNull(),
    beat: integer("beat").notNull().default(0),
    answers: jsonb("answers").notNull().default([]),
    done: boolean("done").notNull().default(false),
    completedAt: timestamp("completed_at", { withTimezone: true, mode: "date" }),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("guided_sessions_user_id_session_id_idx").on(t.userId, t.sessionId)],
);

/** Extracted profile key/values from guided sessions (plan 20). Unique per (user, key). */
export const sessionFields = pgTable(
  "session_fields",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    key: text("key").notNull(),
    value: text("value").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("session_fields_user_id_key_idx").on(t.userId, t.key)],
);

/** Verbatim captures from guided sessions (plan 20). */
export const sessionNotes = pgTable("session_notes", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id),
  tag: text("tag").notNull(),
  text: text("text").notNull(),
  sessionId: text("session_id"),
  createdAt: now(),
});

/**
 * A chat mini-game match (plan 21): the generic "match" primitive both 8 Ball
 * and Cup Pong ride on. `state` is the engine snapshot (schema owned by
 * `@sidekick/core`, validated at the router); `seed` drives the deterministic
 * sidekick AI + replay; `turnNo` is the count of completed turns (the client's
 * `turnNo` guard). The lifetime record is `count(*) group by winner` over this
 * table per `gameType` — no separate stats table.
 */
export const gameMatches = pgTable(
  "game_matches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id),
    gameType: text("game_type").notNull(),
    initiator: text("initiator").notNull(),
    status: text("status").notNull().default("active"),
    state: jsonb("state").notNull(),
    turnNo: integer("turn_no").notNull().default(0),
    seed: integer("seed").notNull(),
    winner: text("winner"),
    highlights: jsonb("highlights").notNull().default([]),
    createdAt: now(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true, mode: "date" }),
  },
  (t) => [index("game_matches_user_type_status_idx").on(t.userId, t.gameType, t.status)],
);

/**
 * Durable fixed-window rate-limit counters. The in-process limiter these replace
 * counted per lambda, so on Vercel the effective allowance multiplied by however
 * many instances happened to be warm — i.e. it wasn't a limit. One row per key,
 * advanced by a single atomic upsert so concurrent instances share the count.
 */
export const rateLimits = pgTable(
  "rate_limits",
  {
    key: text("key").primaryKey(),
    windowStart: timestamp("window_start", { withTimezone: true, mode: "date" }).notNull(),
    count: integer("count").notNull(),
  },
  (t) => [index("rate_limits_window_start_idx").on(t.windowStart)],
);
