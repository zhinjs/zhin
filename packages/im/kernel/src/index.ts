/**
 * @zhin.js/kernel — 框架无关的运行时内核
 *
 * 提供调度、错误体系、IM identity 和通用工具函数。
 */

// ── Errors ──
export { ZhinError } from './errors.js';

// ── Schedule engine ──
export {
  ScheduleEngine,
  resolveSolarJob,
  resolveLunarJob,
  resolveHolidayJob,
  resolveFreeDayJob,
  resolveWorkdayJob,
  resolveScatterJob,
  getNextRun,
} from './schedule-engine.js';
export type {
  ScheduleFireCallback,
  MemoryScheduleRegistration,
  ScheduleEngineOptions,
  JobContext,
  ResolvedJob,
  ScheduleKind,
} from './schedule-engine.js';
export type { HolidayInput, ScatterInput, FestivalName } from '@zhin.js/schedule';

// ── Heartbeat ──
export { isHeartbeatEmpty } from './heartbeat.js';

// ── IM identity (scene/session keys) ──
export type {
  IMSceneKind,
  IMSceneIdentity,
  ResolveIMSessionIdInput,
} from './im-identity.js';
export {
  resolveIMSceneIdForSession,
  resolveIMSceneSessionId,
  resolveIMSessionId,
} from './im-identity.js';

// ── Utils ──
export { renderTemplatePaths } from './template-paths.js';
export { Time, sleep } from './utils.js';
export type { Dict } from './utils.js';

// ── Redaction (ADR 0061 P1: shared by the decision audit and the message outcome ledger) ──
export {
  isPromptPayloadKey,
  containsChatOwnerClaimCode,
  createChatOwnerClaimCodeScanner,
  foldChatOwnerClaimText,
  isSecretLikeKey,
  matchChatOwnerClaimText,
  redactApprovalDisplay,
  redactChatOwnerClaimText,
  registerChatOwnerClaimCode,
  redactDecisionPayload,
  redactSecretText,
} from './redaction.js';
export type { ChatOwnerClaimCodeScanner, RedactablePayload } from './redaction.js';

// ── Network (#1250 第 46 批: SSRF rules and the pinned download shared by Agent, core and adapters) ──
export {
  checkUrlNetworkAccess,
  hostnameMatchesList,
  isBlockedIpAddress,
  isBlockedSsrfHostname,
  NetworkAccessDeniedError,
} from './network/ssrf.js';
export type { UrlNetworkPolicyConfig } from './network/ssrf.js';
export { bareUrlHost, NodeNetworkTransport } from './network/pinned-transport.js';
export type {
  NetworkAddressLookup,
  NetworkBinaryResponse,
  NetworkTextResponse,
  NetworkTransport,
  NodeNetworkTransportOptions,
  PinnedAddressConnect,
} from './network/pinned-transport.js';
export { fetchPublicMediaBytes, PUBLIC_MEDIA_FETCH_TIMEOUT_MS } from './network/public-media-fetch.js';
export type {
  PublicMediaFetchFailure,
  PublicMediaFetchOptions,
  PublicMediaFetchResult,
} from './network/public-media-fetch.js';
