import { fetch as streamingFetch } from "expo/fetch";
import Constants from "expo-constants";
import { createTRPCClient, httpBatchLink } from "@trpc/client";
import type { AppRouter } from "@sidekick/server/router";
import { DEEP_TALK_MARKER_ROLE, STREAM_META_DELIMITER } from "@sidekick/shared";
import type {
  AttachmentKind,
  Cadence,
  DeviceToolFrameCall,
  Schedule,
  StreamMeta,
} from "@sidekick/shared";
import { drainStreamFrames } from "~/features/chat/stream-frames";
import type { AdView, ChatMessage, MessageAttachment } from "./chat-thread";
import { Platform } from "react-native";

/**
 * THE server stitch. Everything the app asks of the backend goes through here so
 * that reconciling with the real routers is a one-file change. Endpoints that
 * exist on `AppRouter` today (`auth`, `chat`) are called through the typed tRPC
 * client; endpoints another engineer is building concurrently (`goals.list`,
 * `chat.search`, `chat.historyAround`) are typed here against plans 03/07/08 and
 * return their empty state until the router lands — see the STITCH markers.
 */

const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:8787";
const TRPC_URL = `${API_BASE}/trpc`;
const STREAM_URL = `${API_BASE}/chat/stream`;
const CONTINUE_URL = `${API_BASE}/chat/continue`;

let authToken: string | null = null;
let authDeviceId: string | null = null;

/** Set by the auth bootstrap once the device has a token (lib/auth.tsx). */
export function setAuthToken(token: string | null, deviceId?: string): void {
  authToken = token;
  if (deviceId !== undefined) {
    authDeviceId = deviceId;
  }
}

function authHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    "accept-language": Intl.DateTimeFormat().resolvedOptions().locale,
    "x-sidekick-timezone": Intl.DateTimeFormat().resolvedOptions().timeZone,
    "x-sidekick-user-agent": `Sidekick/${Constants.expoConfig?.version ?? "1"} (${Platform.OS}; ${String(Platform.Version)})`,
  };
  if (authDeviceId) {
    headers["x-sidekick-device-id"] = authDeviceId;
  }
  if (authToken) {
    headers.authorization = `Bearer ${authToken}`;
  }
  return headers;
}

export const trpc = createTRPCClient<AppRouter>({
  links: [httpBatchLink({ url: TRPC_URL, headers: authHeaders })],
});

export function registerDevice(deviceId: string): Promise<{ userId: string; token: string }> {
  return trpc.auth.register.mutate({ deviceId });
}

export function authStatus(): Promise<{ email: string | null }> {
  return trpc.auth.status.query();
}

export function createEmailAccount(input: {
  email: string;
  password: string;
}): Promise<{ email: string }> {
  return trpc.auth.createEmailAccount.mutate(input);
}

export function signInWithEmail(input: {
  deviceId: string;
  email: string;
  password: string;
}): Promise<{ userId: string; token: string }> {
  return trpc.auth.signIn.mutate(input);
}

export function mainConversationId(): Promise<{ id: string }> {
  return trpc.chat.mainConversation.query();
}

function toRole(role: string): ChatMessage["role"] {
  if (role === "user") {
    return "user";
  }
  if (role === "tool") {
    return "tool";
  }
  return "assistant";
}

/**
 * Server message row → the client's `ChatMessage`. tRPC (no transformer)
 * serializes the server's `Date` to an ISO string over the wire, so `createdAt`
 * arrives as a string and is passed through as-is.
 */
function toChatMessage(row: {
  id: number;
  role: string;
  content: string;
  adUnitId: string | null;
  createdAt: string;
  ad?: AdView | null;
  toolCalls?: unknown;
  attachments?: MessageAttachment[];
}): ChatMessage {
  return {
    id: row.id,
    role: toRole(row.role),
    content: row.content,
    createdAt: row.createdAt,
    adUnitId: row.adUnitId,
    ad: row.ad ?? null,
    toolCalls: row.toolCalls,
    attachments: row.attachments ?? [],
  };
}

/** One page of the endless thread, newest-first (08). */
export async function chatHistory(
  conversationId: string,
  cursor: number | undefined,
  limit: number,
): Promise<ChatMessage[]> {
  const rows = await trpc.chat.history.query({ conversationId, cursor, limit });
  return rows.filter((row) => row.role !== DEEP_TALK_MARKER_ROLE).map(toChatMessage);
}

/**
 * Consume one chat SSE stream to completion: prose → `onDelta`, control frames →
 * their handlers (11/12). Returns any device-tool calls the model surfaced (12) —
 * the caller runs them and re-opens the stream via `streamChatContinuation`.
 */
async function consumeChatStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  onDelta: (delta: string) => void,
  onSearch: (active: boolean) => void,
  onMeta: (meta: StreamMeta) => void,
): Promise<DeviceToolFrameCall[]> {
  const decoder = new TextDecoder();
  const deviceToolCalls: DeviceToolFrameCall[] = [];
  const handlers = {
    onSearch,
    onMeta,
    onDeviceTools: (calls: DeviceToolFrameCall[]) => {
      deviceToolCalls.push(...calls);
    },
  };
  let pending = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }
    pending += decoder.decode(value, { stream: true });
    const { text, rest } = drainStreamFrames(pending, handlers);
    pending = rest;
    if (text.length > 0) {
      onDelta(text);
    }
  }
  /** A truncated control frame at stream end must never leak as visible text. */
  if (pending.length > 0 && !pending.startsWith(STREAM_META_DELIMITER)) {
    onDelta(pending);
  }
  return deviceToolCalls;
}

/**
 * Stream one chat turn. POSTs to the plain fetch-stream endpoint (01 / app.ts),
 * calling `onDelta` for each text chunk as it arrives. Resolves once the reply has
 * streamed, returning any device-tool calls the model made (12) — the caller runs
 * them and calls `streamChatContinuation` to stream the follow-up. The server
 * persists the assistant message in the background, so the caller then revalidates
 * `chatHistory`.
 */
export async function streamChatTurn(
  input: {
    conversationId: string;
    text: string;
    attachmentIds?: string[];
    /** Set when the user swiped-to-reply on an earlier message (imessage chat). */
    replyToId?: number;
  },
  onDelta: (delta: string) => void,
  onSearch: (active: boolean) => void = () => {},
  onMeta: (meta: StreamMeta) => void = () => {},
): Promise<DeviceToolFrameCall[]> {
  const response = await streamingFetch(STREAM_URL, {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeaders() },
    body: JSON.stringify(input),
  });
  if (!response.ok || !response.body) {
    throw new Error(`chat stream failed (${response.status})`);
  }
  return consumeChatStream(response.body.getReader(), onDelta, onSearch, onMeta);
}

/**
 * Resume a turn after its device-tools posted results (12). POSTs to
 * `/chat/continue` with no user text; the server re-reads the tool-call/result
 * rows and streams the follow-up into the same assistant bubble. Returns any
 * further device-tool calls so the caller can loop.
 */
export async function streamChatContinuation(
  conversationId: string,
  onDelta: (delta: string) => void,
  onSearch: (active: boolean) => void = () => {},
  onMeta: (meta: StreamMeta) => void = () => {},
): Promise<DeviceToolFrameCall[]> {
  const response = await streamingFetch(CONTINUE_URL, {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeaders() },
    body: JSON.stringify({ conversationId }),
  });
  if (!response.ok || !response.body) {
    throw new Error(`chat continue failed (${response.status})`);
  }
  return consumeChatStream(response.body.getReader(), onDelta, onSearch, onMeta);
}

/** A goal on the home checklist (03 / 07 §1). */
export type Goal = {
  id: string;
  slug: string;
  label: string;
  count: number;
  doneToday: boolean;
};

/** The home screen's daily summary (goals.list output, 03 / 07 §1). */
export type HomeSummary = { streak: number; checkInAvailable: boolean; goals: Goal[] };

/**
 * Today's home checklist + overall streak (goals router). `count` is the goal's
 * completions this week (the per-goal number goals.list exposes today — see
 * report QUESTIONS re: per-goal streak).
 */
export async function fetchHome(): Promise<HomeSummary> {
  const result = await trpc.goals.list.query();
  return {
    streak: result.streak,
    checkInAvailable: result.checkInStatus === "pending",
    goals: result.goals.map((goal) => ({
      id: goal.goalId,
      slug: goal.slug,
      label: goal.label,
      count: goal.week.completed,
      doneToday: goal.today.outcome === "hit" || goal.today.outcome === "partial",
    })),
  };
}

/** Full-text search over the conversation's messages, newest-first (08 §search). */
export async function searchMessages(
  conversationId: string,
  query: string,
): Promise<ChatMessage[]> {
  const hits = await trpc.chat.search.query({ conversationId, query });
  return hits.map((hit) => ({
    id: hit.id,
    role: toRole(hit.role),
    content: hit.content,
    createdAt: hit.createdAt,
    adUnitId: null,
  }));
}

/**
 * A window of messages centered on `messageId` for jump-to-date / centered mode
 * (08 §jump-to-date). The endpoint returns chronological order; reversed here to
 * newest-first so it feeds `buildChatRows` like every other history page.
 */
export async function historyAround(
  conversationId: string,
  messageId: number,
  span: number,
): Promise<ChatMessage[]> {
  const rows = await trpc.chat.historyAround.query({ conversationId, messageId, span });
  return rows.map(toChatMessage).reverse();
}

/**
 * Ad tracking (05 §metrics). The `SponsoredCard` fires `recordAdImpression` when
 * it appears, `recordAdClick` on tap (before opening the click url in an in-app
 * browser), and `dismissAd` on the "hide ads like this" long-press. Slotting is
 * server-decided — the client never requests ads.
 */
export async function recordAdImpression(adUnitId: string): Promise<unknown> {
  const result = await trpc.ads.impression.mutate({ adUnitId });
  if (result.fresh && result.impressionUrl) {
    await fetch(result.impressionUrl);
  }
  return result;
}

export function recordAdClick(adUnitId: string): Promise<unknown> {
  return trpc.ads.click.mutate({ adUnitId });
}

export function dismissAd(adUnitId: string): Promise<unknown> {
  return trpc.ads.dismiss.mutate({ adUnitId });
}

/** The status/render view of an attachment while the composer holds it (09). */
export type AttachmentStatusView = {
  id: string;
  kind: string;
  status: string;
  mime: string;
  bytes: number;
  url: string;
  caption: string | null;
  transcript: string | null;
  width: number | null;
  height: number | null;
  durationMs: number | null;
};

/**
 * Reserve an attachment + presigned upload target, PUT the bytes straight to it,
 * then tell the server ingest can start (09 §storage). Returns the attachment id
 * the composer tracks and later sends with the message.
 */
export async function uploadAttachment(input: {
  kind: AttachmentKind;
  mime: string;
  bytes: number;
  uri: string;
  filename?: string;
  width?: number;
  height?: number;
  durationMs?: number;
  /** Normalized 0..1 amplitude bars for a voice message, so it survives a reload. */
  waveform?: number[];
}): Promise<{ attachmentId: string }> {
  const created = await trpc.chat.createUploadUrl.mutate({
    kind: input.kind,
    mime: input.mime,
    bytes: input.bytes,
    filename: input.filename,
    width: input.width,
    height: input.height,
    durationMs: input.durationMs,
  });

  const fileResponse = await fetch(input.uri);
  const body = await fileResponse.blob();
  const put = await fetch(created.upload.uploadUrl, {
    method: created.upload.method,
    headers: { ...created.upload.headers, ...authHeaders() },
    body,
  });
  if (!put.ok) {
    throw new Error(`upload failed (${put.status})`);
  }

  await trpc.chat.attachmentUploaded.mutate({
    attachmentId: created.attachmentId,
    waveform: input.waveform,
  });
  return { attachmentId: created.attachmentId };
}

/** Poll ingest status for pending attachments (09 — composer gates send on ready). */
export function attachmentStatus(attachmentIds: string[]): Promise<AttachmentStatusView[]> {
  return trpc.chat.attachmentStatus.query({ attachmentIds });
}

/** Re-run ingest for a failed attachment (09 §retry). */
export function retryAttachment(attachmentId: string): Promise<{ ok: boolean }> {
  return trpc.chat.retryAttachment.mutate({ attachmentId });
}

/** Return a device-tool's result to the server mid-turn (12-life-integrations.md). */
export function submitDeviceToolResult(input: {
  conversationId: string;
  toolCallId: string;
  toolName: string;
  result: unknown;
}): Promise<{ ok: true; messageId: number }> {
  return trpc.chat.deviceToolResult.mutate(input);
}

/** The server mirror of on-device focus state (13-focus-mode.md). No app identity. */
export type FocusSettings = Awaited<ReturnType<typeof trpc.focus.get.query>>;

export function getFocusSettings(): Promise<FocusSettings> {
  return trpc.focus.get.query();
}

/** Mirror the app-identity-free focus state after a native op (13 §chat tools). */
export function updateFocusSettings(patch: {
  enabled?: boolean;
  budgetMinutes?: number | null;
  selectionCount?: number;
}): Promise<FocusSettings> {
  return trpc.focus.update.mutate(patch);
}

/** A folder chip on the documents home (15). */
export type DocumentFolder = { id: string; name: string; emoji: string | null };

/** A row on the documents home. `updatedAt` arrives as an ISO string over tRPC. */
export type DocumentListItem = {
  id: string;
  title: string;
  folderId: string | null;
  folderName: string | null;
  folderEmoji: string | null;
  lastEditedBy: string;
  updatedAt: string;
};

export type DocumentsHome = { folders: DocumentFolder[]; documents: DocumentListItem[] };

export type DocumentDetail = {
  id: string;
  title: string;
  content: string;
  folderId: string | null;
  folderName: string | null;
  folderEmoji: string | null;
  lastEditedBy: string;
  updatedAt: string;
};

export type DocumentVersion = {
  id: string;
  title: string;
  content: string;
  editedBy: string;
  createdAt: string;
};

export function fetchDocuments(): Promise<DocumentsHome> {
  return trpc.documents.list.query();
}

export function fetchDocument(id: string): Promise<DocumentDetail> {
  return trpc.documents.get.query({ id });
}

export function saveDocument(input: {
  id: string;
  title?: string;
  content: string;
}): Promise<{ id: string; title: string; content: string; updatedAt: string }> {
  return trpc.documents.edit.mutate(input);
}

export function deleteDocument(id: string): Promise<{ ok: boolean }> {
  return trpc.documents.delete.mutate({ id });
}

export function moveDocument(id: string, folderId: string | null): Promise<{ ok: boolean }> {
  return trpc.documents.move.mutate({ id, folderId });
}

export function fetchDocumentVersions(documentId: string): Promise<DocumentVersion[]> {
  return trpc.documents.versions.query({ documentId });
}

export function restoreDocumentVersion(
  versionId: string,
): Promise<{ id: string; title: string; content: string; updatedAt: string }> {
  return trpc.documents.restore.mutate({ versionId });
}

export function createFolder(name: string): Promise<DocumentFolder> {
  return trpc.documents.createFolder.mutate({ name });
}

/** One reminder as the manage screen sees it (10 §screen). */
export type Reminder = {
  id: string;
  text: string;
  schedule: Schedule | null;
  status: string;
  nextFireAt: string | null;
};

/** The reminders screen's three sections (reminders.list output, 10 §screen). */
export type ReminderSections = { today: Reminder[]; upcoming: Reminder[]; paused: Reminder[] };

export function fetchReminders(): Promise<ReminderSections> {
  return trpc.reminders.list.query();
}

export function updateReminder(input: {
  id: string;
  text?: string;
  schedule?: Schedule;
}): Promise<{ ok: boolean }> {
  return trpc.reminders.update.mutate(input);
}

export function pauseReminder(id: string): Promise<{ ok: boolean; status: "paused" }> {
  return trpc.reminders.pause.mutate({ id });
}

export function resumeReminder(id: string): Promise<{ ok: boolean; status: "active" }> {
  return trpc.reminders.resume.mutate({ id });
}

export function deleteReminder(id: string): Promise<{ ok: boolean }> {
  return trpc.reminders.remove.mutate({ id });
}

/** Server-authoritative profile (07 onboarding stitch). Drives first-launch routing. */
export type Me = Awaited<ReturnType<typeof trpc.users.me.query>>;

export function fetchMe(): Promise<Me> {
  return trpc.users.me.query();
}

/** Incremental funnel profile save (02 §port strategy). */
export type ProfileUpdate = Parameters<typeof trpc.users.updateProfile.mutate>[0];

export function updateProfile(input: ProfileUpdate): Promise<{ ok: boolean }> {
  return trpc.users.updateProfile.mutate(input);
}

/** Funnel completion — the cold-start seed transaction (02 / user-memory §6). */
export type OnboardingCompleteInput = Parameters<typeof trpc.onboarding.complete.mutate>[0];

export function completeOnboarding(
  input: OnboardingCompleteInput,
): Promise<{ ok: boolean; alreadyComplete: boolean }> {
  return trpc.onboarding.complete.mutate(input);
}

/** Open (or resume) the LLM-driven onboarding chat (02 §onboarding chat). */
export function startOnboardingChat(goalSlugs: string[]): Promise<{ conversationId: string }> {
  return trpc.onboarding.startChat.mutate({ goalSlugs });
}

/** Count of sidekick-made documents (07 home "Made for you" row, 15). */
export async function fetchDocumentCount(): Promise<number> {
  const home = await trpc.documents.list.query();
  return home.documents.length;
}

/** Connected-integrations surface (12-life-integrations.md). */
export type HealthDay = Parameters<typeof trpc.health.sync.mutate>[0]["days"][number];

export function syncHealth(days: HealthDay[]): Promise<{ synced: number; logged: number }> {
  return trpc.health.sync.mutate({ days });
}

export function healthStatus() {
  return trpc.health.status.query();
}

export function disconnectHealth() {
  return trpc.health.disconnect.mutate();
}

export function updateLocation(input: {
  city: string;
  region?: string;
  country?: string;
  timezone?: string;
}): Promise<{ ok: boolean; timezoneChanged: boolean }> {
  return trpc.location.update.mutate(input);
}

export function locationStatus() {
  return trpc.location.status.query();
}

export function disconnectLocation() {
  return trpc.location.disconnect.mutate();
}

export function connectMusic(userToken: string, storefront?: string) {
  return trpc.music.connect.mutate({ userToken, storefront });
}

export function musicStatus() {
  return trpc.music.status.query();
}

export function disconnectMusic() {
  return trpc.music.disconnect.mutate();
}

/**
 * Fetch a short-lived Apple Music developer token from our endpoint (12 §music).
 * Returns null on a 501 (env unconfigured) so the UI can hide the feature.
 */
export async function fetchMusicDeveloperToken(): Promise<string | null> {
  const response = await fetch(`${API_BASE}/music/developer-token`, { headers: authHeaders() });
  if (!response.ok) {
    return null;
  }
  const body: { token: string } = await response.json();
  return body.token;
}

/** Adopt a goal from the catalog (07 §5 add-goal). */
export function adoptGoal(input: {
  slug: string;
  actionSlug?: string;
  cadence?: Cadence;
  label?: string;
}): Promise<unknown> {
  return trpc.goals.adopt.mutate(input);
}

/** One goal's detail: cadence, per-goal streak, week strip, history (07 §4). */
export type GoalDetail = Awaited<ReturnType<typeof trpc.goals.detail.query>>;

export function fetchGoalDetail(goalId: string): Promise<GoalDetail> {
  return trpc.goals.detail.query({ goalId });
}

export function adjustGoalCadence(goalId: string, cadence: Cadence): Promise<{ ok: boolean }> {
  return trpc.goals.adjust.mutate({ goalId, cadence });
}

export function pauseGoal(goalId: string): Promise<{ ok: boolean; status: "paused" }> {
  return trpc.goals.pause.mutate({ goalId });
}

export function completeGoal(goalId: string): Promise<{ ok: boolean; status: "done" }> {
  return trpc.goals.complete.mutate({ goalId });
}

/** The user's cosmetics wardrobe (04 / 07 §10). */
export type Inventory = Awaited<ReturnType<typeof trpc.cosmetics.inventory.query>>;

export function fetchInventory(): Promise<Inventory> {
  return trpc.cosmetics.inventory.query();
}

export function equipCosmetic(itemKey: string): Promise<{ ok: boolean }> {
  return trpc.cosmetics.equip.mutate({ itemKey });
}

export function unequipCosmetic(itemKey: string): Promise<{ ok: boolean }> {
  return trpc.cosmetics.unequip.mutate({ itemKey });
}

export function redeemCosmetic(itemKey: string): Promise<{ ok: boolean; sparks: number }> {
  return trpc.cosmetics.redeem.mutate({ itemKey });
}

/** Whether the home screen should present today's reward spinner (04 / 07 §6). */
export type RewardStatus = Awaited<ReturnType<typeof trpc.cosmetics.rewardStatus.query>>;

export function fetchRewardStatus(): Promise<RewardStatus> {
  return trpc.cosmetics.rewardStatus.query();
}

/** The server-authoritative spinner result (04). The client only animates it. */
export type SpinResult = Awaited<ReturnType<typeof trpc.cosmetics.spin.mutate>>;

export function spinReward(checkInId: string): Promise<SpinResult> {
  return trpc.cosmetics.spin.mutate({ checkInId });
}

/** The "how well your sidekick knows you" surface: score card + deep-talk shelf (14). */
export type DeepTalkShelf = Awaited<ReturnType<typeof trpc.deepTalks.shelf.query>>;
export type DeepTalkCard = DeepTalkShelf["talks"][number];

export function fetchDeepTalkShelf(): Promise<DeepTalkShelf> {
  return trpc.deepTalks.shelf.query();
}

/** Start a guided deep talk; returns the main conversation to open into (14). */
export function startDeepTalk(slug: string): Promise<{ conversationId: string; slug: string }> {
  return trpc.deepTalks.start.mutate({ slug });
}

/** Settle a just-finished deep talk after a streamed turn (immediate payoff, 14). */
export function finishDeepTalk(
  conversationId: string,
): Promise<{ applied: number; score: number; previousScore: number }> {
  return trpc.deepTalks.finish.mutate({ conversationId });
}

/** One staged memory the user reviews before an import commits (14 §import). */
export type ImportCandidate =
  Awaited<ReturnType<typeof trpc.deepTalks.importStage.mutate>>["candidates"][number];

export async function stageChatgptImport(text: string): Promise<ImportCandidate[]> {
  const result = await trpc.deepTalks.importStage.mutate({ text });
  return result.candidates;
}

export type ImportCommitResult = Awaited<ReturnType<typeof trpc.deepTalks.importCommit.mutate>>;

export function commitChatgptImport(candidates: ImportCandidate[]): Promise<ImportCommitResult> {
  return trpc.deepTalks.importCommit.mutate({ candidates });
}
