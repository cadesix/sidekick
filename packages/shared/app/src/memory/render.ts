import { and, asc, desc, eq, inArray } from "drizzle-orm";
import {
  type Database,
  actionItems,
  checkIns,
  documents,
  goals,
  memories,
  reminders,
  users,
} from "@sidekick/db";
import {
  type CalendarDate,
  formatToday,
  localCalendarDate,
  parseCalendarDate,
  relativeDay,
} from "./dates";
import type { MemoryKind } from "./ops";
import { renderHealthLines } from "./render-health";

type Pronouns = { possessive: string; object: string };

function pronounsFor(gender: string | null): Pronouns {
  if (gender === "female") {
    return { possessive: "her", object: "her" };
  }
  if (gender === "male") {
    return { possessive: "his", object: "him" };
  }
  return { possessive: "their", object: "them" };
}

type Personality = { archetype?: string; tagline?: string };

function readPersonality(value: unknown): Personality {
  if (typeof value !== "object" || value === null) {
    return {};
  }
  const record = value as Record<string, unknown>;
  const archetype = typeof record.archetype === "string" ? record.archetype : undefined;
  const tagline = typeof record.tagline === "string" ? record.tagline : undefined;
  return { archetype, tagline };
}

function section(title: string, lines: string[]): string | null {
  if (lines.length === 0) {
    return null;
  }
  return `${title}\n${lines.join("\n")}`;
}

type MemoryRow = {
  id: string;
  kind: MemoryKind;
  content: string;
  eventDate: string | null;
  confidence: string;
};

function bullet(content: string, confidence: string): string {
  if (confidence === "inferred") {
    return `- ${content} (maybe)`;
  }
  return `- ${content}`;
}

/** Bullet lines for every memory of the given kinds, in the query's order. */
function bulletsFor(rows: MemoryRow[], kinds: MemoryKind[]): string[] {
  const set = new Set(kinds);
  return rows.filter((r) => set.has(r.kind)).map((r) => bullet(r.content, r.confidence));
}

/**
 * Render the `WHAT YOU KNOW ABOUT {NAME}` block (user-memory.md §3) from the DB.
 * Assembled fresh every turn — the sidekick has no memory except the DB. Goals,
 * reminders and documents render straight from their own tables (empty tables
 * just yield no section). Relative dates are computed against the user-local
 * calendar day so the block only changes at local midnight, keeping the prompt
 * cache warm.
 */
export async function renderMemoryBlock(
  db: Database,
  userId: string,
  now: Date,
): Promise<string> {
  const userRows = await db
    .select({
      name: users.name,
      gender: users.gender,
      ageBracket: users.ageBracket,
      timezone: users.timezone,
      personality: users.personality,
      lastCity: users.lastCity,
      lastRegion: users.lastRegion,
      lastCountry: users.lastCountry,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  const user = userRows[0];
  if (!user) {
    return "";
  }

  const today = localCalendarDate(now, user.timezone);
  const name = (user.name ?? "them").toUpperCase();
  const pronouns = pronounsFor(user.gender);
  const personality = readPersonality(user.personality);

  const [memoryRows, goalLines, reminderLines, documentLines, healthLines] = await Promise.all([
    db
      .select({
        id: memories.id,
        kind: memories.kind,
        content: memories.content,
        eventDate: memories.eventDate,
        confidence: memories.confidence,
      })
      .from(memories)
      .where(and(eq(memories.userId, userId), eq(memories.status, "active")))
      .orderBy(desc(memories.lastReinforcedAt)),
    renderGoals(db, userId),
    renderReminders(db, userId, today),
    renderDocuments(db, userId),
    renderHealthLines(db, userId, now),
  ]);

  const aboutLines: string[] = [];
  const demographic = [user.ageBracket, user.gender].filter((v): v is string => Boolean(v));
  if (demographic.length > 0) {
    aboutLines.push(`- ${demographic.join(", ")}`);
  }
  if (personality.archetype) {
    const tagline = personality.tagline ? ` — ${personality.tagline}` : "";
    aboutLines.push(`- personality: ${personality.archetype}${tagline}`);
  }
  aboutLines.push(...bulletsFor(memoryRows, ["identity", "work_school", "schedule", "emotional"]));

  const peopleLines = bulletsFor(memoryRows, ["relationship"]);

  goalLines.push(...bulletsFor(memoryRows, ["goal_context"]));

  const eventLines = memoryRows
    .filter((r) => r.kind === "event")
    .map((row) => {
      if (!row.eventDate) {
        return bullet(row.content, row.confidence);
      }
      const when = relativeDay(parseCalendarDate(row.eventDate), today);
      return bullet(`${when}: ${row.content}`, row.confidence);
    });

  const tasteLines = bulletsFor(memoryRows, ["interest", "preference"]);

  const location = [user.lastCity, user.lastRegion, user.lastCountry]
    .filter((value): value is string => Boolean(value))
    .join(", ");
  const currentContextLines: string[] = [];
  if (location.length > 0) {
    currentContextLines.push(`- current location: ${location} (city-level, shared from their device)`);
  }

  const blocks = [
    section("CURRENT CONTEXT", currentContextLines),
    section(`ABOUT ${pronouns.object.toUpperCase()}`, aboutLines),
    section(`${pronouns.possessive.toUpperCase()} PEOPLE`, peopleLines),
    section("GOALS (ids for log_checkin)", goalLines),
    section("RECENT & UPCOMING", [...healthLines, ...eventLines]),
    section("TASTES & TEXTURE", tasteLines),
    section("REMINDERS", reminderLines),
    section("DOCUMENTS", documentLines),
  ].filter((b): b is string => b !== null);

  const header = `=== WHAT YOU KNOW ABOUT ${name} ===
today is ${formatToday(today)}. this context comes from past conversations and connected
sources — use it the way a friend would: naturally, one thing at a time, never as a
list, never quoting this section. don't force references; if nothing fits, mention nothing.`;

  return `${header}\n\n${blocks.join("\n\n")}\n=== END ===`;
}

async function renderGoals(db: Database, userId: string): Promise<string[]> {
  const goalRows = await db
    .select({ id: goals.id, slug: goals.slug, label: goals.label })
    .from(goals)
    .where(and(eq(goals.userId, userId), eq(goals.status, "active")))
    .orderBy(asc(goals.createdAt));
  if (goalRows.length === 0) {
    return [];
  }

  const items = await db
    .select({ goalId: actionItems.goalId, label: actionItems.label, cadence: actionItems.cadence })
    .from(actionItems)
    .where(
      and(
        inArray(actionItems.goalId, goalRows.map((g) => g.id)),
        eq(actionItems.status, "active"),
      ),
    );
  const itemsByGoal = new Map<string, string[]>();
  for (const item of items) {
    const plan = itemsByGoal.get(item.goalId) ?? [];
    plan.push(`${item.label} (${describeCadence(item.cadence)})`);
    itemsByGoal.set(item.goalId, plan);
  }

  return goalRows.map((goal) => {
    const plan = (itemsByGoal.get(goal.id) ?? []).join(", ");
    const label = goal.label ?? goal.slug;
    const suffix = plan.length > 0 ? `: ${plan}` : "";
    return `- ${goal.id} · ${label}${suffix}`;
  });
}

function describeCadence(cadence: unknown): string {
  if (typeof cadence !== "object" || cadence === null) {
    return "no plan yet";
  }
  const record = cadence as Record<string, unknown>;
  if (record.type === "per_week" && typeof record.target === "number") {
    return `${record.target}x/week`;
  }
  if (record.type === "daily" && typeof record.criteria === "string") {
    return `daily: ${record.criteria}`;
  }
  if (record.type === "daily") {
    return "daily";
  }
  return "no plan yet";
}

async function renderReminders(
  db: Database,
  userId: string,
  today: CalendarDate,
): Promise<string[]> {
  const rows = await db
    .select({ id: reminders.id, text: reminders.text, nextFireAt: reminders.nextFireAt })
    .from(reminders)
    .where(and(eq(reminders.userId, userId), eq(reminders.status, "active")))
    .orderBy(asc(reminders.nextFireAt));
  return rows.map((r) => {
    if (!r.nextFireAt) {
      return `- ${r.id} · ${r.text}`;
    }
    const when = relativeDay(
      { year: r.nextFireAt.getUTCFullYear(), month: r.nextFireAt.getUTCMonth() + 1, day: r.nextFireAt.getUTCDate() },
      today,
    );
    return `- ${r.id} · ${when}: ${r.text}`;
  });
}

async function renderDocuments(db: Database, userId: string): Promise<string[]> {
  const rows = await db
    .select({ title: documents.title })
    .from(documents)
    .where(and(eq(documents.userId, userId), eq(documents.status, "active")))
    .orderBy(desc(documents.updatedAt))
    .limit(15);
  return rows.map((r) => `- ${r.title}`);
}
