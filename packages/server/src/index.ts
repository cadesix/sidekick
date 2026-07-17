export { appRouter, type AppRouter } from "./routers";
export {
  createSession,
  getSessionFromAuthHeader,
  revokeSession,
  createAuthToken,
  hashSha256,
  type ResolvedSession,
} from "./auth/sessions";
export { registerDevice } from "./auth/register-device";
export {
  findOrCreateUserForProvider,
  type ProviderIdentity,
  type AuthProvider,
  type FindOrCreateResult,
} from "./auth/provider-user";
export {
  requestEmailCode,
  consumeEmailCode,
  otpEmailHtml,
  type AuthEmailSender,
} from "./auth/email";
export { verifyAppleToken, type VerifiedAppleToken } from "./auth/apple";
export { verifyGoogleIdToken, type VerifiedGoogleToken } from "./auth/google";
export { createTwilioSms, type SmsSender } from "./auth/sms";
export { devLogin, type DevLoginResult } from "./auth/dev-login";
export { RateLimiter, emailRequestLimiter, phoneRequestLimiter } from "./auth/rate-limit";
export type { AppContext, Services, BackgroundScheduler } from "./context";
export {
  beginTurn,
  continueTurn,
  sendChatTurn,
  chatHistory,
  chatHistoryAround,
  chatSearch,
  ensureMainConversation,
  recordDeviceToolResult,
  type TurnOutcome,
  type DeviceToolCall,
  type SearchHit,
} from "./chat/turn";
export {
  runCompaction,
  applyCompaction,
  selectBoundary,
  type Boundary,
} from "./chat/compaction";
export { ingestAttachment, type IngestServices } from "./attachments/ingest";
export { parseFile, type ParsedFile } from "./attachments/parse";
export {
  createUpload,
  markUploaded,
  markRetrying,
  attachmentStatuses,
  type CreateUploadResult,
  type AttachmentStatusView,
} from "./attachments/upload";
export {
  createStorage,
  LocalStorage,
  BlobStorage,
  type Storage,
  type UploadTarget,
} from "./storage";
export { runExtraction, type ExtractionResult } from "./jobs/extraction";
export { runIdleJob, runIdleSweep, findIdleConversations } from "./jobs/idle";
export {
  memoryCountsByKind,
  recomputeContextScore,
  CONTEXT_BAND_REWARD_COINS,
  type ScoreResult,
} from "./deep-talks/score";
export {
  startDeepTalk,
  finishDeepTalk,
  settleDeepTalks,
  settleDeepTalkGrants,
  completedDeepTalkSlugs,
  activeDeepTalkForUser,
  DEEP_TALK_REWARD_COINS,
  type FinishDeepTalkResult,
} from "./deep-talks/session";
export {
  stageChatGptImport,
  commitChatGptImport,
  type ImportCandidate,
  type CommitImportResult,
} from "./deep-talks/import";
export {
  projectAdProfile,
  runAdProfileSweep,
  modelInterestClassifier,
  type AdProfileRow,
  type Interest,
  type InterestClassifier,
} from "./memory/projection";
export { listMemories, forgetMemory, editMemory, type MemoryListItem } from "./memory/store";
export {
  completeOnboarding,
  type CompleteOnboardingInput,
  type CompleteOnboardingResult,
} from "./onboarding/complete";
export {
  identitySentence,
  preferenceSentence,
  goalContextSentence,
  interestsSentence,
  cadencePhrase,
  agePhrase,
  type OnboardingPersonality,
} from "./onboarding/seed";
export {
  adoptGoal,
  ensureGoalPlan,
  type AdoptGoalInput,
  type GoalPlanSummary,
} from "./onboarding/adopt";
export { startOnboardingChat } from "./onboarding/chat";
export {
  grantReward,
  spendCoins,
  bumpStateVersion,
  seedStarterState,
  catalogProduct,
  userStreak,
  assertOwned,
  equipCosmetic,
  unequipCosmetic,
  type GrantOutcome,
  type GrantResult,
  type SpendResult,
} from "./rewards/service";
export { touchStreak, type StreakTouch } from "./rewards/streak";
export {
  claimDailyBox,
  dailyBoxStatus,
  type BoxClaim,
  type BoxContents,
  type DailyBoxStatus,
} from "./rewards/daily-box";
export { buildApp } from "./app";
export { syncHealthDays, healthStatus, disconnectHealth } from "./health/sync";
export { autoLogHealthDay } from "./health/auto-log";
export { adForwardMessages, markMessagesSensitive, type AdWindowMessage } from "./memory/ad-window";
export {
  type AdNetworkClient,
  type AdRequest,
  type AdDeviceSignals,
  type SponsoredAd,
  type AdView,
  type AdDecisionResult,
  type AdSkipReason,
  GravityHttpClient,
  ScriptedAdClient,
  gravityClientFromEnv,
  parseGravityAd,
  deviceSignalsFromHeaders,
  eligibilityGate,
  hasAdConsent,
  isUsCountry,
  recentWindowIsSensitive,
  hasFrequencyHeadroom,
  serveAd,
  adsForMessages,
  recordAdEvent,
  runAdDecision,
  GRAVITY_CHAT_PLACEMENT,
  GRAVITY_CHAT_PLACEMENT_ID,
  ADS_FLAG,
  AD_MAX_PER_DAY,
  AD_MIN_TURNS_APART,
} from "./ads";
export { ingestMusicTaste } from "./music/taste";
export { ExpoPushProvider } from "./notifications/expo-provider";
export { enqueueNotification, sendPendingNotifications, checkNotificationReceipts } from "./notifications/outbox";
export { GENERIC_PROACTIVE_BODY, notificationBody } from "./notifications/policy";
export { registerPushToken, unregisterPushToken } from "./notifications/register";
export type { PushMessage, PushProvider, PushReceipt, PushTicket } from "./notifications/provider";
export { nextProactiveTime, insideAwakeWindow } from "./proactivity/timing";
export { scheduleProactiveTurns, proactiveCancellationReason } from "./proactivity/scheduler";
export { dispatchProactiveTurn, dispatchDueProactiveTurns } from "./proactivity/delivery";
export { encryptToken, decryptToken } from "./music/encryption";
export {
  mintDeveloperToken,
  appleMusicEnvFromProcess,
  type AppleMusicEnv,
  type DeveloperToken,
} from "./music/dev-token";
export { appleMusicClientForUser, appleMusicClientFromToken } from "./music/client-factory";
