/**
 * @zhin.js/agent — AI Agent orchestration hub
 *
 * Provides AgentResourceHub as the central registry for
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
  WorkroomMemberRole,
  WorkroomAssignmentRouteDefinition,
  WorkroomSpaceKind,
  WorkroomAgentMemberDefinition,
  WorkroomConversationBindingDefinition,
  WorkroomDefinition,
  WorkroomAgentMemberConfig,
  WorkroomConversationBindingConfig,
  WorkroomDefinitionConfig,
} from './workroom/catalog-definition.js';
export {
  resolveWorkroomBotIdentity,
  type WorkroomBotIdentityInput,
  type ResolvedWorkroomBotIdentity,
} from './routing/workroom-bot-identity.js';
export { validateWorkroomDefinitions } from './config/validate-ai-config.js';
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
  handleRuntimeOwnerApproveCommand,
  getEndpointMaster,
  hasOwnerApproveAlways,
  addOwnerApproveAlways,
  formatBashApproveList,
} from './security/owner-approve-always-store.js';
export {
  handleRuntimeManagementCommand,
} from './init/runtime-management-commands.js';
export type {
  RuntimeManagementDeps,
  RuntimeManagementSenderRoles,
} from './init/runtime-management-commands.js';
export {
  buildRichSystemPrompt,
  buildLiteSystemPromptWithPlatform,
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
} from './prompt/define-agent-prompt-section.js';
export type { AgentPromptSectionConfig } from './prompt/define-agent-prompt-section.js';
export {
  PromptSectionLoader,
} from './prompt/prompt-section-loader.js';
export type { PromptSectionLoaderOptions } from './prompt/prompt-section-loader.js';
export {
  discoverAndRegisterPromptSections,
  bootstrapPromptSections,
} from './prompt/discover-prompt-sections.js';
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
export { createUserProfileTool } from './tool/context-tools.js';
export { createSpawnTaskTool } from './builtin/spawn-task-tool.js';
export * from './interaction/index.js';

export { UserProfileStore, AI_USER_PROFILE_MODEL } from './user-profile.js';

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
  SkillInvocationRequest,
  SkillInvocationResult,
  SeamIntegrationToken,
} from './seam/index.js';
export { SeamProviderRegistry, SeamIntegration } from './seam/index.js';
export { seamIntegrationToken } from './seam/index.js';
export { BuiltinToolService } from './builtins/builtin-tool-service.js';
export { SkillRegistryAsService } from './skill/skill-registry-as-service.js';

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
  InstallSkillBuiltinTool,
  createInstallSkillTool,
  INSTALL_SKILL_PARAMETERS,
  type InstallSkillToolOptions,
} from './builtin/install-skill-tool.js';
export { createBuiltinTools, type BuiltinToolsOptions } from './builtin-tools.js';
export {
  createToolRuntime,
  registerPolicyExtractor,
  type ToolRuntime,
  type ToolRuntimeTurnContext,
  type ToolRuntimeJournalPort,
  type ToolCallContext,
  type ToolExecutionOutcome,
  type ToolPolicyInputExtractor,
} from './tool/tool-runtime.js';
export { registerBuiltinPolicyExtractors } from './tool/builtin-policy-extractors.js';
export { stampToolGeneration } from './tool/tool-system.js';
export { FileJournalStore } from './journal/index.js';
export { PersistentTurnJournal } from './journal/index.js';
export { ZHIN_WEB_USER_AGENT, WEB_TOOL_FETCH_TIMEOUT_MS } from './builtin/web-tool-utils.js';

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

/** Runtime Host（basic/cli）装配 session tree runtime 时的窄门面。 */
export { asPrivate } from './internal/as-private.js';

export type { ApprovalPort, ApprovalRequestInput } from './session/approval-port.js';
export { beginIngressTurnSession } from './session/turn-ingress-session.js';

export type {
  AgentRole,
  AgentRoleConfig,
} from './resource-hub/role-configs.js';
export { AGENT_ROLE_CONFIGS } from './resource-hub/role-configs.js';

export * from './workroom/kernel-contracts.js';
export * from './workroom/acceptance-policy.js';
export * from './workroom/acceptance-control.js';
export * from './workroom/accepted-source-projector.js';
export * from './workroom/accepted-source-memory-application.js';
export * from './workroom/file-accepted-source-memory-repository.js';
export * from './workroom/project-knowledge-registry.js';
export * from './workroom/database-project-knowledge-journal.js';
export * from './workroom/workroom-assignment-knowledge-context.js';
export * from './workroom/assignment-executor.js';
export * from './workroom/assignment-observation-ingress.js';
export * from './workroom/interaction-space-router.js';
export * from './workroom/file-interaction-space-binding-repository.js';
export * from './workroom/interaction-space-binding-service.js';
export * from './workroom/human-ingress.js';
export * from './workroom/human-ingress-application.js';
export * from './workroom/file-human-ingress-application.js';
export * from './workroom/human-ingress-source-reader.js';
export * from './workroom/human-ingress-orchestrator.js';
export * from './workroom/dynamic-workflow-planner.js';
export * from './workroom/plan-approval-control.js';
export * from './workroom/plan-revision.js';
export * from './workroom/scheduler-priority-control.js';
export * from './workroom/file-human-ingress.js';
export * from './workroom/local-assignment-executor.js';
export * from './workroom/local-assignment-issuance.js';
export * from './workroom/workroom-task-report-store.js';
export * from './workroom/projection-outbox.js';
export * from './plugin-runtime/workroom-projection-outbound.js';
export * from './plugin-runtime/workroom-projection-runtime.js';
export * from './plugin-runtime/workroom-journal-payload-composition.js';
export * from './plugin-runtime/workroom-data-governance-root-provider.js';
export * from './workroom/journal.js';
export * from './workroom/journal-model.js';
export * from './workroom/catalog.js';
export * from './workroom/workroom-kernel.js';
export * from './workroom/runtime.js';
export * from './workroom/remote-callback-inbox.js';
export * from './workroom/remote-callback-reconciliation-worker.js';
export * from './workroom/remote-callback-application.js';
export * from './workroom/remote-callback-gateway.js';
export * from './workroom/remote-dispatch.js';
export * from './workroom/remote-dispatch-outbox.js';
export * from './workroom/remote-dispatch-worker.js';
export * from './workroom/remote-dispatch-admission.js';
export * from './workroom/remote-dispatch-scheduler.js';
export * from './workroom/remote-assignment-issuance.js';
export * from './workroom/remote-assignment-dispatch-command.js';
export * from './workroom/profile-compiler.js';
export * from './workroom/profile-registry.js';
export * from './workroom/file-profile-journal.js';
export * from './plugin-runtime/workroom-overlay-pack-promotion.js';
export * from './plugin-runtime/database-overlay-pack-promotion-repository.js';
export * from './plugin-runtime/workroom-assignment-knowledge-composition.js';
export * from './workroom/workflow-plan-builder.js';
export * from './workroom/workroom-scheduler.js';
export * from './workroom/workroom-preemption.js';
export * from './workroom/workroom-scheduler-application.js';
export * from './workroom/effect-ledger.js';
export * from './workroom/file-effect-ledger.js';
export * from './workroom/git-workspace-gateway.js';
export * from './workroom/effect-blocker-repository.js';
export * from './workroom/role-capability-snapshot.js';
export * from './workroom/legacy-run-offline-migration.js';
export * from './workroom/legacy-embedded-payload-migration.js';
export * from './portfolio/portfolio-journal.js';
export * from './portfolio/file-portfolio-journal.js';
export * from './portfolio/portfolio-admission.js';
export * from './portfolio/capacity-control-outbox.js';
export * from './portfolio/file-capacity-control-outbox.js';
export * from './portfolio/database-capacity-control-outbox.js';
export * from './portfolio/sponsor-projection.js';
export * from './plugin-runtime/workroom-portfolio-checkpoint-ack.js';
export * from './portfolio/resource-bundle.js';
export * from './data-governance/data-governance.js';
export * from './data-governance/disclosure-manifest.js';
export * from './data-governance/database-payload-lifecycle-repository.js';
export * from './data-governance/encrypted-database-payload-vault.js';
export * from './data-governance/payload-vault-storage-handoff.js';
export * from './data-governance/payload-hold-overdue-projection.js';

export {
  introspectionRestBindings,
  introspectionRestEndpoints,
  introspectionRestCommands,
  introspectionRestMcp,
  introspectionRestTools,
} from './init/introspection-rest.js';
export type { IntrospectionJsonResponse } from './init/introspection-rest.js';
export { collectIntrospectionBindings, collectIntrospectionAgentTools, collectIntrospectionSkills, collectIntrospectionMcpLabels, collectIntrospectionMcpWithConfigFallback } from './init/introspection-collectors.js';
export { ensureMcpConnections, ensureMcpConnectionsForBinding, getMcpToolsForBinding } from './resource-hub/mcp-lifecycle.js';
export { composeZhinAgentRuntime } from './init/compose-zhin-agent-runtime.js';
export type { ComposedZhinAgentRuntime } from './init/compose-zhin-agent-runtime.js';
export { activateAiDatabaseStorage } from './init/activate-ai-database-storage.js';
export { defineAiDatabaseModels } from './init/define-ai-database-models.js';
export type { AiDatabaseModelDefiner } from './init/define-ai-database-models.js';
export * from './workroom/assignment-authority-grant-application.js';
export * from './workroom/assignment-authority-grant-repository.js';

export {
  loadBootstrapFiles, buildContextFiles, buildBootstrapContextSection,
  buildStableContextFiles, buildStableBootstrapSection,
  loadSoulPersona, loadToolsGuide, loadAgentsMemory, clearBootstrapCache,
  STABLE_BOOTSTRAP_FILENAMES,
} from './bootstrap.js';
export { getFileMemoryContext, getMemoryDir } from './memory-layers.js';
export type { BootstrapFile, ContextFile } from './bootstrap.js';

export {
  preprocessInboundMedia,
  publishOutboundElements,
  resolveMultimodalConfig,
  resolveOutboundCapabilities,
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

export { registerEndpointKeyColumnMigrationHook } from './init/upgrade-endpoint-id-schema.js';

// ── Activity Feedback（替代 endpoint typingIndicator）──
export {
  ActivityFeedbackManager,
  getActivityFeedbackManager,
  initActivityFeedbackManager,
  provideActivityFeedbackManager,
  resolveActivityFeedbackPhaseConfig,
  isActivityFeedbackEnabled,
  toActivityFeedbackEventContext,
  resolveActivitySceneType,
  resolveActivityEventTargets,
  enableActivityFeedbackForBot,
  getAdapterActivityFeedbackManager,
  initAdapterActivityFeedbackManager,
  provideAdapterActivityFeedbackManager,
  isGenericActivityFeedbackManager,
  activityFeedbackAiBus,
  ActivityFeedbackAIBus,
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
export { createTaskExecutor, drainTaskExecutorLocks } from './task-executor.js';
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
  getTypingIndicatorManager,
  provideTypingIndicatorManager,
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

// ── Agent capability resource hub ──
export { AgentResourceHub } from './resource-hub/index.js';
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
} from './resource-hub/index.js';
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
} from './resource-hub/index.js';

export {
  FIVE_AGENT_ROLES,
  isFiveAgentRole,
  asFiveAgentRole,
  filterToolNamesForRole,
  filterToolsForRole,
  isToolAllowedForRole,
} from './builtin/five-agent/index.js';
export type { FiveAgentRole } from './builtin/five-agent/index.js';

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
