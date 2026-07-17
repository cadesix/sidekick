import { fetch as streamingFetch } from "expo/fetch";
import Constants from "expo-constants";
import { createTRPCClient, httpBatchLink, type TRPCLink } from "@trpc/client";
import { observable } from "@trpc/server/observable";
import type { AppRouter } from "@sidekick/server/router";
import { STREAM_META_DELIMITER } from "@sidekick/shared";
import type {
  AttachmentKind,
  Cadence,
  DeviceToolFrameCall,
  LogCheckInInput,
  Schedule,
  StreamMeta,
} from "@sidekick/shared";
import { drainStreamFrames } from "~/features/chat/stream-frames";
import { Platform } from "react-native";
import { TOKEN_STORAGE_KEY, USER_STORAGE_KEY, useAuthStore } from "./auth-store";
import { clearProgressionMirrors } from "./mirror";
import { queryClient } from "./query-client";
import { removeStoredItem } from "./secure-storage";

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
  const locale = Intl.DateTimeFormat().resolvedOptions();
  const headers: Record<string, string> = {
    "accept-language": locale.locale,
    "x-sidekick-timezone": locale.timeZone,
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

/**
 * Drop the local session and return the app to the SignInScreen (19-auth.md):
 * forget the in-memory + stored token, clear the react-query cache and the
 * wardrobe/skin boot mirrors so no previous-user data lingers, and flip the
 * auth store to signed-out. Plain (non-hook) so both the 401 handler here and
 * `useSignOut` share one teardown.
 */
export function signOut(): void {
  authToken = null;
  void removeStoredItem(TOKEN_STORAGE_KEY);
  void removeStoredItem(USER_STORAGE_KEY);
  queryClient.clear();
  void clearProgressionMirrors();
  useAuthStore.setState({ status: "signedOut", userId: null });
}

const UNAUTHORIZED_SIGN_OUT_THRESHOLD = 3;
let consecutiveUnauthorizedCount = 0;

/**
 * A revoked/expired session makes every request 401. After three consecutive
 * UNAUTHORIZED responses, sign out — AuthGate then swaps the app for the
 * SignInScreen. A one-off 401 (e.g. the fire-and-forget registerDevice racing a
 * sign-out) never trips it, and any success resets the counter.
 */
function recordUnauthorized(): void {
  consecutiveUnauthorizedCount += 1;
  if (consecutiveUnauthorizedCount < UNAUTHORIZED_SIGN_OUT_THRESHOLD) {
    return;
  }
  consecutiveUnauthorizedCount = 0;
  signOut();
}

const authErrorLink: TRPCLink<AppRouter> =
  () =>
  ({ next, op }) =>
    observable((observer) =>
      next(op).subscribe({
        next(value) {
          consecutiveUnauthorizedCount = 0;
          observer.next(value);
        },
        error(err) {
          if (err.data?.code === "UNAUTHORIZED") {
            recordUnauthorized();
          }
          observer.error(err);
        },
        complete() {
          observer.complete();
        },
      }),
    );

export const trpc = createTRPCClient<AppRouter>({
  links: [authErrorLink, httpBatchLink({ url: TRPC_URL, headers: authHeaders })],
});

/** The session every auth mutation returns (19-auth.md). */
export type AuthResult = { token: string; userId: string; isNewUser: boolean };

export function authenticateWithApple(identityToken: string): Promise<AuthResult> {
  return trpc.auth.authenticateWithApple.mutate({ identityToken, platform: "ios" });
}

export function authenticateWithGoogle(idToken: string): Promise<AuthResult> {
  return trpc.auth.authenticateWithGoogle.mutate({ idToken });
}

export function requestEmailCode(email: string): Promise<{ ok: boolean }> {
  return trpc.auth.requestEmailCode.mutate({ email });
}

export function verifyEmailCode(email: string, code: string): Promise<AuthResult> {
  return trpc.auth.verifyEmailCode.mutate({ email, code });
}

export function requestPhoneCode(phone: string): Promise<{ ok: boolean }> {
  return trpc.auth.requestPhoneCode.mutate({ phone });
}

export function verifyPhoneCode(phone: string, code: string): Promise<AuthResult> {
  return trpc.auth.verifyPhoneCode.mutate({ phone, code });
}

/** Dev-only instant session — double-gated (client `__DEV__` + server env check). */
export function devLogin(): Promise<AuthResult> {
  return trpc.auth.devLogin.mutate();
}

/** Post-auth device-metadata upsert — repoints this install's push tokens at the caller. */
export function registerDevice(deviceId: string): Promise<{ ok: boolean }> {
  return trpc.auth.registerDevice.mutate({ deviceId });
}

export function logout(): Promise<{ ok: boolean }> {
  return trpc.auth.logout.mutate();
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
 * DEV Chat Lab turn (see server `/dev/chat-lab`): runs the real prod model on an
 * ephemeral transcript with a caller-supplied system prompt, streaming plain
 * text deltas. No tools/frames, no persistence — so the wire is raw text and we
 * can skip `drainStreamFrames` entirely. Throws if the server is unreachable or
 * rejects (dev-gated / unauthorized).
 */
export async function streamChatLab(
  body: { system?: string; messages: { role: "user" | "assistant"; content: string }[] },
  onDelta: (delta: string) => void,
): Promise<void> {
  const response = await streamingFetch(`${API_BASE}/dev/chat-lab`, {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeaders() },
    body: JSON.stringify(body),
  });
  if (!response.ok || !response.body) {
    throw new Error(`chat lab failed (${response.status})`);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    const text = decoder.decode(value, { stream: true });
    if (text.length > 0) onDelta(text);
  }
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

/** Today's goals checklist — the user's active goals with each day's state (03 / 07 §1). */
export type GoalsList = Awaited<ReturnType<typeof trpc.goals.list.query>>;

export function fetchGoals(): Promise<GoalsList> {
  return trpc.goals.list.query();
}

/**
 * Manually mark or clear one day's outcome for a goal (goals.logCheckIn, plan
 * 20 decision 8). `result: null` toggles the day off; the server rejects
 * future dates and cross-user goals.
 */
export function logGoalCheckIn(
  input: LogCheckInInput,
): Promise<{ date: string; outcome: LogCheckInInput["result"] }> {
  return trpc.goals.logCheckIn.mutate(input);
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
  const [created, body] = await Promise.all([
    trpc.chat.createUploadUrl.mutate({
      kind: input.kind,
      mime: input.mime,
      bytes: input.bytes,
      filename: input.filename,
      width: input.width,
      height: input.height,
      durationMs: input.durationMs,
    }),
    fetch(input.uri).then((response) => response.blob()),
  ]);

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

/** The one cold-start progression snapshot (20 §decision 11). */
export type Snapshot = Awaited<ReturnType<typeof trpc.state.snapshot.query>>;

export function fetchSnapshot(): Promise<Snapshot> {
  return trpc.state.snapshot.query();
}

/** Bump the app-open streak — server-idempotent per local day (20 §decision 7). */
export type StreakTouch = Awaited<ReturnType<typeof trpc.streak.touch.mutate>>;

export function touchStreak(): Promise<StreakTouch> {
  return trpc.streak.touch.mutate();
}

/**
 * Claim today's daily box (20 §dailyBox router). The returned `box` is the full
 * persisted contents to animate — a same-day replay returns the identical
 * payload with `granted: false`, so the reveal always shows what was granted.
 */
export type BoxClaim = Awaited<ReturnType<typeof trpc.dailyBox.claim.mutate>>;
export type BoxContents = BoxClaim["box"];

export function claimDailyBox(): Promise<BoxClaim> {
  return trpc.dailyBox.claim.mutate();
}

/** Today's server-computed shop rotation — prices travel in the payload (20 §decision 5). */
export type ShopToday = Awaited<ReturnType<typeof trpc.shop.today.query>>;

export function fetchShopToday(): Promise<ShopToday> {
  return trpc.shop.today.query();
}

/** Buy one catalog item by renderKey; the server prices it (20 §shop router). */
export function purchaseItem(
  itemKey: string,
): Promise<{ stateVersion: number; coins: number; itemKey: string }> {
  return trpc.shop.purchase.mutate({ itemKey });
}

/** The user's cosmetics wardrobe (04 / 07 §10). */
export type Inventory = Awaited<ReturnType<typeof trpc.cosmetics.inventory.query>>;

export function fetchInventory(): Promise<Inventory> {
  return trpc.cosmetics.inventory.query();
}

export function equipCosmetic(itemKey: string): Promise<{ stateVersion: number }> {
  return trpc.cosmetics.equip.mutate({ itemKey });
}

export function unequipCosmetic(itemKey: string): Promise<{ stateVersion: number }> {
  return trpc.cosmetics.unequip.mutate({ itemKey });
}

/** Persist the sidekick's two cel skin colors (20 §cosmetics router). */
export function setSkinColor(body: string, shadow: string): Promise<{ stateVersion: number }> {
  return trpc.cosmetics.setSkin.mutate({ body, shadow });
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

/**
 * Guided (star) sessions — server-authoritative transcript + LLM calls (20
 * §sessions router). Upsert progress after every answer; a failed write is
 * retried by the next answer's cumulative array.
 */
export function saveSessionProgress(
  sessionId: string,
  beat: number,
  answers: string[],
): Promise<{ stateVersion: number }> {
  return trpc.sessions.progress.mutate({ sessionId, beat, answers });
}

/**
 * One in-voice LLM reaction to the just-saved answer. The server derives the ask
 * from the STORED beat, so progress must land first. `text: null` = LLM failure;
 * the caller falls back to its scripted lines.
 */
export function ackSessionAnswer(
  sessionId: string,
  answer: string,
  probe: boolean,
): Promise<{ text: string | null }> {
  return trpc.sessions.ack.mutate({ sessionId, answer, probe });
}

/** The extraction pass over the server-stored transcript; null = model failure. */
export type SessionExtractionRun = NonNullable<
  Awaited<ReturnType<typeof trpc.sessions.extract.mutate>>
>;

export function extractSession(
  sessionId: string,
  corrections?: string[],
): Promise<SessionExtractionRun | null> {
  return trpc.sessions.extract.mutate({ sessionId, corrections });
}

/** What `sessions.complete` persists; rewards come from core's catalog server-side. */
export type SessionExtractionPayload = Parameters<
  typeof trpc.sessions.complete.mutate
>[0]["extraction"];

/** The completion response — new balances for the snapshot patch (20 decision 9). */
export type SessionComplete = Awaited<ReturnType<typeof trpc.sessions.complete.mutate>>;

export function completeSession(
  sessionId: string,
  extraction: SessionExtractionPayload,
): Promise<SessionComplete> {
  return trpc.sessions.complete.mutate({ sessionId, extraction });
}

/**
 * Dev-only progression levers (plan 20 §dev router) — server double-gated to
 * NODE_ENV=development, replacing the DevPanel's old direct store writes. Each
 * preserves the ledger invariant server-side and returns the bumped stateVersion
 * plus the fields it changed, for a compare-before-patch of the snapshot cache.
 */
export function devAdjustCoins(amount: number): Promise<{ stateVersion: number; coins: number }> {
  return trpc.dev.adjustCoins.mutate({ amount });
}

export function devSetBond(bond: number): Promise<{ stateVersion: number; bond: number }> {
  return trpc.dev.setBond.mutate({ bond });
}

export function devSetStreak(count: number): Promise<{ stateVersion: number; count: number }> {
  return trpc.dev.setStreak.mutate({ count });
}

export function devResetSessions(): Promise<{ stateVersion: number; coins: number; bond: number }> {
  return trpc.dev.resetSessions.mutate();
}

export function devResetProfile(): Promise<{ stateVersion: number; coins: number; bond: number }> {
  return trpc.dev.resetProfile.mutate();
}

export function devResetDailyBox(): Promise<{ stateVersion: number; coins: number }> {
  return trpc.dev.resetDailyBox.mutate();
}
