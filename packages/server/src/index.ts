export { appRouter, type AppRouter } from "./routers";
export {
  accountStatus,
  createEmailAccount,
  normalizeEmail,
  registerDevice,
  resolveUserId,
  signInWithEmail,
} from "./auth";
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
  type ScoreResult,
} from "./deep-talks/score";
export {
  startDeepTalk,
  finishDeepTalk,
  settleDeepTalks,
  settleDeepTalkGrants,
  completedDeepTalkSlugs,
  activeDeepTalkForUser,
  DEEP_TALK_REWARD_SPARKS,
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
  ensureStarterCosmetics,
  spinForCheckIn,
  sweepCompletedCheckIns,
  userStreak,
  todayRewardStatus,
  type GrantResult,
  type CheckInReward,
} from "./rewards/service";
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
export { encryptToken, decryptToken } from "./music/encryption";
export {
  mintDeveloperToken,
  appleMusicEnvFromProcess,
  type AppleMusicEnv,
  type DeveloperToken,
} from "./music/dev-token";
export { appleMusicClientForUser, appleMusicClientFromToken } from "./music/client-factory";
