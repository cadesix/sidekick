import { TRPCError } from "@trpc/server";
import { and, asc, eq, sql } from "drizzle-orm";
import { type LanguageModel, generateText } from "ai";
import { type Database, guidedSessions, sessionFields, sessionNotes, users } from "@sidekick/db";
import { BOND_MAX, BOND_MIN, type SessionDef, sessionFor } from "@sidekick/core";
import type {
  SessionAckInput,
  SessionAstral,
  SessionCompleteInput,
  SessionExtractInput,
  SessionProgressInput,
} from "@sidekick/shared";
import { bumpStateVersion, grantReward } from "../rewards/service";

// The guided-session engine's persistence + LLM calls (plan 20 decision 9),
// moved server-side from packages/expo's SessionChat.tsx — which used to call
// api.openai.com directly with a key bundled into the app. No client-side model
// key remains; the star chat's calls moved the same way (../star-chat/service).
// The prompts, message
// assembly, token budgets and sanitizers below are a VERBATIM port of that
// carefully-tuned client code; the client keeps the scripted beats and UI phases
// and posts every answer to `sessions.progress`, so extraction and completion
// run over the server-stored transcript plus core's scripted asks — never
// client-supplied script text or reward values.

const NAME = "sidekick";

// shown when the model's analysis didn't parse — only the reading/traits
// fallbacks apply server-side (the client owns the full no-card display case)
const FALLBACK_ANALYSIS: SessionAstral = {
  archetype: "a sky still forming",
  reading:
    "i'm still learning your constellation, but i can already tell there's a lot up there worth mapping. the more we talk, the brighter it all gets. ✦",
  traits: ["curious", "open", "worth knowing"],
};

// A poetic 2-4 word title. Real ones run ~19-25 chars ("the restless
// cartographer"), so this only bites a model that ignored the prompt — but it
// cuts on a word boundary rather than mid-word, because the result is shown to
// the user and spoken over the sidekick's head.
const ARCHETYPE_MAX = 48;

function capArchetype(s: string): string {
  if (s.length <= ARCHETYPE_MAX) return s;
  const cut = s.slice(0, ARCHETYPE_MAX);
  const lastSpace = cut.lastIndexOf(" ");
  if (lastSpace > 0) return cut.slice(0, lastSpace).trim();
  return cut.trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// null when the model gave us nothing usable — NOT a fallback card. The
// difference is load-bearing: `complete` persists whatever it's handed and only
// declines when the card is null, so fabricating one here would overwrite a
// real reading earned by earlier sessions with "a sky still forming".
function parseAnalysis(a: unknown): SessionAstral | null {
  if (!isRecord(a)) return null;
  // capped: the archetype flows into astralNews() and out to the speech bubble,
  // which grows upward until it collides with the star above the head. The
  // prompt asks for 2-4 words, but a model that ignores that shouldn't be able
  // to break the layout.
  let archetype = "";
  if (typeof a.archetype === "string") archetype = capArchetype(a.archetype.trim());
  // The archetype IS the card: it headlines it, and it's the line astralNews
  // speaks over the sidekick's head. So no archetype, no card.
  if (!archetype) return null;
  let reading = "";
  if (typeof a.reading === "string") reading = a.reading.trim();
  // trim + drop blanks: [''] is not a trait
  let traits: string[] = [];
  if (Array.isArray(a.traits)) {
    traits = a.traits
      .filter((t): t is string => typeof t === "string" && !!t.trim())
      .map((t) => t.trim())
      .slice(0, 4);
  }
  if (traits.length === 0) traits = [...FALLBACK_ANALYSIS.traits];
  // a real archetype with a thin reading/traits is still a card — fall those back
  return { archetype, reading: reading || FALLBACK_ANALYSIS.reading, traits };
}

/**
 * One model turn with a custom inline system prompt → the reply text (or null on
 * error, so callers can fall back to a scripted line — the client's contract,
 * unchanged). `maxTokens` defaults small (acks are one line); the extraction
 * pass needs more room since its JSON carries fields + notes + recap + the
 * astral analysis — too tight and the JSON truncates mid-object, JSON.parse
 * throws, and the whole extraction (incl. the session's profile data) is
 * silently lost.
 */
async function llm(
  model: LanguageModel,
  system: string,
  user: string,
  maxTokens = 200,
): Promise<string | null> {
  try {
    const { text } = await generateText({
      model,
      system,
      prompt: user,
      maxOutputTokens: maxTokens,
    });
    if (text.trim()) return text.trim();
    return null;
  } catch {
    return null;
  }
}

/** One short in-voice reaction to an answer (optionally with ONE follow-up). */
function fetchAck(
  model: LanguageModel,
  def: SessionDef,
  ask: string,
  answer: string,
  probe: boolean,
): Promise<string | null> {
  const system =
    `you are ${NAME}, a warm lowercase internet-native friend running a short get-to-know-you chat. ` +
    `the user just answered your question. reply with ONE short specific reaction to what they said (max 18 words)` +
    (probe ? ", then ask ONE short follow-up question about it" : ". do NOT ask a question") +
    ". " +
    (def.sensitive ? "the topic is personal: be gentle, never pry, never joke at their expense. " : "") +
    "no capital letters, no em-dash.";
  return llm(model, system, `you asked: ${ask}\nthey answered: ${answer}`);
}

/**
 * A digest of everything earlier sessions already learned. Feeds the astral card
 * so it reads as ONE person growing clearer, not six unrelated readings. Notes
 * are capped — by the last session there can be a lot of them, and the card only
 * needs the gist.
 */
function priorProfile(
  fields: Record<string, string>,
  notes: { tag: string; text: string }[],
  astral: SessionAstral | null,
): string {
  const f = Object.entries(fields).map(([k, v]) => `${k}: ${v}`);
  const n = notes.slice(-14).map((x) => `${x.tag}: ${x.text}`);
  if (!f.length && !n.length && !astral) return "";
  return (
    `what you ALREADY know about them from earlier star chats (context for the astral card only —\n` +
    `do NOT re-extract any of this into "fields" or "notes"):\n` +
    (f.length ? `${f.join("\n")}\n` : "") +
    (n.length ? `${n.join("\n")}\n` : "") +
    (astral
      ? `\ntheir astral card right now:\narchetype: ${astral.archetype}\nreading: ${astral.reading}\ntraits: ${astral.traits.join(", ")}\n`
      : "") +
    `\n--- this session's transcript (extract fields + notes from THIS ONLY) ---\n`
  );
}

export type ExtractionRun = {
  fields: Record<string, string>;
  notes: { tag: string; text: string }[];
  recap: string;
  analysis: SessionAstral | null;
};

/**
 * The extraction pass: transcript + schema → fields, notes, the recap line, and
 * the refreshed astral card. Null when the model failed or its JSON didn't parse
 * — the client proceeds with an empty extraction and its scripted recap line,
 * exactly as it did when it made this call itself.
 */
async function fetchExtraction(
  model: LanguageModel,
  def: SessionDef,
  transcript: string,
  prior: { fields: Record<string, string>; notes: { tag: string; text: string }[]; astral: SessionAstral | null },
): Promise<ExtractionRun | null> {
  const head = priorProfile(prior.fields, prior.notes, prior.astral);
  const returning = !!head;
  const system =
    `you extract structured profile data from a get-to-know-you chat transcript. respond with ONLY valid JSON, no fences, in this shape:\n` +
    `{"fields": {…}, "notes": [{"tag": "…", "text": "…"}], "recap": "…", "analysis": {"archetype": "…", "reading": "…", "traits": ["…"]}}\n` +
    `- "fields" keys MUST be from: ${def.schema.fields.join(", ") || "(none)"} — short lowercase values, omit anything the user didn't clearly say\n` +
    `- "notes" tags MUST be from: ${def.schema.notes.join(", ")} — text is a short quote-like capture of the user's own words\n` +
    `- "recap" is a 1-2 sentence playful readback of what you learned, as a lowercase internet-native friend, ending with "locked in 🔒". no em-dash.\n` +
    `- "analysis" is their ASTRAL CARD: a warm, high-level, almost-astrology read of who this person is.\n` +
    (returning
      ? `  this is an UPDATE. rewrite the whole card from EVERYTHING you know (the profile above PLUS this transcript),\n` +
        `  so it's richer and more specific than the card they have now. keep what still rings true, deepen it with what's new.\n`
      : `  build it ONLY from what they shared in this transcript.\n`) +
    `  - "archetype": a poetic 2-4 word lowercase title capturing their vibe (e.g. "the midnight builder")\n` +
    `  - "reading": a warm, slightly mystical 2-3 sentence read of who they are — like a personalized horoscope grounded in what they actually said. speak in essence and pattern, not a list of facts. lowercase, no em-dash, no clichés\n` +
    `  - "traits": 3-4 short lowercase trait words${returning ? " drawn from the full picture" : " drawn from the chat"}`;
  // extraction JSON is the biggest payload (fields + notes + recap + analysis) —
  // give it real headroom so it never truncates mid-object
  const reply = await llm(model, system, head + transcript, 900);
  if (!reply) return null;
  try {
    const raw = reply
      .replace(/^```(json)?/m, "")
      .replace(/```\s*$/m, "")
      .trim();
    const parsed: unknown = JSON.parse(raw);
    let obj: Record<string, unknown> = {};
    if (isRecord(parsed)) obj = parsed;
    const fields: Record<string, string> = {};
    if (isRecord(obj.fields)) {
      for (const [key, value] of Object.entries(obj.fields)) {
        if (typeof value === "string") fields[key] = value;
      }
    }
    const notes: { tag: string; text: string }[] = [];
    if (Array.isArray(obj.notes)) {
      for (const note of obj.notes) {
        if (isRecord(note) && typeof note.tag === "string" && typeof note.text === "string") {
          notes.push({ tag: note.tag, text: note.text });
        }
      }
    }
    let recap = "ok, got all of that. locked in 🔒";
    if (typeof obj.recap === "string") recap = obj.recap;
    return { fields, notes, recap, analysis: parseAnalysis(obj.analysis) };
  } catch {
    return null;
  }
}

function sessionDefOrThrow(sessionId: string): SessionDef {
  const def = sessionFor(sessionId);
  if (!def) {
    throw new TRPCError({ code: "BAD_REQUEST", message: `unknown session ${sessionId}` });
  }
  return def;
}

type SessionRow = typeof guidedSessions.$inferSelect;

async function sessionRow(
  db: Database,
  userId: string,
  sessionId: string,
): Promise<SessionRow | undefined> {
  const rows = await db
    .select()
    .from(guidedSessions)
    .where(and(eq(guidedSessions.userId, userId), eq(guidedSessions.sessionId, sessionId)))
    .limit(1);
  return rows[0];
}

/** Stored `answers` jsonb → string[]; anything malformed reads as no answers. */
function parseAnswers(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((a): a is string => typeof a === "string");
}

/**
 * Merge an incoming answers array into the stored one per index. A force-quit
 * mid-session makes the client replay its cumulative array from beat 0, with the
 * pre-restart beats it no longer holds resent as empty strings — those must NOT
 * wipe answers the server already stored. So an empty incoming answer keeps the
 * stored one at that index; a non-empty incoming answer overwrites (a genuine
 * edit still lands); a longer incoming array extends.
 */
function mergeAnswers(stored: string[], incoming: string[]): string[] {
  const length = Math.max(stored.length, incoming.length);
  const merged: string[] = [];
  for (let i = 0; i < length; i += 1) {
    const incomingAt = incoming[i] ?? "";
    const storedAt = stored[i] ?? "";
    merged[i] = incomingAt === "" ? storedAt : incomingAt;
  }
  return merged;
}

/** Stored `users.astral` jsonb → the card, or null when unset/malformed. */
export function parseStoredAstral(value: unknown): SessionAstral | null {
  if (!isRecord(value)) return null;
  if (typeof value.archetype !== "string" || typeof value.reading !== "string") return null;
  let traits: string[] = [];
  if (Array.isArray(value.traits)) {
    traits = value.traits.filter((t): t is string => typeof t === "string");
  }
  return { archetype: value.archetype, reading: value.reading, traits };
}

export type SessionNoteView = { tag: string; text: string; session: string | null; ts: number };

/**
 * The profile as it stands — extracted fields, verbatim notes (append order),
 * and the astral card. Feeds both the extraction's priorProfile digest and the
 * star chat's `sessions.profile` query (kept out of the snapshot — sensitive,
 * not needed at launch).
 */
export async function sessionProfile(
  db: Database,
  userId: string,
): Promise<{ fields: Record<string, string>; notes: SessionNoteView[]; astral: SessionAstral | null }> {
  const fieldRows = await db
    .select({ key: sessionFields.key, value: sessionFields.value })
    .from(sessionFields)
    .where(eq(sessionFields.userId, userId));
  const fields: Record<string, string> = {};
  for (const row of fieldRows) fields[row.key] = row.value;

  const noteRows = await db
    .select({
      tag: sessionNotes.tag,
      text: sessionNotes.text,
      sessionId: sessionNotes.sessionId,
      createdAt: sessionNotes.createdAt,
    })
    .from(sessionNotes)
    .where(eq(sessionNotes.userId, userId))
    .orderBy(asc(sessionNotes.createdAt));
  const notes = noteRows.map((n) => ({
    tag: n.tag,
    text: n.text,
    session: n.sessionId,
    ts: n.createdAt.getTime(),
  }));

  const userRows = await db
    .select({ astral: users.astral })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return { fields, notes, astral: parseStoredAstral(userRows[0]?.astral) };
}

/**
 * Upsert the authoritative transcript after every answer (client: dive out and
 * back in mid-session). Rejected once the session is `done` — a completed
 * transcript is immutable.
 */
export async function saveSessionProgress(
  db: Database,
  userId: string,
  input: SessionProgressInput,
): Promise<{ stateVersion: number }> {
  const def = sessionDefOrThrow(input.sessionId);
  if (input.beat >= def.beats.length) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "beat out of range" });
  }
  return db.transaction(async (tx) => {
    const existing = await sessionRow(tx, userId, def.id);
    if (existing?.done) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "session already completed" });
    }
    const answers = mergeAnswers(parseAnswers(existing?.answers), input.answers);
    const written = await tx
      .insert(guidedSessions)
      .values({ userId, sessionId: def.id, beat: input.beat, answers })
      .onConflictDoUpdate({
        target: [guidedSessions.userId, guidedSessions.sessionId],
        set: { beat: input.beat, answers, updatedAt: new Date() },
        setWhere: sql`${guidedSessions.done} = false`,
      })
      .returning({ id: guidedSessions.id });
    if (written.length === 0) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "session already completed" });
    }
    const stateVersion = await bumpStateVersion(tx, userId);
    return { stateVersion };
  });
}

/**
 * The acknowledgment LLM call. The ask/beat context comes from core's script
 * plus the STORED beat for this user's session row — never client-supplied
 * script text — and the probe flag is clamped by the script's own rules (a
 * probe-less beat or a sensitive session never probes, whatever the client
 * says). Null on LLM failure; the client falls back to its scripted lines.
 */
export async function ackSessionAnswer(
  db: Database,
  model: LanguageModel,
  userId: string,
  input: SessionAckInput,
): Promise<string | null> {
  const def = sessionDefOrThrow(input.sessionId);
  const row = await sessionRow(db, userId, def.id);
  if (!row || row.done) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "no session in progress" });
  }
  const beat = def.beats[row.beat];
  if (!beat) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "no beat to acknowledge" });
  }
  const probe = input.probe === true && beat.probe === true && !def.sensitive;
  return fetchAck(model, def, beat.ask.join(" "), input.answer, probe);
}

/**
 * The extraction pass over SERVER-stored answers + the scripted asks from core —
 * a forged client can't inject transcript. `corrections` re-runs it with the
 * user's recap corrections appended, exactly as the client's confirm loop did.
 * Nothing is persisted here; that's `complete`'s job once the recap is confirmed.
 */
export async function extractSession(
  db: Database,
  model: LanguageModel,
  userId: string,
  input: SessionExtractInput,
): Promise<ExtractionRun | null> {
  const def = sessionDefOrThrow(input.sessionId);
  const row = await sessionRow(db, userId, def.id);
  if (!row) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "no session progress to extract" });
  }
  const answers = parseAnswers(row.answers);
  const body = def.beats
    .map((b, i) => (answers[i] ? `q: ${b.ask.join(" ")}\na: ${answers[i]}` : null))
    .filter((line): line is string => line !== null)
    .join("\n\n");
  const extra = (input.corrections ?? [])
    .map((c) => `\n\ncorrection from the user about your summary: ${c}`)
    .join("");
  const prior = await sessionProfile(db, userId);
  return fetchExtraction(model, def, body + extra, prior);
}

export type CompleteSessionResult = {
  stateVersion: number;
  coins: number;
  bond: number;
  astral: SessionAstral | null;
};

async function currentRewardState(db: Database, userId: string): Promise<CompleteSessionResult> {
  const rows = await db
    .select({
      coins: users.coins,
      bond: users.bond,
      astral: users.astral,
      stateVersion: users.stateVersion,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  const row = rows[0];
  if (!row) {
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "user not found" });
  }
  return {
    stateVersion: row.stateVersion,
    coins: row.coins,
    bond: row.bond,
    astral: parseStoredAstral(row.astral),
  };
}

/**
 * The guarded completion transition, one transaction: mark done, merge the
 * confirmed extraction into `session_fields`/`session_notes`, refresh the astral
 * card (only when this session produced one — a failed extraction must not wipe
 * the reading earlier sessions earned), and pay bond + coins FROM CORE'S CATALOG
 * for this sessionId — the client never supplies reward-bearing values. Coins
 * flow through the ledger with dedupe `session:<sessionId>`; a replayed complete
 * is a safe no-op returning current state.
 */
export async function completeGuidedSession(
  db: Database,
  userId: string,
  input: SessionCompleteInput,
): Promise<CompleteSessionResult> {
  const def = sessionDefOrThrow(input.sessionId);
  const { extraction } = input;
  return db.transaction(async (tx) => {
    const completedAt = new Date();
    const flipped = await tx
      .insert(guidedSessions)
      .values({
        userId,
        sessionId: def.id,
        beat: def.beats.length,
        answers: [],
        done: true,
        completedAt,
      })
      .onConflictDoUpdate({
        target: [guidedSessions.userId, guidedSessions.sessionId],
        set: { beat: def.beats.length, done: true, completedAt, updatedAt: completedAt },
        setWhere: sql`${guidedSessions.done} = false`,
      })
      .returning({ id: guidedSessions.id });
    if (flipped.length === 0) {
      return currentRewardState(tx, userId);
    }

    for (const [key, value] of Object.entries(extraction.fields)) {
      await tx
        .insert(sessionFields)
        .values({ userId, key, value })
        .onConflictDoUpdate({
          target: [sessionFields.userId, sessionFields.key],
          set: { value, updatedAt: completedAt },
        });
    }
    if (extraction.notes.length > 0) {
      await tx
        .insert(sessionNotes)
        .values(extraction.notes.map((n) => ({ userId, tag: n.tag, text: n.text, sessionId: def.id })));
    }

    const userUpdate: { bond: ReturnType<typeof sql>; astral?: SessionAstral } = {
      bond: sql`least(${BOND_MAX}, greatest(${BOND_MIN}, ${users.bond} + ${def.bond}))`,
    };
    if (extraction.astral) userUpdate.astral = extraction.astral;
    const updated = await tx
      .update(users)
      .set(userUpdate)
      .where(eq(users.id, userId))
      .returning({ bond: users.bond, astral: users.astral });
    const user = updated[0];
    if (!user) {
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "user not found" });
    }

    const grant = await grantReward(tx, {
      userId,
      source: "session",
      dedupeKey: `session:${def.id}`,
      outcome: { kind: "coins", amount: def.coins },
    });
    return {
      stateVersion: grant.stateVersion,
      coins: grant.coins,
      bond: user.bond,
      astral: parseStoredAstral(user.astral),
    };
  });
}
