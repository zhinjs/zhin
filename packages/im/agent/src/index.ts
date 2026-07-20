/**
 * @zhin.js/agent — AI Agent orchestration hub
 *
 * Provides AgentOrchestrator as the central registry for
 * tools, skills, subagents, mcps, and hooks.
 */

// ── Agent-specific modules ──

export { AIService } from './service.js';
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
export {
  pluginToolToAgentTool,
  agentToolToLlmTool,
  agentToolsToLlmTools,
} from './tool-bridge.js';
export type { NormalizableTool } from './tool-bridge.js';
export type { ZhinAgentConfig, OnChunkCallback } from './config/index.js';
export type {
  IAgentTurnProcessor,
  IAgentSessionManager,
  IAgentDiagnostics,
  IAgentConfigurator,
} from './config/agent-interfaces.js';
export type {
  TurnEvent, TurnUsage,
  TurnStartEvent, ChunkEvent,
  ToolCallEvent as TurnToolCallEvent,
  ToolResultEvent,
  ThinkingEvent, TurnEndEvent, TurnErrorEvent,
  SubagentStartEvent, SubagentProgressEvent, SubagentEndEvent,
  McpConnectEvent, McpToolCallEvent,
} from './event/turn-event.js';

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
  ZHIN_NEEDS_OWNER_FIRST_LINE,
  OWNER_HARD_ORCHESTRATION_TOOLS,
  parseNeedsOwnerSignal,
  shouldHardOrchestrateOwnerConfirm,
  createOwnerOrchestratedToolResultTransform,
} from './orchestrator/owner-confirm-orchestration.js';
export type { OwnerOrchestrationOptions } from './orchestrator/owner-confirm-orchestration.js';
export {
  OWNER_APPROVE_ALWAYS_TOOL,
  handleRuntimeOwnerApproveCommand,
  getEndpointMaster,
  hasOwnerApproveAlways,
  addOwnerApproveAlways,
  formatBashApproveList,
} from './security/owner-approve-always-store.js';
export {
  buildRichSystemPrompt,
  buildLiteSystemPromptWithPlatform,
  buildContextHint,
  buildEnhancedPersona,
  buildUserMessageWithHistory,
  contentToText,
  describePromptSectionsForDebug,
} from './prompt/system-prompt.js';
export type { RichSystemPromptContext, PromptSectionDebugInfo } from './prompt/system-prompt.js';
export {
  buildAgentsEnvelopeContext,
  collectAgentsInstructionChain,
  clearAgentsInstructionCache,
} from './context/agents-instruction.js';
export type { AgentsInstructionEntry } from './context/agents-instruction.js';
export {
  resolveWorkspacePrompt,
  clearWorkspacePromptCache,
} from './prompt/workspace-prompt.js';
export type { WorkspacePromptRole } from './prompt/workspace-prompt.js';
export {
  registerAgentPromptContributor,
  unregisterAgentPromptContributor,
  getAgentPromptContributor,
  clearAgentPromptContributors,
  resolveAgentPromptSections,
  resolveAgentPromptMarkdown,
  resolveDeferredToolsForPlatform,
  formatAgentPromptSectionsMarkdown,
} from './agent-prompt/index.js';
export type { ResolveAgentPromptOptions } from './agent-prompt/index.js';
export { createImTranscriptHistoryTool, createUserProfileTool } from './tool/context-tools.js';
export type { ImTranscriptWriteInput, ImTranscriptStore } from '@zhin.js/ai';
export { createSpawnTaskTool } from './builtin/spawn-task-tool.js';

export { UserProfileStore, AI_USER_PROFILE_MODEL } from './user-profile.js';

export { SubagentSystem } from './subagent/index.js';
export { SubagentRuntime } from './subagent/subagent-runtime.js';
export type {
  SubagentOrigin, SubagentResultDelivery, SubagentResultSender, SpawnOptions, SubagentRuntimeOptions,
  SubagentCompletePayload,
} from './subagent/index.js';
export { RESERVED_TOOL_NAMES, RESERVED_TOOL_NAME_PREFIXES } from './reserved-tools.js';

export { BuiltinBaseTool } from './builtin/builtin-base-tool.js';
export {
  ReadFileBuiltinTool,
  createReadFileTool,
  READ_FILE_PARAMETERS,
} from './builtin/read-file-tool.js';
export {
  WriteFileBuiltinTool,
  createWriteFileTool,
  WRITE_FILE_PARAMETERS,
} from './builtin/write-file-tool.js';
export {
  EditFileBuiltinTool,
  createEditFileTool,
  EDIT_FILE_PARAMETERS,
} from './builtin/edit-file-tool.js';
export {
  ListDirBuiltinTool,
  createListDirTool,
  LIST_DIR_PARAMETERS,
} from './builtin/list-dir-tool.js';
export {
  GlobBuiltinTool,
  createGlobTool,
  GLOB_PARAMETERS,
  type GlobExecAsync,
} from './builtin/glob-tool.js';
export {
  GrepBuiltinTool,
  createGrepTool,
  GREP_PARAMETERS,
  type GrepExecAsync,
} from './builtin/grep-tool.js';
export {
  BashBuiltinTool,
  createBashTool,
  BASH_PARAMETERS,
  type BashExecAsync,
} from './builtin/bash-tool.js';
export {
  WebSearchBuiltinTool,
  createWebSearchTool,
  WEB_SEARCH_PARAMETERS,
  MAX_WEB_SEARCH_COUNT,
} from './builtin/web-search-tool.js';
export {
  WEB_SEARCH_LOCALE_EXTRA_KEY,
  DEFAULT_WEB_SEARCH_MARKET,
  normalizeWebSearchLocaleHint,
  acceptLanguageForMarket,
  resolveWebSearchMarketFromContext,
} from './builtin/web-search-locale.js';
export { bingSearchFetchHeaders, buildBingSearchUrl } from './builtin/bing-search-html.js';
export {
  WebFetchBuiltinTool,
  createWebFetchTool,
  WEB_FETCH_PARAMETERS,
  WEB_FETCH_DEFAULT_MAX_LENGTH,
  stripFetchedHtmlToText,
} from './builtin/web-fetch-tool.js';
export {
  TodoReadBuiltinTool,
  createTodoReadTool,
  TODO_READ_PARAMETERS,
} from './builtin/todo-read-tool.js';
export {
  TodoWriteBuiltinTool,
  createTodoWriteTool,
  TODO_WRITE_PARAMETERS,
} from './builtin/todo-write-tool.js';
export {
  readSkillInstructions,
  LoadSkillBuiltinTool,
  createLoadSkillTool,
  LOAD_SKILL_PARAMETERS,
  type LoadSkillToolOptions,
} from './builtin/load-skill-tool.js';
export {
  DiscoverBuiltinTool,
  LoadToolBuiltinTool,
  LoadSkillBuiltinToolMeta,
  createDeferredMetaTools,
  bindDeferredToolRuntime,
  getDeferredToolRuntime,
  isToolsMutatedResult,
  TOOLS_MUTATED_MARKER,
  type DeferredToolRuntime,
} from './builtin/deferred-tool-meta.js';
export {
  InstallSkillBuiltinTool,
  createInstallSkillTool,
  INSTALL_SKILL_PARAMETERS,
  type InstallSkillToolOptions,
} from './builtin/install-skill-tool.js';
export {
  AskUserBuiltinTool,
  createAskUserTool,
  ASK_USER_PARAMETERS,
  askViaPrompt,
  formatOwnerResponse,
} from './builtin/ask-user-tool.js';
export { createBuiltinTools, type BuiltinToolsOptions } from './builtin-tools.js';
export { ZHIN_WEB_USER_AGENT, WEB_TOOL_FETCH_TIMEOUT_MS } from './builtin/web-tool-utils.js';

export {
  createScheduleTools,
  setScheduleManager,
  getScheduleManager,
  generateScheduleJobId,
  SCHEDULE_JOBS_FILENAME,
} from './schedule-manager.js';
export type { ScheduleManager } from './schedule-manager.js';

export {
  ScheduleJobEngine,
  ScheduleJobStore,
  AssistantJobEngine,
  AssistantJobStore,
  AssistantEventIngress,
  JobWorker,
  createScheduleJobStoreFromConfig,
  createAssistantJobStore,
  getScheduleJobsPath,
  getAssistantJobsPath,
  resolveAssistantConfig,
  resolveAssistantDefaultsConfig,
  resolveAssistantEventsConfig,
  isAssistantEventsActive,
  createNotificationRouter,
  imNotifyToSendOptions,
  parseJobNotify,
  setAssistantRuntime,
  getAssistantRuntime,
  isAssistantEventsEndpointActive,
  getAssistantEventsTokenFallback,
  SCHEDULE_JOBS_VERSION,
  ASSISTANT_JOBS_FILENAME,
  syncProfileRoutinesToStore,
  captureScheduleJobCreator,
  parseScheduleJobCreator,
  parseExecutionPlanFromArgs,
  parseScheduleJobExecutionPlan,
  addScheduleJob,
  parseScheduleAddFromToolArgs,
  parseScheduleAddFromRpcMessage,
  buildScheduleTurnPrompt,
} from './assistant/index.js';
export type {
  AssistantConfig,
  AssistantDefaultsConfig,
  AssistantEventsConfig,
  AssistantProfileConfig,
  AssistantProfile,
  NotificationRouter,
  ScheduleJob,
  ScheduleJobFile,
  ScheduleJobCreator,
  ScheduleJobExecutionPlan,
  AssistantJob,
  AssistantJobFile,
  AssistantEventRequest,
  AssistantEventResult,
  AssistantRuntimeHandle,
} from './assistant/index.js';
export {
  loadAssistantProfileFile,
  loadBootstrapWithProfile,
  syncProfileHeartbeatToStore,
  syncProfileCronRoutinesToStore,
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

export {
  setSessionTreeRuntime,
  getSessionTreeRuntime,
  createSessionTreeRuntimeFromAgent,
} from './session-tree-runtime-registry.js';
export type { SessionTreeRuntimeHandle } from './session-tree-runtime-registry.js';

export {
  createAgentSessionHostPort,
} from './session/agent-session-host-port.js';
export type { AgentSessionHostPort, CreateAgentSessionHostPortOptions } from './session/agent-session-host-port.js';
export { HttpAgentSessionStore } from './session/http-agent-session-store.js';
export type {
  HttpAgentSessionRecord,
  HttpAgentSessionStatus,
} from './session/http-agent-session-store.js';
export { FileHttpSessionPersistence } from './session/http-session-persistence.js';
export type {
  HttpSessionPersistence,
  PersistedHttpSessionSnapshot,
} from './session/http-session-persistence.js';
export { HttpStepProjector } from './session/http-step-projector.js';
export { HttpApprovalWaiter } from './session/http-approval-waiter.js';

export {
  setOrchestrationRuntime,
  getOrchestrationRuntime,
  createOrchestrationRuntimeFromService,
} from './orchestration-runtime-registry.js';
export type { OrchestrationRuntimeHandle } from './orchestration-runtime-registry.js';

export {
  getOrchestrationService,
  getOrchestrationKernel,
  initOrchestrationService,
  upgradeOrchestrationRepository,
  OrchestrationKernel,
  OrchestrationService,
} from './orchestrator/orchestration-service.js';
export {
  MemoryOrchestrationRepository,
  DatabaseOrchestrationRepository,
} from './orchestrator/orchestration-repository.js';
export { registerDefaultExecutors } from './orchestrator/bootstrap-executors.js';
export type { RegisterExecutorsDeps } from './orchestrator/bootstrap-executors.js';
export type {
  OrchestrationStartInput,
  OrchestrationAddTaskInput,
  DispatchTaskInput,
  HandleUserMessageInput,
} from './orchestrator/orchestration-service.js';
export type {
  RunStatus,
  TaskStatus,
  ExecutorKind,
  OrchestrationRun,
  OrchestrationTask,
  RunEvent,
  RunSnapshot,
  AgentExecutionEvent,
  AgentExecutorInput,
  AgentExecutor,
  WorkflowStrategyInput,
  WorkflowTaskSpec,
  WorkflowStrategy,
} from './orchestrator/orchestration-types.js';

export {
  getAgentDispatcher,
  initAgentDispatcher,
} from './orchestrator/agent-dispatcher.js';
export type {
  AgentRole,
  AgentTask,
  AgentResult as DispatcherAgentResult,
} from './orchestrator/agent-dispatcher.js';

export {
  getRemoteAgentRegistry,
  initRemoteAgentRegistry,
} from './orchestrator/remote-agent-registry.js';

export {
  getRemoteTaskPoller,
  startRemoteTaskPoller,
} from './orchestrator/remote-task-poller.js';

export {
  introspectionRestBindings,
  introspectionRestEndpoints,
  introspectionRestCommands,
  introspectionRestMcp,
  introspectionRestTools,
} from './init/introspection-rest.js';
export type { IntrospectionJsonResponse } from './init/introspection-rest.js';
export { collectIntrospectionBindings, collectIntrospectionAgentTools, collectIntrospectionSkills, collectIntrospectionMcpLabels, collectIntrospectionMcpWithConfigFallback } from './init/introspection-collectors.js';
export { ensureMcpConnections, ensureMcpConnectionsForBinding, getMcpToolsForBinding } from './orchestrator/mcp-lifecycle.js';
export { waitForAgentBootstrap } from './init/bootstrap-gate.js';
export { composeZhinAgentRuntime } from './init/compose-zhin-agent-runtime.js';
export type { ComposedZhinAgentRuntime } from './init/compose-zhin-agent-runtime.js';
export { activateAiDatabaseStorage } from './init/activate-ai-database-storage.js';
export { defineAiDatabaseModels } from './init/define-ai-database-models.js';
export type { AiDatabaseModelDefiner } from './init/define-ai-database-models.js';

export {
  loadBootstrapFiles, buildContextFiles, buildBootstrapContextSection,
  buildStableContextFiles, buildStableBootstrapSection,
  loadSoulPersona, loadToolsGuide, loadAgentsMemory, clearBootstrapCache,
  getFileMemoryContext, STABLE_BOOTSTRAP_FILENAMES,
} from './bootstrap.js';
export type { BootstrapFile, ContextFile } from './bootstrap.js';

export {
  preprocessInboundMedia,
  publishOutboundElements,
  resolveMultimodalConfig,
  resolveOutboundCapabilities,
  INBOUND_MEDIA_PARTS_EXTRA_KEY,
} from './media/index.js';
export type { MediaBinaryPayload, MultimodalConfig, OutboundMediaCapabilities } from './media/index.js';

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
  migrateLegacyMemoryFiles,
} from './memory-layers.js';
export type {
  MemoryLayerBudgets,
  MemoryPromptOptions,
  MemoryLayersInput,
  LoadedMemoryLayers,
  MemoryWriteScope,
  MemoryWriteDecision,
} from './memory-layers.js';

export {
  registerAIHook, unregisterAIHook, triggerAIHook,
  createAIHookEvent as createLegacyAIHookEvent, clearAIHooks, getRegisteredAIHookKeys,
} from './hooks.js';
export type {
  AIHookEvent as LegacyAIHookEvent, AIHookEventType as LegacyAIHookEventType, AIHookHandler as LegacyAIHookHandler,
  MessageReceivedEvent, MessageSentEvent, SessionCompactEvent,
  SessionNewEvent, AgentBootstrapEvent, ToolCallEvent,
} from './hooks.js';

export { aiHookRuntimeBus, AIHookRuntimeBus } from './ai-hook-runtime-bus.js';

export {
  createAIHookBusPayload,
  isAISessionNewPayload,
  isAISessionCompactPayload,
  onAIHook,
  onAISessionNew,
  onAISessionCompact,
} from './ai-event-bus.js';
export type {
  AIEventPayload,
  AISessionNewPayload,
  AISessionCompactPayload,
} from './ai-event-bus.js';
export {
  AI_EVENT_NAMES,
  subscribeAIEvents,
  subscribeAIEventsOnTarget,
} from './ai-event-subscriber.js';
export { originFromMessage } from './builtin/spawn-task-tool.js';
export type {
  AIEventName,
  AIEventFilter,
  AIEventHandlers,
  AIEventTarget,
} from './ai-event-subscriber.js';

export { initAgentModule } from './init.js';
export { registerEndpointIdColumnMigrationHook } from './init/upgrade-endpoint-id-schema.js';

// ── Activity Feedback（替代 endpoint typingIndicator）──
export {
  ActivityFeedbackManager,
  getActivityFeedbackManager,
  initActivityFeedbackManager,
  resolveActivityFeedbackPhaseConfig,
  isActivityFeedbackEnabled,
  toActivityFeedbackEventContext,
  resolveActivitySceneType,
  resolveActivityEventTargets,
  enableActivityFeedbackForBot,
  getAdapterActivityFeedbackManager,
  initAdapterActivityFeedbackManager,
  isGenericActivityFeedbackManager,
  activityFeedbackAiBus,
  ActivityFeedbackAIBus,
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
  PlatformActivityFeedbackManager,
  PlatformActivityFeedbackStartOptions,
  BotActivityFeedbackManager,
  ActivityFeedbackEventContext,
  ActivityFeedbackGatePhase,
} from './activity-feedback/index.js';

export { createProactiveOutboundService } from './outbound/send-proactive.js';
export type {
  ProactiveSendContext,
  ProactiveSendSource,
  ProactiveOutboundService,
} from './outbound/send-proactive.js';
export { deliverScheduleToAdapter } from './assistant/deliver-schedule-to-adapter.js';
export type { DeliverScheduleToAdapterInput } from './assistant/deliver-schedule-to-adapter.js';
export { createTaskExecutor, drainTaskExecutorLocks } from './task-executor.js';
export type {
  TaskExecutor,
  TaskExecutionOptions,
  TaskExecutionResult,
  TaskExecutorDeps,
} from './task-executor.js';
export {
  requestConnectionAuthorization,
  completeConnectionAuthorization,
  buildAuthorizationRequiredEvent,
  buildAuthorizationCompletedEvent,
} from './connection/authorization-flow.js';
export {
  SKILL_DISCLOSURE_TOOLS,
  SKILL_DISCLOSURE_STEPS,
  SKILL_DISCLOSURE_PROMPT_HINT,
} from './skill/progressive-disclosure.js';
export { resolveOutboundBatches, stripFakeAtTokens } from './collaboration/outbound-resolver.js';
export { AskUserSessionService } from './builtin/ask-user-session-service.js';

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
  getTypingIndicatorManager,
  initTypingIndicatorManager,
  startTypingIndicator,
  stopTypingIndicator,
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
  BotWithEditing,
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

// ── Orchestrator (AI resource hub) ──
export { AgentOrchestrator } from './orchestrator/index.js';
export { AgentOrchestrator as ResourceHub } from './orchestrator/index.js';
export {
  ResourceRegistry,
  ToolRegistry, ZhinTool, isZhinTool, defineTool, extractParamInfo,
  canAccessTool,
  normalizeTool, sharedToolSelection,
  SkillRegistry,
  SubAgentRegistry,
  McpRegistry,
  HookRegistry,
  createAIHookEvent,
} from './orchestrator/index.js';
export type {
  ToolInput, McpConnection,
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
} from './orchestrator/index.js';

// ── Collaboration (GroupCell multi-endpoint) ──
export {
  getAgentRuntimeRegistry,
  resetAgentRuntimeRegistry,
  getCollaborationSceneService,
  initCollaborationSceneService,
  resetCollaborationSceneService,
  wireCollaborationStorage,
  getCollaborationSceneRepository,
  MemoryCollaborationSceneRepository,
  getCollaborationArtifactRepository,
  setCollaborationArtifactRepository,
  createCollaborationArtifactRepository,
  COLLABORATION_SCENE_MODEL,
  COLLABORATION_SCENE_MEMBER_MODEL,
  COLLABORATION_SCENE_ARTIFACT_MODEL,
  createInboundTurnPipeline,
  bootstrapEndpointRuntimes,
  buildTurnPlan,
  evaluatePeerTrigger,
  applyRuntimeCollaborationInbound,
  findCellForInbound,
  resolveCollaborationSceneContextKey,
  resolveCollaborationSceneContextKeyFromMessage,
} from './collaboration/index.js';
export type {
  CollaborationScene,
  CollaborationSceneMemberRuntime,
  CollaborationConfig,
  TurnPlan,
  DelegationMode,
  PeerTriggerMode,
  InboundTurnPipeline,
  InboundTurnPipelineDeps,
  RuntimeCollaborationInboundInput,
  RuntimeCollaborationInboundResult,
} from './collaboration/index.js';
export {
  resolveMemberBySender,
  resolveEndpointIdsForMember,
  isInboundFromPeerBot,
} from './collaboration/endpoint-identity.js';

export {
  FIVE_AGENT_WORKFLOW_STRATEGY_NAME,
  createFiveAgentWorkflowStrategy,
} from './builtin/five-agent/index.js';

export {
  defineAgent,
  defineAgentTool,
  defineSkill,
  defineSchedule,
  defineConnection,
  defineHook,
  defineEval,
  disableTool,
  normalizeToolDenylist,
  defineState,
  defineDynamic,
  namespaceAuthoringName,
  slotNameFromFile,
  slotNameFromDir,
} from './authoring/index.js';
export type {
  AuthoringAgentDefinition,
  AuthoringToolDefinition,
  AuthoringSkillDefinition,
  AuthoringScheduleDefinition,
  AuthoringConnectionDefinition,
  AuthoringHookDefinition,
  AuthoringEvalDefinition,
  AuthoringToolContext,
  AuthoringEvalContext,
  DiscoveredPluginAgentSurface,
  DefineAgentToolInput,
} from './authoring/index.js';
export {
  discoverAllPluginAgentSurfaces,
  discoverPluginAgentSurface,
  collectPluginAgentRoots,
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
export {
  getAgentState,
  updateAgentState,
  clearAgentStateSession,
  registerAuthoringStateFromDefinition,
  listRegisteredAuthoringStates,
} from './state/agent-state-store.js';
export {
  applyDynamicTurnOverrides,
  registerDynamicResolver,
  listDynamicResolvers,
} from './dynamic/dynamic-registry.js';
export type {
  DynamicResolveContext,
  DynamicResolveResult,
} from './dynamic/dynamic-registry.js';
export {
  registerPluginAgentSurfaces,
  runPluginEvals,
  resetAuthoringRegistrationForTests,
} from './discovery/register-agent-surface.js';
export {
  AgentFeature,
  MCPFeature,
} from './features/index.js';
export type { McpFeatureEntry } from './features/index.js';
export {
  FeatureCapabilityIngress,
  createFeatureCapabilityIngress,
} from './ingress/index.js';
export type {
  CapabilityFeatureBundle,
  IngressTurnContext,
  IngressTurnLease,
} from './ingress/index.js';
