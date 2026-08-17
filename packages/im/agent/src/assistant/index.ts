export type { AssistantConfig, AssistantDefaultsConfig, AssistantEventsConfig, AssistantQueueConfig } from './config.js';
export type { AssistantHomeConfig, HomePolicyConfig, ResolvedHomePolicyConfig } from './home-config.js';
export {
  resolveAssistantHomeConfig,
  isAssistantHomeActive,
  DEFAULT_HOME_POLICY,
  DEFAULT_ALLOWED_SERVICE_DOMAINS,
  DEFAULT_DEBOUNCE_MS,
} from './home-config.js';
export { HaHomeBackend } from './domains/ha-home-backend.js';
export type { HaEntityState, HaFetch, HaServiceResult } from './domains/ha-home-backend.js';
export { parseEntityDomain } from './domains/home-entity.js';
export { HaWsTransport, buildWsUrl } from './domains/ha-ws-transport.js';
export type { HaWsTransportOptions, CreateHaSocket, HaStateChangedEvent } from './domains/ha-ws-transport.js';
export {
  HomeStateWatch,
  buildWatchEntityMap,
  formatStateMessage,
} from './domains/home-state-watch.js';
export type { HomeStateWatchOptions } from './domains/home-state-watch.js';
export { HomeFacade, mapFacadeFailToToolError } from './home-facade.js';
export type { HomeFacadeResult, HomeFacadeOk, HomeFacadeFail, HomeFacadeOptions } from './home-facade.js';
export { createHomeTools } from './home-tools.js';
export type { HomeToolRegistration, HomeToolsOptions } from './home-tools.js';
export {
  bootstrapAssistantHome,
} from './bootstrap-assistant-home.js';
export type {
  BootstrapAssistantHomeOptions,
  BootstrapAssistantHomeResult,
} from './bootstrap-assistant-home.js';
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
  syncProfileRoutinesToStore,
  syncProfileCronRoutinesToStore,
  pruneStaleProfileCronJobs,
  mergeProfileDeviceAliases,
  validateAssistantProfile,
  resolveAssistantProfileConfig,
  buildHeartbeatJobFromRoutine,
  buildScheduleJobFromRoutine,
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
  provideAssistantRuntime,
  getAssistantRuntime,
  isAssistantEventsEndpointActive,
  getAssistantEventsTokenFallback,
} from './runtime-registry.js';
export type { AssistantRuntimeHandle } from './runtime-registry.js';

export type {
  ScheduleJob,
  ScheduleJobFile,
  ScheduleJobState,
  ScheduleJobCreator,
  ScheduleJobExecutionPlan,
  AssistantJob,
  AssistantJobFile,
  AssistantJobState,
  JobAction,
  JobNotify,
  JobSchedule,
} from './types.js';
export {
  SCHEDULE_JOBS_FILENAME,
  SCHEDULE_JOBS_VERSION,
  ASSISTANT_JOBS_FILENAME,
  ASSISTANT_JOBS_VERSION,
} from './types.js';

export { jobPrompt } from './job-utils.js';
export {
  scheduleJobCreatorFromPrincipal,
  parseScheduleJobCreator,
} from './job-creator.js';

export {
  parseExecutionPlanFromArgs,
  parseScheduleJobExecutionPlan,
  parseStringArrayArg,
} from './schedule-execution.js';

export { rehydrateTurnActiveSkills } from './schedule-skills.js';
export {
  addScheduleJob,
  generateScheduleJobId,
  parseScheduleAddFromToolArgs,
  parseScheduleAddFromRpcMessage,
  parseScheduleNotifyFromRpc,
} from './schedule-job-service.js';
export type { ScheduleAddInput, ScheduleInvocationContext } from './schedule-job-service.js';

export {
  ScheduleJobStore,
  AssistantJobStore,
  createScheduleJobStoreFromConfig,
  getScheduleJobsPath,
  getAssistantJobsPath,
} from './job-store.js';
export { createScheduleJobStoreFromConfig as createAssistantJobStore } from './job-store.js';
export type { ScheduleJobStoreOptions } from './job-store.js';

export { JobWorker } from './job-worker.js';
export type { JobWorkerOptions } from './job-worker.js';

export { ScheduleJobEngine, AssistantJobEngine } from './job-engine.js';
export type { ScheduleJobEngineOptions, AssistantJobEngineOptions } from './job-engine.js';

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
