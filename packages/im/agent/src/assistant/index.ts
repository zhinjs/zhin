export type { AssistantConfig, AssistantDefaultsConfig, AssistantEventsConfig, AssistantQueueConfig } from './config.js';
export type { AssistantHomeConfig, HomePolicyConfig } from './home-config.js';
export {
  resolveAssistantHomeConfig,
  isAssistantHomeActive,
  DEFAULT_HOME_POLICY,
} from './home-config.js';
export { HomeAssistantService, parseEntityDomain } from './domains/home-assistant.js';
export type { HaEntityState, HaFetch } from './domains/home-assistant.js';
export { createHomeTools } from './home-tools.js';
export type { AssistantProfileConfig, AssistantProfile } from './profile-types.js';
export {
  ASSISTANT_PROFILE_VERSION,
  DEFAULT_PROFILE_FILENAME,
  DEFAULT_HEARTBEAT_PROMPT,
  PROFILE_HEARTBEAT_JOB_ID,
  PROFILE_MORNING_BRIEF_JOB_ID,
  PROFILE_BEDTIME_CHECK_JOB_ID,
} from './profile-types.js';
export {
  loadAssistantProfileFile,
  loadBootstrapWithProfile,
  syncProfileHeartbeatToStore,
  syncProfileCronRoutinesToStore,
  mergeProfileDeviceAliases,
  validateAssistantProfile,
  resolveAssistantProfileConfig,
  buildHeartbeatJobFromRoutine,
  buildCronJobFromRoutine,
} from './profile-loader.js';

export { registerJobSchedule, isRuntimeSchedulable } from './job-scheduler.js';
export { validateHomeMcpServer, listConfiguredMcpServerNames, isHomeMcpMode } from './home-mcp-bridge.js';
export type { ScheduleDispose } from './job-scheduler.js';

export { checkHomeToolAccess, toHomeOwnerSignal, toHomeDenyError } from './home-policy.js';

export {
  DEFAULT_ASSISTANT_CONFIG,
  DEFAULT_EVENTS_CONFIG,
  resolveAssistantConfig,
  resolveAssistantDefaultsConfig,
  resolveAssistantEventsConfig,
  resolveAssistantQueueConfig,
  isAssistantEventsActive,
} from './config.js';

export type { AssistantEventRequest, AssistantEventResult, AssistantEventStatus } from './event-types.js';
export { AssistantEventIngress } from './event-ingress.js';
export type { AssistantEventIngressOptions } from './event-ingress.js';
export {
  setAssistantRuntime,
  getAssistantRuntime,
  isAssistantEventsEndpointActive,
  getAssistantEventsTokenFallback,
} from './runtime-registry.js';
export type { AssistantRuntimeHandle } from './runtime-registry.js';

export type {
  AssistantJob,
  AssistantJobFile,
  AssistantJobState,
  JobAction,
  JobNotify,
  JobSchedule,
} from './types.js';
export { ASSISTANT_JOBS_FILENAME, ASSISTANT_JOBS_VERSION } from './types.js';

export {
  assistantCronJobs,
  assistantToCronRecord,
  cronRecordToAssistant,
  schedulerRecordToAssistant,
  messageToIMDeliveryTarget,
  isCronSchedulable,
  jobPrompt,
} from './legacy-convert.js';

export {
  AssistantJobStore,
  createAssistantJobStore,
  getAssistantJobsPath,
} from './job-store.js';
export type { AssistantJobStoreOptions, MigrationResult } from './job-store.js';

export { JobWorker } from './job-worker.js';
export type { JobWorkerOptions } from './job-worker.js';

export { AssistantJobEngine } from './job-engine.js';
export type { AssistantJobEngineOptions } from './job-engine.js';

export {
  createNotificationRouter,
  resolveEffectiveNotify,
  imNotifyToSendOptions,
  parseJobNotify,
} from './notification-router.js';
export type {
  NotificationRouter,
  NotificationRouterDeps,
  DeliverParams,
  DeliverResult,
  ImJobNotify,
} from './notification-router.js';
