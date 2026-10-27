export { LocalImageAssetStore, localImageAssetsToken } from './media/local-image-assets.js';
/**
 * AI Agent runtime and generation-owned support resources.
 *
 * Agent Tools are owned by `@zhin.js/tool` and published through the
 * generation ToolIndex. AgentResourceHub owns skills, subagents, and hooks;
 * MCP connections are generation-owned by `@zhin.js/mcp-feature`.
 * @module @zhin.js/agent
 */

// ── Agent-specific modules ──

export { AIService } from './service.js';
export type { AIServiceConfig } from './service.js';
export type { ServiceAgent, ServiceAgentResult, CreateServiceAgentOptions } from './service.js';
export { createAgentSession } from './create-agent-session.js';
export type { AgentSessionHandle, CreateAgentSessionOptions } from './create-agent-session.js';
export { PluginAILoopHookRegistry } from './plugin-loop-hooks.js';
export type {
  PluginBeforeToolCallHandler,
  PluginAfterToolCallHandler,
  PluginTransformContextHandler,
} from './plugin-loop-hooks.js';

export { ZhinAgent } from './zhin-agent/index.js';
export type { AgentTurnConfiguration, AgentTurnRequest } from './zhin-agent/index.js';
export {
  pluginToolToAgentTool,
  agentToolToLlmTool,
  agentToolsToLlmTools,
} from './tool-bridge.js';
export type { NormalizableTool } from './tool-bridge.js';
export type {
  ZhinAgentConfig,
  OnChunkCallback,
} from './config/index.js';
export type {
  IAgentTurnProcessor,
  IAgentSessionManager,
  IAgentDiagnostics,
  IAgentConfigurator,
} from './config/agent-interfaces.js';
export type {
  TurnEvent, TurnUsage,
  TurnStartEvent, ChunkEvent, CapabilityResolutionEvent, IterationStartEvent,
  ToolCallEvent as TurnToolCallEvent,
  ToolResultEvent,
  ThinkingEvent, TurnEndEvent, TurnErrorEvent,
  TurnBudgetExceededEvent,
  SubagentStartEvent, SubagentProgressEvent, SubagentEndEvent,
  McpConnectEvent, McpToolCallEvent,
} from './event/turn-event.js';
export {
  createTurnIngress,
  resolveTurnContextValue,
  turnPermissionSubject,
} from './turn/turn-ingress.js';
export { executeAgentTurn } from './turn/execute-agent-turn.js';
export type { TurnEventObserver, TurnEventSource } from './turn/execute-agent-turn.js';
export type {
  ActivityPort,
  DeliveryIntent,
  DeliveryOutcome,
  DeliveryPort,
  FrozenCapabilityCatalog,
  ReplyPort,
  TurnIdentity,
  TurnAccessContext,
  TurnIngress,
  TurnIngressInput,
  TurnIntent,
  TurnIntentKind,
  TurnJournalPort,
  TurnInput,
  TurnMedia,
  TurnOrigin,
  TurnOutcome,
  TurnPolicyContext,
  TurnExecutionProfile,
  TurnPorts,
  TurnPrincipal,
  TurnRequest,
  TurnRequestPorts,
  TurnScope,
  TurnSessionAddress,
} from './turn/turn-ingress.js';

export {
  DEFAULT_CONFIG as ZHIN_AGENT_DEFAULT_CONFIG,
  DEFAULT_ALWAYS_LOADED_TOOLS,
  SECTION_SEP,
} from './config/index.js';
export { MODEL_HARNESS_DEFAULTS, resolveModelHarness, mergeModelHarnessValues } from './config/model-harness-runtime.js';
export type { ModelHarnessRow, ResolvedModelHarness, ModelHarnessConfig } from './config/model-harness.js';
export {
  checkExecPolicy, applyExecPolicyToTools, resolveExecAllowlist, EXEC_PRESETS,
  isDangerousCommand, stripEnvVarPrefix, stripSafeWrappers, splitCompoundCommand, extractCommandName,
  type ExecPolicyResult,
} from './security/exec-policy.js';
export {
  OWNER_APPROVE_ALWAYS_TOOL,
  OwnerApprovalRuntime,
} from './security/owner-approval-runtime.js';
export type {
  OwnerApprovalAddress,
  OwnerApprovalCommandContext,
  ToolRequesterRole,
} from './security/owner-approval-runtime.js';
export { managementCommandText } from './init/command-presentation.js';
export {
  handleRuntimeManagementCommand,
} from './init/runtime-management-commands.js';
export type {
  RuntimeManagementDeps,
  RuntimeManagementSenderRoles,
} from './init/runtime-management-commands.js';
export {
  buildRichSystemPrompt,
  buildLiteSystemPrompt,
  buildUserMessageWithHistory,
  describePromptSectionsForDebug,
  createDefaultPromptAssemblyRegistry,
  enforcePromptBudget,
} from './prompt/system-prompt.js';
export type { RichSystemPromptContext, PromptSectionDebugInfo } from './prompt/system-prompt.js';
export { PromptAssemblyRegistry } from './prompt/prompt-assembly-registry.js';
export type {
  PromptAssemblyEntry,
  PromptAssemblySection,
  PromptSectionRegistry,
} from './prompt/prompt-assembly-registry.js';
export { promptAssemblyToken } from './prompt/tokens.js';
export type { PromptAssemblyToken, PromptAssemblyResource } from './prompt/tokens.js';
export {
  defineAgentPromptSection,
  isPromptSectionIndex,
  PromptSectionIndex,
  promptSectionFeatureId,
} from '@zhin.js/prompt-section';
export type {
  AgentPromptSectionDefinition,
  AgentPromptSectionInput,
  PromptProfile,
  PromptSectionDescriptor,
  PromptSectionLayer,
  PromptSectionRetention,
} from '@zhin.js/prompt-section';
export {
  buildAgentsEnvelopeContext,
  collectAgentsInstructionChain,
} from './context/agents-instruction.js';
export type { AgentsInstructionEntry } from './context/agents-instruction.js';
export {
  resolveWorkspacePrompt,
} from './prompt/workspace-prompt.js';
export type { WorkspacePromptRole } from './prompt/workspace-prompt.js';
export { createUserProfileTool } from './tool/context-tools.js';
export { createSpawnTaskTool } from './spawn/spawn-task-tool.js';
export * from './interaction/index.js';

export {
  UserProfileStore,
  AI_USER_PROFILE_MODEL,
  USER_PROFILE_KEYS,
  USER_PROFILE_VALUE_MAX_CHARS,
  normalizeUserProfileKey,
  type UserProfileKey,
} from './user-profile.js';
export {
  UserRelationStore,
  AI_USER_RELATION_MODEL,
  USER_RELATIONS,
  applyAffinitySignal,
  deriveRelation,
  type UserRelation,
  type UserRelationRecord,
} from './user-relation.js';
export {
  formatSceneEventsBlock,
  SCENE_EVENTS_HEADER,
  SCENE_EVENTS_MAX_CHARS,
  SCENE_EVENTS_MAX_LINES,
  SCENE_WAKE_METADATA_KEY,
} from './scene-events.js';
export {
  SessionProfileStore,
  AI_SESSION_PROFILE_MODEL,
  foldConversationEvent,
  speakBlock,
  sceneRoleOf,
  sceneKeyOf,
  type SessionProfileRecord,
  type SessionScope,
  type SpeakBlockReason,
} from './session-profile.js';
export {
  AI_DECISION_EVENTS_TABLE,
  AI_DECISION_EVENT_MODEL,
  DECISION_ACTORS,
  DECISION_EVENT_KINDS,
  DECISION_OUTCOMES,
  DECISION_REASON_CODES,
  DEFAULT_DECISION_AUDIT_RETENTION_DAYS,
  DecisionEventValidationError,
  createDecisionEvent,
  decisionEventFromRow,
  decisionEventToExport,
  decisionEventToRow,
  redactDecisionPayload,
  speakBlockReasonCode,
  type DecisionActor,
  type DecisionEventInput,
  type DecisionEventKind,
  type DecisionEventRecord,
  type DecisionEventRow,
  type DecisionOutcome,
  type DecisionPayload,
  type DecisionReasonCode,
} from './decision-events.js';
export {
  DecisionEventLog,
  DECISION_EVENT_RECENT_LIMIT,
  DECISION_EVENT_QUERY_DEFAULT_LIMIT,
  DECISION_EVENT_QUERY_MAX_LIMIT,
  type DecisionEventQuery,
  type DecisionEventReader,
} from './decision-event-log.js';
export {
  AI_CONTROL_STATE_MODEL,
  AI_CONTROL_STATE_ROW_ID,
  AI_CONTROL_STATE_TABLE,
  AiControlPlane,
  CONTROL_OFF,
  CONTROL_STATE_RETRY_MS,
  CONTROL_SWITCHES,
  ControlRevisionConflictError,
  ControlUnavailableError,
  ControlValidationError,
  MAX_CONTROL_SESSION_OVERRIDES,
  MAX_CONTROL_TEMPORARY_OVERRIDES,
  evaluateControl,
  parseControlDocument,
  type ControlChange,
  type ControlFlags,
  type ControlFlagsPatch,
  type ControlGateInput,
  type ControlLevel,
  type ControlSessionOverride,
  type ControlSetInput,
  type ControlSetResult,
  type ControlSnapshot,
  type ControlStateModel,
  type ControlSwitch,
  type ControlTemporaryInput,
  type ControlTemporaryOverride,
  type ControlTemporarySource,
  type ControlVerdict,
} from './control-plane.js';
export {
  AI_SESSION_OPS_MODEL,
  AI_SESSION_OPS_ROW_ID,
  AI_SESSION_OPS_TABLE,
  AiSessionOps,
  BUILTIN_SESSION_OPS_DEFAULTS,
  DEFAULT_COLD_FIELD_DURATION_MS,
  DEFAULT_COLD_FIELD_THRESHOLD,
  DEFAULT_OPS_COOLDOWN_MS,
  DEFAULT_WELCOME_MAX_PER_HOUR,
  DEFAULT_WELCOME_MERGE_WINDOW_MS,
  DEFAULT_WELCOME_TEMPLATE,
  MAX_COLD_FIELD_DURATION_MS,
  MAX_COLD_FIELD_THRESHOLD,
  MAX_OPS_COOLDOWN_MS,
  MAX_SESSION_OPS_ENTRIES,
  MIN_COLD_FIELD_DURATION_MS,
  SESSION_OPS_RETRY_MS,
  SessionOpsRevisionConflictError,
  SessionOpsUnavailableError,
  SessionOpsValidationError,
  WELCOME_TEMPLATE_VARS,
  parseSessionOpsDocument,
  renderWelcomeTemplate,
  unknownTemplateVars,
  type SessionColdFieldConfig,
  type SessionColdFieldPatch,
  type SessionGroupOpsConfig,
  type SessionGroupOpsPatch,
  type SessionLeaveConfig,
  type SessionOpsChange,
  type SessionOpsConfig,
  type SessionOpsEntry,
  type SessionOpsModel,
  type SessionOpsPatch,
  type SessionOpsSetInput,
  type SessionOpsSetResult,
  type SessionOpsSnapshot,
  type SessionWelcomeConfig,
  type WelcomeMember,
  type WelcomePart,
  type WelcomeRender,
  type WelcomeTemplateVar,
} from './session-ops.js';
export {
  AI_ANNOUNCEMENTS_TABLE,
  AI_ANNOUNCEMENT_MODEL,
  ANNOUNCEMENT_CREATED_VIA,
  ANNOUNCEMENT_STATUSES,
  ANNOUNCEMENT_TERMINAL_STATUSES,
  AiAnnouncements,
  AnnouncementNotFoundError,
  AnnouncementRevisionConflictError,
  AnnouncementStateError,
  AnnouncementUnavailableError,
  AnnouncementValidationError,
  DEFAULT_ANNOUNCEMENT_APPROVAL_TTL_MS,
  MAX_ANNOUNCEMENT_CONTENT_CHARS,
  MAX_ANNOUNCEMENT_ERROR_CHARS,
  announcementContentHash,
  announcementFromRow,
  announcementToRow,
  clipAnnouncementError,
  isAnnouncementTerminal,
  type AnnouncementActor,
  type AnnouncementAuditSink,
  type AnnouncementCreatedVia,
  type AnnouncementModel,
  type AnnouncementMutationInput,
  type AnnouncementRecord,
  type AnnouncementSendResultInput,
  type AnnouncementStatus,
  type AnnouncementTransition,
  type CreateAnnouncementInput,
} from './announcements.js';
export {
  AI_SESSION_EVENTS_TABLE,
  AI_SESSION_EVENT_MODEL,
  AiSessionEvents,
  DEFAULT_SESSION_EVENT_GRACE_MS,
  DEFAULT_SESSION_EVENT_TEMPLATE,
  DEFAULT_SESSION_EVENT_TIMEZONE,
  MAX_SESSION_EVENT_HORIZON_MS,
  MAX_SESSION_EVENT_REMIND_BEFORE_MS,
  MAX_SESSION_EVENT_REMIND_OFFSETS,
  MAX_SESSION_EVENT_TEMPLATE_CHARS,
  MAX_SESSION_EVENT_TITLE_CHARS,
  SESSION_EVENT_CREATED_VIA,
  SESSION_EVENT_STATUSES,
  SESSION_EVENT_TEMPLATE_VARS,
  SessionEventNotFoundError,
  SessionEventRevisionConflictError,
  SessionEventStateError,
  SessionEventUnavailableError,
  SessionEventValidationError,
  createSessionEventTimer,
  formatSessionEventAt,
  formatSessionEventIn,
  pendingSessionEventReminders,
  renderSessionEventTemplate,
  sessionEventFromRow,
  sessionEventOffsets,
  sessionEventToRow,
  type CreateSessionEventInput,
  type MarkSessionEventFiredInput,
  type MarkSessionEventFiredResult,
  type SessionEventAuditSink,
  type SessionEventCreatedVia,
  type SessionEventModel,
  type SessionEventMutationInput,
  type SessionEventRecord,
  type SessionEventReminder,
  type SessionEventRender,
  type SessionEventStatus,
  type SessionEventTemplateVar,
  type SessionEventTimer,
  type SessionEventTransition,
  type SessionEventsOptions,
  type UpdateSessionEventInput,
} from './session-events.js';

// ── Capability Seam ────────────────────────────────────────────────────────
export type {
  SeamProvider,
  SeamScope,
  ToolService,
  ToolServiceProvider,
  ToolSchema,
  ToolExecutionResult,
  SkillService,
  SkillServiceProvider,
  CapabilitySeamToken,
  ProjectedSeamTool,
  ProjectedSeamSkill,
} from './seam/index.js';
export { SeamProviderRegistry, SeamIntegration } from './seam/index.js';
export { capabilitySeamToken } from './seam/index.js';
export { BuiltinToolService } from './builtins/builtin-tool-service.js';
export { SkillRegistryAsService } from './skill/skill-registry-as-service.js';

export { SubagentSystem } from './subagent/index.js';
export { SubagentRuntime } from './subagent/subagent-runtime.js';
export type {
  SubagentOrigin, SubagentResultDelivery, SubagentResultSender, SpawnOptions, SubagentRuntimeOptions,
  SubagentCompletePayload,
} from './subagent/index.js';
export { RESERVED_TOOL_NAMES, RESERVED_TOOL_NAME_PREFIXES } from './reserved-tools.js';

export {
  stampToolGeneration,
} from './tool/tool-system.js';
export { FileJournalStore } from './journal/index.js';
export { PersistentTurnJournal } from './journal/index.js';

export {
  createScheduleTools,
  generateScheduleJobId,
  SCHEDULE_JOBS_FILENAME,
} from './schedule-manager.js';
export type { ScheduleManager, ScheduleToolRegistration } from './schedule-manager.js';

export {
  ScheduleJobEngine,
  ScheduleJobStore,
  AssistantEventIngress,
  JobWorker,
  createScheduleJobStoreFromConfig,
  getScheduleJobsPath,
  resolveAssistantConfig,
  resolveAssistantDefaultsConfig,
  resolveAssistantEventsConfig,
  isAssistantEventsActive,
  createNotificationRouter,
  imNotifyToSendOptions,
  parseJobNotify,
  SCHEDULE_JOBS_VERSION,
  syncProfileRoutinesToStore,
  scheduleJobCreatorFromPrincipal,
  parseScheduleJobCreator,
  parseExecutionPlanFromArgs,
  parseScheduleJobExecutionPlan,
  addScheduleJob,
  parseScheduleAddFromToolArgs,
  parseScheduleAddFromRpcMessage,
  bootstrapAssistantHome,
  isAssistantHomeActive,
  resolveAssistantHomeConfig,
} from './assistant/index.js';
export * from './schedule-domain/index.js';
export type {
  AssistantConfig,
  AssistantDefaultsConfig,
  AssistantEventsConfig,
  AssistantProfileConfig,
  AssistantProfile,
  NotificationRouter,
  BootstrapAssistantHomeResult,
  HomeToolRegistration,
  ScheduleJob,
  ScheduleJobFile,
  ScheduleJobCreator,
  ScheduleJobExecutionPlan,
  ScheduleInvocationContext,
  AssistantEventRequest,
  AssistantEventResult,
} from './assistant/index.js';
export {
  loadAssistantProfileFile,
  loadBootstrapWithProfile,
  syncProfileHeartbeatToStore,
  pruneStaleProfileCronJobs,
  mergeProfileDeviceAliases,
  validateAssistantProfile,
  resolveAssistantProfileConfig,
  ASSISTANT_PROFILE_VERSION,
  DEFAULT_PROFILE_FILENAME,
  PROFILE_HEARTBEAT_JOB_ID,
  PROFILE_MORNING_BRIEF_JOB_ID,
  PROFILE_BEDTIME_CHECK_JOB_ID,
} from './assistant/index.js';

export type {
  ApprovalDecision,
  ApprovalDecisionMemory,
  ApprovalDecisionPort,
  ApprovalOutcome,
  ApprovalOutcomePort,
  ApprovalPort,
  ApprovalRequestInput,
} from './session/approval-port.js';
export {
  approvalOutcomeToDecision,
  formatApprovalDenial,
  requestApprovalOutcome,
} from './session/approval-port.js';
export {
  ApprovalReviewAgent,
  createAutoApprovalPort,
  createBypassApprovalPort,
} from './session/approval-review-agent.js';
export type {
  ApprovalReviewAgentOptions,
  ApprovalReviewDecision,
} from './session/approval-review-agent.js';
export { beginIngressTurnSession } from './session/turn-ingress-session.js';

export type {
  AgentRole,
  AgentRoleConfig,
} from './resource-hub/role-configs.js';
export { AGENT_ROLE_CONFIGS } from './resource-hub/role-configs.js';

export {
  loadBootstrapFiles, buildContextFiles, buildBootstrapContextSection,
  buildStableContextFiles, buildStableBootstrapSection,
  loadSoulPersona, loadToolsGuide, loadAgentsMemory,
  STABLE_BOOTSTRAP_FILENAMES,
} from './bootstrap.js';
export { getFileMemoryContext, getMemoryDir } from './memory-layers.js';
export type { BootstrapFile, ContextFile } from './bootstrap.js';

export {
  NO_MEDIA_AUTHORITY,
  preprocessInboundMedia,
  publishOutboundElements,
  resolveMultimodalConfig,
  resolveOutboundCapabilities,
} from './media/index.js';
export type { AudioTranscriptionPort, MediaBinaryPayload, MultimodalConfig, OutboundMediaAuthority, OutboundMediaCapabilities } from './media/index.js';
export type { ImageAssetPublisher, PublishedImage, R2ImageStorageConfig } from './media/image-assets.js';
export { createLlmMediaPerceptionPort, resolvePerceptionConfig } from './media/index.js';
export type { MediaPerception, MediaPerceptionPort, PerceptionMediaKind, ResolvedPerceptionConfig } from './media/index.js';

export { filterImDeliveryContent } from './segment/filter-im-delivery.js';

export {
  loadMemoryLayers,
  buildMemoryPrompt,
  safeSessionKey,
  getMemoryRoot,
  checkMemoryWritePath,
  classifyMemoryWritePath,
  formatMemoryPathsHint,
  resolveMemoryPromptOptions,
  DEFAULT_MEMORY_BUDGETS,
} from './memory-layers.js';
export type {
  MemoryLayerBudgets,
  MemoryPromptOptions,
  MemoryLayersInput,
  LoadedMemoryLayers,
  MemoryWriteScope,
  MemoryWriteDecision,
} from './memory-layers.js';

export { aiHookRuntimeBus, AIHookRuntimeBus } from './ai-hook-runtime-bus.js';

export {
  createAIHookBusPayload,
  isAISessionNewPayload,
  isAISessionCompactPayload,
} from './ai-event-bus.js';
export type {
  AISessionNewPayload,
  AISessionCompactPayload,
} from './ai-event-bus.js';
export {
  AI_EVENT_NAMES,
  subscribeAIEventsOnTarget,
} from './ai-event-subscriber.js';
export { originFromMessage } from './spawn/spawn-task-tool.js';
export type {
  AIEventFilter,
  AIEventHandlers,
  AIEventTarget,
} from './ai-event-subscriber.js';
export type {
  AIEventName,
  AIEventSource,
  AIEventMode,
  AIEventPath,
  AIEventPayload,
} from './ai-event-contract.js';
export { AgentEventBus } from './event/ai-event-bus.js';

// ── Activity Feedback（替代 endpoint typingIndicator）──
export {
  ActivityFeedbackManager,
  resolveActivityFeedbackPhaseConfig,
  isActivityFeedbackEnabled,
  toActivityFeedbackEventContext,
  resolveActivitySceneType,
  resolveActivityEventTargets,
  enableActivityFeedbackForBot,
  isGenericActivityFeedbackManager,
  resolveSubagentActivityTag,
  formatSubagentActivityPrefix,
  withSubagentActivityPrefix,
  applySubagentActivityPrefixToConfig,
  resolveActivityFeedbackSessionId,
} from './activity-feedback/index.js';
export type {
  ActivityFeedbackType,
  ActivityFeedbackPhase,
  ActivitySceneType,
  ActivityFeedbackPhaseConfig,
  ActivityFeedbackScenePhases,
  ActivityFeedbackConfig,
  ResolvedActivityFeedbackPhaseConfig,
  EndpointWithActivityFeedback,
  ActivityFeedbackSendPort,
  PlatformActivityFeedbackManager,
  PlatformActivityFeedbackStartOptions,
  BotActivityFeedbackManager,
  ActivityFeedbackEventContext,
  ActivityFeedbackGatePhase,
} from './activity-feedback/index.js';

export type {
  ProactiveSendContext,
  ProactiveSendSource,
  ProactiveOutboundService,
} from './outbound/send-proactive.js';
export { deliverScheduleToAdapter } from './assistant/deliver-schedule-to-adapter.js';
export type { DeliverScheduleToAdapterInput } from './assistant/deliver-schedule-to-adapter.js';
export { createTaskExecutor } from './task-executor.js';
export type {
  TaskExecutor,
  TaskExecutionOptions,
  TaskExecutionResult,
  TaskExecutorDeps,
  ScheduleActivityEvent,
  ScheduleActivityPort,
} from './task-executor.js';
export type {
  ScheduleTurnExecutionRequest,
  ScheduleTurnPort,
} from './schedule-domain/execution-domain.js';
export { demoteScheduleCreator } from './schedule-domain/security-harness.js';
export {
  SKILL_DISCLOSURE_TOOLS,
  SKILL_DISCLOSURE_STEPS,
  SKILL_DISCLOSURE_PROMPT_HINT,
} from './skill/progressive-disclosure.js';
// ── Typing Indicator ──
export {
  TypingIndicatorManager,
  ReactionTypingIndicator,
  MessageTypingIndicator,
  NoneTypingIndicator,
  ReactionTypingIndicatorAdapter,
  NativeTypingIndicatorAdapter,
  NativeTypingIndicator,
  GenericTypingIndicatorAdapter,
} from './typing-indicator/index.js';
export type {
  TypingIndicatorType,
  TypingIndicatorConfig,
  TypingIndicatorOptions,
  TypingIndicator,
  TypingIndicatorAdapter,
} from './typing-indicator/index.js';

// ── Activity Feedback 平台能力 ──
export {
  PLATFORM_FEATURES,
  buildTypingSendContent,
} from './typing-indicator/adapter-integration.js';
export type {
  PlatformFeatures,
} from './typing-indicator/adapter-integration.js';

// ── MCP Client ──
export { McpClientManager, McpClientConnection, mcpToolToAgentTool } from './mcp-client/index.js';
export type { McpClientConnectionState, McpToolDefinition } from './mcp-client/index.js';

// ── Common adapter tools (migrated from core) ──
export {
  createSceneManagementTools, buildSceneMethodArgs,
  SCENE_MANAGEMENT_METHOD_SPECS, SCENE_MANAGEMENT_SKILL_TAGS, SCENE_MANAGEMENT_SKILL_KEYWORDS,
} from './common-adapter-tools.js';
export type { ISceneManagement, SceneManagementMethodSpec } from './common-adapter-tools.js';

// ── Agent capability resource hub ──
export { AgentResourceHub } from './resource-hub/index.js';
export {
  ResourceRegistry,
  canAccessTool,
  normalizeTool,
  SkillRegistry,
  SubAgentRegistry,
  McpRegistry,
  HookRegistry,
  createAIHookEvent,
} from './resource-hub/index.js';
export type {
  McpConnection,
  ResourceScope, ResourceEntry,
  Tool, Message, SenderRole, ToolScope, FileRole,
  ToolParametersSchema, PropertySchema, ToolJsonSchema,
  Skill, SkillMetadata,
  SubAgentDef, AgentPreset,
  McpServerEntry, McpResource, McpPrompt,
  AIHook, AIHookEvent as OrchestratorHookEvent, AIHookEventType as OrchestratorHookEventType, AIHookHandler as OrchestratorHookHandler,
  ToolHookDecision, PostToolHookDecision,
  PreToolUseEvent, PostToolUseEvent,
  PreToolUseHandler, PostToolUseHandler,
  PreToolUseHook, PostToolUseHook, ToolHook,
} from './resource-hub/index.js';

export {
  FIVE_AGENT_ROLES,
  isFiveAgentRole,
  asFiveAgentRole,
  filterToolNamesForRole,
  filterToolsForRole,
  isToolAllowedForRole,
} from './orchestration/five-agent/index.js';
export type { FiveAgentRole } from './orchestration/five-agent/index.js';

export {
  defineSkill,
  defineHook,
  defineEval,
  disableTool,
  normalizeToolDenylist,
  namespaceAuthoringName,
  slotNameFromFile,
  slotNameFromDir,
} from './authoring/index.js';
export type {
  AuthoringSkillDefinition,
  AuthoringHookDefinition,
  AuthoringEvalDefinition,
  AuthoringEvalContext,
  DiscoveredPluginAgentSurface,
} from './authoring/index.js';
export {
  discoverPluginAgentSurface,
} from './discovery/agent-surface.js';
export {
  discoverWorkspaceAgents,
  type AgentMeta,
} from './discovery/agents.js';
export {
  buildAgentSurfaceInfoReport,
  formatAgentSurfaceInfoReport,
} from './discovery/agent-surface-info.js';
export type {
  AgentSurfaceInfoReport,
  AgentSurfacePluginInfo,
  AgentSurfaceWorkspaceAgentInfo,
} from './discovery/agent-surface-info.js';

// Detached background tasks (#731) and interjection / commands (#732)
export * from './detached-task/index.js';

// Plain text completion for plugins (#804): tool-free, with retry and fallback.
export { aiCompletionToken, AiCompletionQuotaError } from './plugin-runtime/ai-completion.js';
export type {
  AiCompletion,
  AiCompletionInput,
  AiCompletionResult,
  AiCompletionUntrustedInput,
  AiCompletionUsageShare,
  UsageSubject,
} from './plugin-runtime/ai-completion.js';

export type { AgentOutputElement } from './outbound/agent-output.js';
export { renderAgentOutput, splitOutputMessages } from './outbound/agent-output.js';
export { REACTION_SEGMENT_TYPE } from './outbound/structured-reply.js';
export { chatFailureLine, chatFailureKindOf } from './outbound/chat-failure.js';
export type { ChatFailureKind, ChatFailureOptions } from './outbound/chat-failure.js';
