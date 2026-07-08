import { and, desc, eq } from "drizzle-orm";
import { type Database, messages } from "@sidekick/db";
import { type MemoryKind, memoryKindSchema } from "./memory/ops";

/**
 * A guided conversation session (14 §deep talks). Ships as data, same pattern as
 * the goal catalog / funnel manifest. `beats` are the 4–6 prompt beats the model
 * works through one at a time; `targetKinds` are the memory kinds the session is
 * designed to fill; `unlockAtScore` gates the topic behind the context score
 * (0 for the first three, then the ladder).
 */
export type DeepTalk = {
  slug: string;
  title: string;
  teaser: string;
  emoji: string;
  targetKinds: MemoryKind[];
  beats: string[];
  unlockAtScore: number;
};

export const DEEP_TALKS: DeepTalk[] = [
  {
    slug: "your-people",
    title: "your people",
    teaser: "who's in your corner? i wanna know the cast",
    emoji: "🫂",
    targetKinds: ["relationship", "identity"],
    unlockAtScore: 0,
    beats: [
      "who they live with or see most days",
      "their closest friend and the story of how they met",
      "family they're close to — and anyone they're not",
      "a pet, if there is one, and its name",
      "who they turn to when things go sideways",
    ],
  },
  {
    slug: "work-life",
    title: "work life",
    teaser: "what fills your weekdays — the good and the grind",
    emoji: "💼",
    targetKinds: ["work_school", "schedule"],
    unlockAtScore: 0,
    beats: [
      "what they do all day — job, school, or the in-between",
      "how they actually feel about it right now",
      "the shape of a normal week (busy days, quiet days)",
      "a coworker, classmate, or boss who comes up a lot",
      "what they'd rather be doing if money weren't a thing",
    ],
  },
  {
    slug: "taste-check",
    title: "taste check",
    teaser: "the shows, songs, snacks — your whole vibe",
    emoji: "🎧",
    targetKinds: ["interest", "preference"],
    unlockAtScore: 0,
    beats: [
      "what they've had on repeat lately (music, shows, games)",
      "a hobby they'd talk your ear off about",
      "comfort food and comfort media",
      "something they're a little bit of a snob about",
      "an interest most people don't know they have",
    ],
  },
  {
    slug: "daily-rhythms",
    title: "daily rhythms",
    teaser: "how your days actually run, hour to hour",
    emoji: "🌤️",
    targetKinds: ["schedule", "emotional"],
    unlockAtScore: 25,
    beats: [
      "morning routine — or the honest lack of one",
      "when they feel most on vs most drained",
      "how evenings and weekends tend to go",
      "a ritual that keeps them sane",
      "what throws the whole day off when it slips",
    ],
  },
  {
    slug: "the-backstory",
    title: "the backstory",
    teaser: "where you're from and what shaped you",
    emoji: "📖",
    targetKinds: ["identity", "event"],
    unlockAtScore: 40,
    beats: [
      "where they grew up and what it was like",
      "a moment that changed the course of things",
      "the biggest move or leap they've taken",
      "something they're quietly proud of",
      "a chapter they'd happily skip re-reading",
    ],
  },
  {
    slug: "how-you-tick",
    title: "how you tick",
    teaser: "what motivates you, what stresses you out",
    emoji: "🧠",
    targetKinds: ["preference", "emotional"],
    unlockAtScore: 55,
    beats: [
      "what genuinely motivates them (not what should)",
      "how they like to be supported when they're low",
      "what reliably stresses them out",
      "how they recharge for real",
      "a pep talk vs a reality check — which lands better",
    ],
  },
  {
    slug: "money-mind",
    title: "money mind",
    teaser: "how you think about money, no judgment",
    emoji: "💰",
    targetKinds: ["goal_context", "preference"],
    unlockAtScore: 70,
    beats: [
      "how they'd describe their relationship with money",
      "something they happily spend on, guilt-free",
      "a money goal that's actually on their mind",
      "what financial stress looks like for them",
      "what 'enough' would feel like",
    ],
  },
  {
    slug: "dream-big",
    title: "dream big",
    teaser: "the someday stuff — say it out loud",
    emoji: "🌟",
    targetKinds: ["goal_context", "event"],
    unlockAtScore: 85,
    beats: [
      "a dream they don't say out loud much",
      "where they'd love to be in five years",
      "a place they're aching to go",
      "a skill or project they'd start if fear weren't a factor",
      "the first tiny step that would make it real",
    ],
  },
];

const DEEP_TALK_BY_SLUG = new Map(DEEP_TALKS.map((t) => [t.slug, t]));

export function deepTalkBySlug(slug: string): DeepTalk | undefined {
  return DEEP_TALK_BY_SLUG.get(slug);
}

/** Deep talks whose unlock threshold the given context score has reached. */
export function unlockedDeepTalks(score: number): DeepTalk[] {
  return DEEP_TALKS.filter((t) => score >= t.unlockAtScore);
}

export function isDeepTalkUnlocked(talk: DeepTalk, score: number): boolean {
  return score >= talk.unlockAtScore;
}

/**
 * Context-score weights & caps (14 §context score). `n_k` is the count of active
 * memories of that kind. Weights sum to 1, so a fully-filled profile scores 100.
 */
export const CONTEXT_SCORE_TABLE: Record<MemoryKind, { weight: number; cap: number }> = {
  identity: { weight: 0.14, cap: 4 },
  work_school: { weight: 0.1, cap: 3 },
  relationship: { weight: 0.16, cap: 6 },
  schedule: { weight: 0.08, cap: 3 },
  interest: { weight: 0.14, cap: 10 },
  preference: { weight: 0.12, cap: 4 },
  event: { weight: 0.1, cap: 6 },
  emotional: { weight: 0.08, cap: 3 },
  goal_context: { weight: 0.08, cap: 4 },
};

/**
 * The context score (14): `round(100 × Σ_k w_k × min(n_k, c_k) / c_k)`. Pure and
 * monotonic in the counts — it's a progress bar, not a science.
 */
export function computeContextScore(counts: Partial<Record<MemoryKind, number>>): number {
  let fraction = 0;
  for (const kind of memoryKindSchema.options) {
    const { weight, cap } = CONTEXT_SCORE_TABLE[kind];
    const n = counts[kind] ?? 0;
    fraction += weight * (Math.min(n, cap) / cap);
  }
  return Math.round(100 * fraction);
}

/** The in-voice band line shown under the score bar (14 §score UI). */
export type ContextBand = { label: string; line: string };

export function contextBand(score: number): ContextBand {
  if (score < 25) {
    return { label: "just getting started", line: "we're just getting started" };
  }
  if (score < 50) {
    return { label: "getting somewhere", line: "getting somewhere" };
  }
  if (score < 75) {
    return { label: "basically besties", line: "basically besties" };
  }
  return { label: "scary close", line: "scary how well i know you" };
}

/** The 25-point unlock bands, low→high — one exclusive cosmetic each (14 §unlocks). */
export const CONTEXT_BANDS = [25, 50, 75, 100] as const;

/** Bands newly reached moving from `previous` to `next` (never counts backwards). */
export function crossedBands(previous: number, next: number): number[] {
  return CONTEXT_BANDS.filter((b) => previous < b && next >= b);
}

/** The `messages.role` value used for deep-talk session markers (14 runner). */
export const DEEP_TALK_MARKER_ROLE = "deep_talk";

/** How long a started-but-unfinished deep talk stays resumable (14: "48h then expires"). */
export const DEEP_TALK_TTL_MS = 48 * 60 * 60 * 1000;

export type DeepTalkPhase = "start" | "complete";
export type DeepTalkMarker = { phase: DeepTalkPhase; slug: string };

export function encodeDeepTalkMarker(marker: DeepTalkMarker): string {
  return `${marker.phase}:${marker.slug}`;
}

export function parseDeepTalkMarker(content: string): DeepTalkMarker | null {
  const [phase, ...rest] = content.split(":");
  const slug = rest.join(":");
  if ((phase === "start" || phase === "complete") && slug.length > 0) {
    return { phase, slug };
  }
  return null;
}

/** The most recent deep-talk marker in a conversation, or null. */
export async function latestDeepTalkMarker(
  db: Database,
  conversationId: string,
): Promise<{ marker: DeepTalkMarker; createdAt: Date } | null> {
  const rows = await db
    .select({ content: messages.content, createdAt: messages.createdAt })
    .from(messages)
    .where(
      and(
        eq(messages.conversationId, conversationId),
        eq(messages.role, DEEP_TALK_MARKER_ROLE),
      ),
    )
    .orderBy(desc(messages.id))
    .limit(1);
  const row = rows[0];
  if (!row) {
    return null;
  }
  const marker = parseDeepTalkMarker(row.content);
  return marker ? { marker, createdAt: row.createdAt } : null;
}

/**
 * The deep talk currently active in a conversation, or null. Active = the latest
 * marker is a `start` for a known slug within the 48h TTL and not yet completed
 * (a `complete` marker or the TTL clears it, since we read the newest marker).
 */
export async function activeDeepTalk(
  db: Database,
  conversationId: string,
  now: Date = new Date(),
): Promise<DeepTalk | null> {
  const latest = await latestDeepTalkMarker(db, conversationId);
  if (!latest || latest.marker.phase !== "start") {
    return null;
  }
  if (now.getTime() - latest.createdAt.getTime() > DEEP_TALK_TTL_MS) {
    return null;
  }
  return deepTalkBySlug(latest.marker.slug) ?? null;
}
