import { readFile } from 'node:fs/promises';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { formatCompact, getLogger } from '@zhin.js/logger';
import {
  collectSegmentMedia,
  toCanonicalSegments,
  type AITriggerConfig,
  type Tool,
} from '@zhin.js/core';
import {
  ingressRouteToken,
  messageGatewayToken,
  type ImRuntime,
  type Message,
  type SendContent,
} from '@zhin.js/core/runtime';
import type { UserInteraction } from '@zhin.js/interaction';
import {
  expandEnvironmentValue,
  type ConfigDocumentPort,
  type RootResourceInstaller,
  type RuntimeConfigDocument,
} from '@zhin.js/runtime';
import { databaseRootHostToken, rootPluginId, type DisposeStack, type PluginId, type RuntimeSnapshot, type SnapshotReader } from '@zhin.js/plugin-runtime';
import {
  AIService,
  ZhinAgent,
  composeZhinAgentRuntime,
  AgentResourceHub,
  discoverWorkspaceAgents,
  createBashTool,
  activateAiDatabaseStorage,
  defineAiDatabaseModels,
  createScheduleJobStoreFromConfig,
  createScheduleTools,
  ScheduleJobEngine,
  JobWorker,
  createTaskExecutor,
  createNotificationRouter,
  resolveAssistantConfig,
  resolveAssistantDefaultsConfig,
  parseJobNotify,
  AssistantEventIngress,
  loadAssistantProfileFile,
  validateAssistantProfile,
  syncProfileHeartbeatToStore,
  syncProfileRoutinesToStore,
  pruneStaleProfileCronJobs,
  bootstrapAssistantHome,
  ActivatableWorkroomJournal,
  FileWorkroomJournal,
  ActivatableWorkroomCatalog,
  FileWorkroomCatalog,
  WorkroomKernel,
  createCatalogWorkroomRunControlAuthority,
  asPrivate,
  handleRuntimeOwnerApproveCommand,
  handleRuntimeManagementCommand,
  publishOutboundElements,
  type ProactiveOutboundService,
  type AssistantConfig,
  type BootstrapAssistantHomeResult,
  type ApprovalPort,
  type ApprovalRequestInput,
  type TurnRequestPorts,
  type TurnRequest,
  type TurnIntent,
  type TurnOutcome,
  type TurnEvent,
  type TurnAccessContext,
  type DeliveryOutcome,
  type WorkroomCatalog,
  type WorkroomDefinition,
  FileJournalStore,
  demoteScheduleCreator,
  type ScheduleActivityEvent,
  type ScheduleTurnExecutionRequest,
  resolveWorkroomBotIdentity,
  workroomProjectionMessageKey,
  workroomProjectionBindingKey,
  validateWorkroomDefinitions,
  FileHumanIngressProposalRepository,
  FileHumanIngressApplicationRepository,
  HumanIngressApplicationService,
  type HumanIngressOrchestratorProposalPort,
  type HumanIngressPlanningPort,
  type HumanIngressTargetResolverPort,
  type HumanIngressTargetResolutionRequest,
  WorkroomPlanningClarificationError,
  type WorkroomPlanGateAuthorityPort,
  ConversationEventHumanIngressSourceReader,
  ProductionHumanIngressOrchestratorPort,
  createPlanGateHumanIngressControlPort,
  FileInteractionSpaceBindingRepository,
  InteractionSpaceRouter,
  FileWorkroomProjectionRepository,
  WorkroomProjectionRevisionConflictError,
  type WorkroomCatalogSnapshot,
  type WorkroomProjectionBinding,
  FileAssignmentAuthorityGrantRepository,
  FilePortfolioJournalRepository,
  FilePortfolioControlOutboxRepository,
  DatabasePortfolioControlOutboxRepository,
  ActivatablePortfolioControlOutboxRepository,
  DatabaseAssignmentAuthorityGrantRepository,
  ActivatableAssignmentAuthorityGrantRepository,
  ActivatableProjectKnowledgeJournal,
  FileProjectKnowledgeJournal,
  DatabaseProjectKnowledgeJournal,
  ProjectKnowledgeRegistry,
  ActivatableOverlayPackPromotionRepository,
  FileOverlayPackPromotionRepository,
  DatabaseOverlayPackPromotionRepository,
  JournalWorkroomAssignmentGrantClaimPreview,
  createDurableWorkroomAssignmentAuthorityGrantProvider,
  FileWorkroomTaskReportStore,
  FileProjectMemoryApplicationRepository,
  type WorkroomTaskReportPayloadReadInput,
  type WorkroomTaskReportPayloadWriteInput,
  LocalAssignmentExecutor,
  createWorkroomRoleCapabilitySnapshot,
  createAssignmentExecutionEnvelope,
  type WorkroomPreemptionState,
} from '@zhin.js/agent';
import {
  agentHostToken,
  CapabilityIngress,
  projectHostTool,
  projectHostMcp,
  toolFeatureId,
  turnJournalStoreToken,
  agentTurnEngineToken,
  createFullAgentTurnEngine,
  createNativeFileToolFeatures,
  createNativeWebToolFeatures,
  createNativeTodoToolFeatures,
  createNativeInteractionToolFeatures,
  createNativeSemanticMemoryToolFeatures,
  SemanticMemoryRuntime,
  FileTodoStore,
  AgentRuntime,
  createAgentTraceRuntime,
  createCatalogGovernedWorkroomProjectionAuthority,
  createCatalogGovernedConsoleDisclosureAuthority,
  createGovernedPortfolioSponsorProjectionReader,
  createWorkroomRuntime,
  createSessionTreeRuntimeFromAgent,
  type AgentCapabilities,
  type AssistantRuntimeHandle,
  type WorkroomRuntimeHandle,
  type WorkroomRunControlCommand,
  type SessionTreeRuntimeHandle,
  type ToolCapability,
  type AgentTraceRecorder,
  turnIntentResolverToken,
  type TurnIntentResolver,
  createGenerationWorkroomAcceptancePolicyPort,
  workroomAcceptancePolicyDecisionToken,
  createGenerationWorkroomAcceptanceAuthority,
  workroomAcceptanceAuthorityToken,
  createCatalogWorkroomPlanGateAuthority,
  createGenerationWorkroomPlanGateAuthority,
  workroomPlanGateAuthorityToken,
  createCatalogWorkroomPriorityAuthority,
  createGenerationWorkroomPriorityAuthority,
  workroomPriorityAuthorityToken,
  createGenerationHumanIngressPlanningPort,
  createGenerationOwnedDynamicPlanningProvider,
  createWorkroomDynamicPlanningGenerationSnapshot,
  type WorkroomDynamicPlanningPolicyPort,
  type WorkroomPlanningDisclosurePort,
  type WorkroomStructuredDagModelInput,
  workroomHumanIngressPlanningToken,
  workroomDynamicPlanningPolicyToken,
  workroomPlanningDisclosureToken,
  createWorkroomRemoteCallbackRuntime,
  workroomRemoteCallbackRuntimeToken,
  createGenerationWorkroomRemoteAssignmentAuthority,
  workroomRemoteAssignmentAuthorityToken,
  createWorkroomProjectionMessageGatewayPort,
  createProjectionHumanIngressTargetResolver,
  WorkroomProjectionReplyResolver,
  WorkroomProjectionRuntime,
  WorkroomProjectionScheduler,
  workroomProjectionCatalogBindingDigest,
  WorkroomSchedulerRuntime,
  WorkroomSchedulerSupplyUnavailableError,
  createWorkroomSchedulerKernelCommandPort,
  workroomSchedulerDispatchSupplyToken,
  workroomSchedulerRuntimeToken,
  installWorkroomSchedulerPortfolioDispatchResources,
  WorkroomAssignmentCheckpointDelivery,
  WorkroomPreemptionRuntime,
  workroomCheckpointDeliveryProviderToken,
  workroomPreemptionRuntimeToken,
  workroomProjectProfileRegistryToken,
  workroomAssignmentAuthorityGrantToken,
  workroomAssignmentAuthorityGrantRepositoryToken,
  workroomAssignmentGrantClaimPreviewToken,
  workroomLocalAssignmentAuthorityToken,
  createGenerationWorkroomLocalAssignmentAuthority,
  GenerationOwnedWorkroomAssignmentAuthorityProvider,
  createWorkroomGenerationAuthoritySnapshotFromRuntime,
  WorkroomLocalAssignmentRuntime,
  workroomLocalAssignmentRuntimeToken,
  PinnedProfileCatalogLocalAssignmentRoute,
  DurableReportLocalModelExecutionPort,
  workroomEvidencePayloadWriterToken,
  workroomTaskReportPayloadToken,
  type WorkroomEvidencePayloadWriteInput,
  createAgentCoreWorkroomLocalTurnPort,
  bindWorkroomCapabilityRealization,
  installWorkroomDataGovernanceResources,
  resolveWorkroomDataGovernanceRootAuthorities,
  createGenerationOwnedWorkroomDataGovernanceStorage,
  createFileWorkroomDataLifecycleRuntime,
  createWorkroomDataLifecycleHumanIngressControlPort,
  createGenerationOwnedWorkroomJournalPayloadPort,
  createGenerationOwnedWorkroomGovernedOutboundComposition,
  installWorkroomProfileAuthorityResources,
  createCatalogWorkroomProfilePublisherAuthority,
  createWorkroomProfileGenerationView,
  digestWorkroomProfileCatalogProject,
  WORKROOM_CONTROL_PLANE_ROOT_PRINCIPAL,
  JournalWorkroomRunProfilePinAuthority,
  KernelPlanAdmissionRunProfilePinWriter,
  type AgentHostWorkroomProfileControlPort,
  type AgentHostWorkroomKnowledgeControlPort,
  type AgentHostEffectSponsorControlPort,
  type AgentHostPortfolioSponsorControlPort,
  createCatalogProjectKnowledgeSourceAuthority,
  createGenerationWorkroomEphemeralAssignmentContext,
  createP12WorkroomKnowledgeContentReader,
  workroomEphemeralAssignmentContextToken,
  workroomAssignmentKnowledgeContextToken,
  WorkroomAssignmentKnowledgeContextProjector,
  installWorkroomEffectResources,
  installWorkroomAcceptanceResources,
  FileWorkroomAcceptanceProjectionRepository,
  FileWorkroomKernelRiskHeaderRepository,
  ImmutableWorkroomTypedCheckRegistry,
  PinnedProfileWorkroomAcceptanceProjectionSource,
  WorkroomAcceptanceProfileProjectionRuntime,
  WorkroomAuthenticatedArtifactRiskProducer,
  WorkroomArtifactRiskHeaderResolver,
  workroomTypedAcceptanceCheckRegistryToken,
  workroomRemoteContextReleaseProviderToken,
  createGenerationRemoteContextReleaseCapability,
  FileWorkroomEphemeralContextDisposer,
  createRoutedWorkroomEphemeralContextProvider,
  workroomAcceptanceProjectionSourceBindingDigest,
  workroomAcceptanceProjectionPayloadToken,
  workroomAcceptanceProjectionSourceAuthorityToken,
  type WorkroomAcceptanceProjectionAuthorityPort,
  type WorkroomAcceptanceProjectionSourceAuthorityPort,
  type WorkroomRiskHeaderProducerAuthorityPort,
  type WorkroomEphemeralContextRoutePort,
  type WorkroomEphemeralContextReleaseCapabilityPort,
  WorkroomAcceptedSourceRuntime,
  FileWorkroomContextReleaseJournal,
  workroomProjectMemorySchemaAuthorityToken,
  workroomAcceptedReportReaderToken,
  workroomExecutionContextReleaseToken,
  workroomAcceptedSourceRecallToken,
  workroomAcceptedSourceRuntimeToken,
  type WorkroomProjectMemorySchemaAuthorityPort,
  type WorkroomExecutionContextReleasePort,
  GenerationOwnedPortfolioCapacityRuntime,
  WorkroomPortfolioSponsorRuntime,
  WorkroomPortfolioCheckpointAckAdapter,
  JournalWorkroomPreemptionCheckpointAckReader,
  WorkroomPortfolioAssignmentFailureAuthority,
  KernelPortfolioGrantAssignmentIssuance,
  PortfolioGrantAssignmentAuthority,
  WorkroomPortfolioGrantAssignmentSaga,
  installWorkroomPortfolioControlWorker,
  createCatalogPortfolioSponsorCommandAuthority,
  createPortfolioSponsorHumanIngressControlPort,
  portfolioJournalRepositoryToken,
  portfolioPolicyAuthorityToken,
  portfolioAtomicBundleAuthorityToken,
  portfolioKernelCommandAuthorityToken,
  portfolioUsageGatewayAuthorityToken,
  portfolioClockAuthorityToken,
  portfolioCapacityRuntimeToken,
  portfolioSponsorCommandToken,
  portfolioControlOutboxRepositoryToken,
  workroomPortfolioCheckpointAckAdapterToken,
  workroomSchedulerCapacityRequestToken,
  type PortfolioAtomicBundleAuthorityPort,
  type PortfolioKernelCommandAuthorityPort,
  type PortfolioUsageGatewayAuthorityPort,
  type PortfolioClockAuthorityPort,
  type WorkroomEffectClockPort,
  type WorkroomEffectBlockerPolicyPort,
  type WorkroomPayloadLifecycleIndexPort,
  type WorkroomDataLifecycleConsoleControlPort,
  type PortfolioSponsorProjection,
} from '@zhin.js/agent/runtime';

export { AgentRuntime, AgentTurnCoordinator } from '@zhin.js/agent/runtime';

import type { AgentTool, JsonSchema } from '@zhin.js/ai';
import {
  conversationRefKey,
  type ConversationReference,
  type ConversationRef,
  type ConversationResolution,
} from '@zhin.js/im-contract';
import { resolveSandboxTurnPolicy } from './sandbox-turn-policy.js';
import {
  WorkroomHumanIngressPreRoute,
  createCatalogWorkroomSpace,
  resolveWorkroomHumanIntent,
} from './workroom-human-ingress-route.js';

const WORKROOM_DYNAMIC_PLANNING_SYSTEM_PROMPT = `You produce one untrusted Workroom DAG candidate as strict JSON.
Return exactly: {"version":1,"strategy":{"id":"...","version":"...","digest":"sha256:..."},"tasks":[...]}
Each task must contain exactly: key, title, role, required, maxAttempts, localRank, dependsOn, requires, approval.
requires must contain exactly tools, skills, integrations, authorities arrays. approval is "none" or "sponsor_required".
Use only the supplied strategies, roles, capabilities and constraints. Include at least one required task.
Do not output markdown, commentary, identity, authority, Project state, Sponsor lane, deadline, policy, assignment, or execution state.`;

/** Minimal OutputElement shape for reply flattening (avoid direct @zhin.js/ai dep). */
type OutputElementLike = {
  readonly type: string;
  readonly content?: string;
  readonly url?: string;
  readonly title?: string;
  readonly name?: string;
  readonly description?: string;
  readonly fallbackText?: string;
};

type AIConfig = NonNullable<ConstructorParameters<typeof AIService>[0]>;
export type WorkroomStorageMode = 'database' | 'file';
type McpServerConfig = NonNullable<AIConfig['mcpServers']>[number];

interface AgentToolLike {
  readonly name: string;
  readonly description: string;
  readonly parameters: {
    readonly type: 'object';
    properties?: Record<string, unknown>;
    required?: string[];
  };
  execute(args: Record<string, unknown>): Promise<unknown>;
  readonly source?: string;
  readonly platforms?: readonly string[];
  readonly scopes?: readonly ('private' | 'group' | 'channel')[];
  readonly permissions?: readonly string[];
  readonly hidden?: boolean;
  readonly approval?: 'always' | 'once' | 'never' | 'on-risk';
}

interface McpServerEntry {
  readonly name: string;
  readonly transport: 'stdio' | 'streamable-http' | 'sse';
  readonly url?: string;
  readonly command?: string;
  readonly args?: string[];
  readonly env?: Record<string, string>;
  readonly headers?: Record<string, string>;
}

const logger = getLogger('agent');
const BOOTSTRAP_FILES = ['SOUL.md', 'AGENTS.md', 'TOOLS.md'] as const;
const MAX_BOOTSTRAP_CHARS = 12_000;

export async function resolveAiConfig(
  config: RuntimeConfigDocument | ConfigDocumentPort,
): Promise<AIConfig | undefined> {
  const document = await readConfigDocument(config);
  if (!document || typeof document !== 'object') return undefined;
  const ai = (document as Record<string, unknown>).ai;
  if (!ai || typeof ai !== 'object') return undefined;
  // Top-level `ai` bypasses Plugin ConfigView, so expand environment values
  // here. Validation remains fail-closed; missing secrets are errors.
  return expandEnvironmentValue(ai, (key) => process.env[key]) as AIConfig;
}

export function resolveWorkroomStorageMode(ai: AIConfig | undefined): WorkroomStorageMode {
  return ai?.sessions?.useDatabase === false ? 'file' : 'database';
}

export function assertFixedWorkroomStorageMode(
  fixed: WorkroomStorageMode,
  requested: WorkroomStorageMode,
): void {
  if (requested === fixed) return;
  throw new Error(`Workroom storage mode changed from ${fixed} to ${requested}; process restart required`);
}

export async function assertWorkroomCatalogMatchesGeneration(
  catalog: Pick<WorkroomCatalog, 'read'>,
  agentNames: readonly string[],
  endpointKeys: ReadonlySet<string>,
): Promise<void> {
  const snapshot = await catalog.read();
  const errors = validateWorkroomDefinitions(snapshot.definitions, agentNames, endpointKeys);
  if (errors.length > 0) {
    throw new Error(`Persisted Workroom Catalog is incompatible with this Agent generation: ${errors.join('; ')}`);
  }
}

/** Catalog supplies role identity; authenticated ingress supplies the canonical EndpointRef. */
export function createCatalogWorkroomProjectionBinding(
  catalog: WorkroomCatalogSnapshot,
  projectId: string,
  conversation: ConversationRef,
  bindingRevision: number,
): WorkroomProjectionBinding {
  return createCatalogProjectionBinding(catalog, projectId, conversation, bindingRevision, 'workroom');
}

export function createCatalogSponsorRoomProjectionBinding(
  catalog: WorkroomCatalogSnapshot,
  projectId: string,
  conversation: ConversationRef,
  bindingRevision: number,
): WorkroomProjectionBinding {
  return createCatalogProjectionBinding(catalog, projectId, conversation, bindingRevision, 'sponsor_room');
}

/** Resolves a persisted Sponsor Room to one exact current Endpoint capability. */
export function resolveCatalogSponsorProjectionConversation(
  definition: WorkroomDefinition,
  endpoints: readonly Readonly<{
    id: string; name: string; adapter: string; owner: string;
  }>[],
): WorkroomProjectionBinding['conversation'] | undefined {
  const configured = definition.sponsorConversation;
  if (!configured || configured.kind === 'repository') return undefined;
  const matches = endpoints.filter(endpoint =>
    endpoint.adapter === configured.adapter && endpoint.name === configured.endpoint);
  if (matches.length !== 1) return undefined;
  const endpoint = matches[0]!;
  return Object.freeze({
    endpoint: Object.freeze({ id: endpoint.id, adapter: endpoint.owner }),
    kind: configured.kind,
    id: configured.id,
  });
}

function createCatalogProjectionBinding(
  catalog: WorkroomCatalogSnapshot,
  projectId: string,
  conversation: ConversationRef,
  bindingRevision: number,
  audience: 'workroom' | 'sponsor_room',
): WorkroomProjectionBinding {
  const definition = catalog.definitions[projectId];
  const configured = audience === 'workroom'
    ? definition?.conversation
    : definition?.sponsorConversation;
  if (!definition || !configured || definition.enabled === false) {
    throw new Error(`Workroom Projection requires an enabled Catalog binding for ${projectId}`);
  }
  if (configured.kind === 'repository'
    || configured.kind !== conversation.kind
    || configured.id !== conversation.id) {
    throw new Error(`Workroom Projection canonical conversation does not match Catalog ${projectId}`);
  }
  const orchestratorMember = definition.members.find(member =>
    member.agent === configured.agent && member.role === 'orchestrator');
  if (!orchestratorMember) {
    throw new Error(`Workroom Projection Catalog ${projectId} has no exact Orchestrator`);
  }
  const identity = (member: (typeof definition.members)[number]) => Object.freeze({
    principalId: member.agent,
    agentDefinitionId: member.agent,
    displayName: member.agent,
    role: member.role,
  });
  return Object.freeze({
    version: 1,
    audience,
    projectId,
    catalogBindingDigest: workroomProjectionCatalogBindingDigest(definition),
    bindingRevision,
    projectionPolicyRevision: 1,
    conversation: Object.freeze(structuredClone(conversation)),
    orchestrator: identity(orchestratorMember) as WorkroomProjectionBinding['orchestrator'],
    agents: Object.freeze(definition.members
      .filter(member => member !== orchestratorMember)
      .map(identity)) as WorkroomProjectionBinding['agents'],
  });
}

export async function resolveAssistantConfigDocument(
  config: RuntimeConfigDocument | ConfigDocumentPort,
): Promise<AssistantConfig | undefined> {
  const document = await readConfigDocument(config);
  if (!document || typeof document !== 'object') return undefined;
  const assistant = (document as Record<string, unknown>).assistant;
  if (!assistant || typeof assistant !== 'object') return undefined;
  return expandEnvironmentValue(assistant, (key) => process.env[key]) as AssistantConfig;
}

export interface InstallAgentHostOptions {
  /** Process-owned execution authority attached to exactly one Root. */
  readonly runtime: AgentRuntime;
  /** Process-owned Snapshot reader; local Assignment operations hold an exact generation lease. */
  readonly snapshots?: SnapshotReader;
  /** Process-fixed Workroom storage identity. Changing it requires restart. */
  readonly workroomStorageMode: WorkroomStorageMode;
  /** @deprecated Prefer the generation-owned Primary Config. Test overrides only. */
  readonly ai?: AIConfig;
  /** @deprecated Prefer the generation-owned Primary Config. Test overrides only. */
  readonly assistant?: AssistantConfig;
  readonly im: ImRuntime;
  readonly projectRoot: string;
  /**
   * Resolve Endpoint Owner id for `/approve` + bashAlways key.
   * Key: `localName` (e.g. icqq) or live endpoint name (uin).
   */
  readonly resolveEndpointOwner?: (adapterLocalName: string, endpointKey: string) => string | undefined;
  /**
   * Resolve Endpoint trusted id 列表（plugins.<key>.trusted / endpoints[].trusted）。
   * 对齐 legacy resolveSenderRoles：trusted 角色弱于 master（不参与 Owner 审批放行）。
   */
  readonly resolveEndpointTrusted?: (adapterLocalName: string, endpointKey: string) => readonly string[];
  /** Extra Host tools (e.g. Speech Host voice_stt / voice_tts). */
  readonly extraTools?: readonly AgentToolLike[];
  /** Optional inbound STT (Speech Host). */
  readonly transcribeUrl?: (audioUrl: string) => Promise<string | null>;
  /** Optional host approval override; IM turns otherwise use createRuntimeApprovalPort. */
  readonly approvalPort?: ApprovalPort;
  /** Trusted product-policy seam for explicit steer/follow-up/observe intent and authorization. */
  readonly resolveTurnIntent?: TurnIntentResolver;
  /** Trusted idempotent Orchestrator/Kernel proposal seam for Workroom human ingress. */
  readonly workroomHumanIngressPort?: HumanIngressOrchestratorProposalPort;
  /** @deprecated Test override. Standard startup installs the generation-owned planner. */
  readonly workroomHumanIngressPlanningPort?: HumanIngressPlanningPort;
  /** P12 governed model-provider disclosure; absence fails closed before model invocation. */
  readonly workroomPlanningDisclosurePort?: WorkroomPlanningDisclosurePort;
  /** Persistent exact Project/Profile planning policy; absence fails closed. */
  readonly workroomDynamicPlanningPolicyPort?: WorkroomDynamicPlanningPolicyPort;
  /** Authenticated Sponsor authority for typed pre-execution Plan Gate decisions. */
  readonly workroomPlanGateAuthority?: WorkroomPlanGateAuthorityPort;
  /** Process-owned shared Pack publisher membership; never accepted from HTTP request bodies. */
  readonly workroomTrustedPackPublishers?: readonly string[];
  /**
   * Trusted Root-only wrap/unwrap capability. It is never published through a
   * Feature, Resource snapshot or Console API and never exposes KEK bytes.
   */
  readonly workroomPayloadVaultCryptography?: NonNullable<
    Parameters<typeof installWorkroomDataGovernanceResources>[0]['cryptography']
  >;
  /** @internal Trusted Root test/embedding fallback; production uses the Root-private provider token. */
  readonly workroomDataGovernanceVerification?: NonNullable<
    Parameters<typeof installWorkroomDataGovernanceResources>[0]['governance']
  >;
}

/**
 * Plugin Runtime Agent Host:
 * - AIService from top-level `ai`
 * - Command miss → `ai:` trigger → **ZhinAgent.process** (inbound queue + session)
 * - CapabilityIngress tools + `ai.mcpServers` + SOUL/AGENTS/TOOLS bootstrap
 * - SubagentSystem + `spawn_task` (parallel sub-agents) + deferred meta tools
 * - Optional inbound STT / `@agent` specialist prompt injection
 * - `registerAIHook` / `aiHookRuntimeBus`, ScheduleJobEngine + `schedule_*`
 * - Assistant profile sync + Event Ingress registry (HTTP via Console API)
 * - Subagent/main-turn `bash` (sandbox + safety) + Owner `/approve` 命令面
 */
export function installAgentHost(options: InstallAgentHostOptions): RootResourceInstaller {
  return async ({ generation, signal, resources, lifecycle, handoff, config: primaryConfig, addFeature }) => {
    const configuredAi = options.ai ?? primaryConfig.get<AIConfig>('ai');
    const aiConfig = configuredAi;
    const assistantConfig = options.assistant
      ?? primaryConfig.get<AssistantConfig>('assistant');
    if (!aiConfig || typeof aiConfig !== 'object') return;
    const mcpEntries = parseMcpServers(aiConfig.mcpServers);

    let service: AIService;
    try {
      service = new AIService(aiConfig);
    } catch (error) {
      throw new Error('Agent Host rejected invalid AI configuration', { cause: error });
    }
    if (!service.isReady()) {
      service.dispose();
      throw new Error('Agent Host requires at least one ready AI provider');
    }
    if (!service.getBindingRegistry().getBinding('zhin')) {
      service.dispose();
      throw new Error('Agent Host requires a ready ai.agents.zhin binding');
    }
    lifecycle.add(() => service.dispose());
    const listGenerationBindings = () => Object.freeze(
      service.getBindingRegistry().listAgentNames()
        .map((name) => service.getBindingRegistry().getBinding(name))
        .filter((entry): entry is NonNullable<typeof entry> => entry != null)
        .map((entry) => Object.freeze({ ...entry, mcpServers: [...entry.mcpServers] })),
    );
    const generationEndpointKeys = () => new Set(
      options.im.listEndpoints().map((endpoint) => `${endpoint.adapter}:${endpoint.name}`),
    );

    let zhinAgent: ZhinAgent | undefined;
    let composedRuntime: ReturnType<typeof composeZhinAgentRuntime> | undefined;
    let seedPresets: () => Promise<number>;
    let scheduleTools: ReturnType<typeof createScheduleTools> = [];
    let homeTools: BootstrapAssistantHomeResult['tools'] = [];
    let assistantEnabled = false;
    const semanticMemory = aiConfig.memory?.semantic?.enabled === true
      ? new SemanticMemoryRuntime()
      : null;
    if (semanticMemory) lifecycle.add(() => semanticMemory.dispose());
    const workroomJournal = new ActivatableWorkroomJournal();
    const workroomJournalPayloads = createGenerationOwnedWorkroomJournalPayloadPort({
      generation,
      signal,
    });
    const workroomCatalog = new ActivatableWorkroomCatalog();
    if (!resources.has(workroomPlanGateAuthorityToken)) {
      resources.provide(
        workroomPlanGateAuthorityToken,
        options.workroomPlanGateAuthority ?? createCatalogWorkroomPlanGateAuthority(workroomCatalog),
      );
    }
    if (!resources.has(workroomPriorityAuthorityToken)) {
      resources.provide(
        workroomPriorityAuthorityToken,
        createCatalogWorkroomPriorityAuthority(workroomCatalog),
      );
    }
    if (options.workroomHumanIngressPlanningPort
      && !resources.has(workroomHumanIngressPlanningToken)) {
      resources.provide(workroomHumanIngressPlanningToken, options.workroomHumanIngressPlanningPort);
    }
    if (options.workroomPlanningDisclosurePort
      && !resources.has(workroomPlanningDisclosureToken)) {
      resources.provide(workroomPlanningDisclosureToken, options.workroomPlanningDisclosurePort);
    }
    if (options.workroomDynamicPlanningPolicyPort
      && !resources.has(workroomDynamicPlanningPolicyToken)) {
      resources.provide(workroomDynamicPlanningPolicyToken, options.workroomDynamicPlanningPolicyPort);
    }
    const workroomKernel = new WorkroomKernel({
      journal: workroomJournal,
      acceptancePolicy: createGenerationWorkroomAcceptancePolicyPort(() =>
        resources.has(workroomAcceptancePolicyDecisionToken)
          ? resources.use(workroomAcceptancePolicyDecisionToken)
          : undefined),
      acceptanceAuthority: createGenerationWorkroomAcceptanceAuthority(() =>
        resources.has(workroomAcceptanceAuthorityToken)
          ? resources.use(workroomAcceptanceAuthorityToken)
          : undefined),
      remoteAssignmentAuthority: createGenerationWorkroomRemoteAssignmentAuthority(() =>
        resources.has(workroomRemoteAssignmentAuthorityToken)
          ? resources.use(workroomRemoteAssignmentAuthorityToken)
          : undefined),
      localAssignmentAuthority: createGenerationWorkroomLocalAssignmentAuthority(() =>
        resources.has(workroomLocalAssignmentAuthorityToken)
          ? resources.use(workroomLocalAssignmentAuthorityToken)
          : undefined),
      planGateAuthority: createGenerationWorkroomPlanGateAuthority(() =>
        resources.has(workroomPlanGateAuthorityToken)
          ? resources.use(workroomPlanGateAuthorityToken)
          : undefined),
      priorityAuthority: createGenerationWorkroomPriorityAuthority(() =>
        resources.has(workroomPriorityAuthorityToken)
          ? resources.use(workroomPriorityAuthorityToken)
          : undefined),
      runControlAuthority: createCatalogWorkroomRunControlAuthority(workroomCatalog),
    });
    const activateFileWorkroomJournal = () => {
      if (!workroomJournal.active) {
        workroomJournal.activate(new FileWorkroomJournal(
          join(options.projectRoot, '.zhin', 'workroom-journal'),
          workroomJournalPayloads.payloads,
        ));
      }
    };
    const activateFileWorkroomCatalog = async () => {
      workroomCatalog.activate(new FileWorkroomCatalog(join(options.projectRoot, '.zhin', 'workroom-catalog.json')));
      await assertWorkroomCatalogMatchesGeneration(
        workroomCatalog,
        listGenerationBindings().map((binding) => binding.name),
        generationEndpointKeys(),
      );
    };
    let workroomRuntime: WorkroomRuntimeHandle;
    const dataGovernanceRuntimeRef: {
      current?: ReturnType<typeof installWorkroomDataGovernanceResources>;
    } = {};
    let sessionTreeRuntime: SessionTreeRuntimeHandle;
    const traceRuntime = createAgentTraceRuntime();
    const rememberedSandboxApprovals = new Map<string, Set<string>>();
    let schedule: ReturnType<typeof wireRuntimeSchedule>;
    try {
      const created = createRuntimeZhinAgent(
        service,
        options.im,
        options.projectRoot,
        options.approvalPort,
      );
      zhinAgent = created.agent;
      composedRuntime = created.runtime;
      lifecycle.add(() => created.agent.dispose());
      seedPresets = created.seedPresets;

      // Console reads the same replayed facts as tools; it never receives the
      // command authority or a mutable repository.
      const consoleProjectionAuthority = createCatalogGovernedWorkroomProjectionAuthority({
        catalog: workroomCatalog,
        governance: Object.freeze({
          readProject: async (projectId: string) =>
            await dataGovernanceRuntimeRef.current?.options.repository.readProject(projectId),
        }),
      });
      workroomRuntime = createWorkroomRuntime(workroomJournal, consoleProjectionAuthority);
      sessionTreeRuntime = createSessionTreeRuntimeFromAgent(asPrivate(zhinAgent));
      schedule = wireRuntimeSchedule(
        zhinAgent,
        service,
        options.runtime,
        options.im,
        options.projectRoot,
        assistantConfig,
        lifecycle,
        traceRuntime,
      );
      scheduleTools = schedule.tools;
      assistantEnabled = schedule.assistantEnabled;
      lifecycle.add(schedule.dispose);

      const home = await wireRuntimeHome(
        options.projectRoot,
        assistantConfig,
        schedule.notificationRouter,
        schedule.bindCallHaService,
        schedule.defaultNotify,
      );
      homeTools = home.tools;
      lifecycle.add(home.dispose);
      if (home.homeActive) {
        logger.info(formatCompact({
          op: 'agent_host_home',
          enabled: true,
          watch: home.watchActive,
          tools: home.tools.length,
        }));
      }
    } catch (error) {
      throw new Error('Agent Host candidate initialization failed', { cause: error });
    }
    if (!zhinAgent || !composedRuntime) throw new Error('Agent Host candidate did not create a complete Agent runtime');

    const useDatabase = aiConfig.sessions?.useDatabase !== false;
    const requestedWorkroomStorageMode = resolveWorkroomStorageMode(aiConfig);
    assertFixedWorkroomStorageMode(options.workroomStorageMode, requestedWorkroomStorageMode);
    const workroomStateRoot = join(options.projectRoot, '.zhin');
    const assignmentAuthorityGrants = new ActivatableAssignmentAuthorityGrantRepository();
    const projectKnowledgeJournal = new ActivatableProjectKnowledgeJournal();
    const fileProjectKnowledgeJournal = new FileProjectKnowledgeJournal(
      join(workroomStateRoot, 'workroom-project-knowledge'),
    );
    const overlayPackPromotions = new ActivatableOverlayPackPromotionRepository();
    const fileOverlayPackPromotions = new FileOverlayPackPromotionRepository(
      join(workroomStateRoot, 'workroom-overlay-pack-promotions'),
    );
    const portfolioControlOutbox = new ActivatablePortfolioControlOutboxRepository();
    const filePortfolioControlOutbox = new FilePortfolioControlOutboxRepository(
      join(workroomStateRoot, 'portfolio-control-outbox'),
    );
    let persistencePendingActivate = false;
    let dataGovernanceStorage: ReturnType<
      typeof createGenerationOwnedWorkroomDataGovernanceStorage
    > | undefined;
    let recoverHumanIngress = async (): Promise<void> => {};
    if (useDatabase) {
      if (!resources.has(databaseRootHostToken)) {
        throw new Error('Process-fixed Workroom database storage requires the Database Root Host');
      }
      const database = resources.use(databaseRootHostToken);
      try {
        const tableCount = defineAiDatabaseModels((name, definition) => {
          database.define(name, definition);
        });
        persistencePendingActivate = true;
        handoff.add({
          activateNext: async (signal) => {
            signal.throwIfAborted();
            try {
              const raw = database.getRawDatabase();
              if (!raw) {
                throw new Error('Agent persistence requires an active database connection');
              }
              await activateAiDatabaseStorage(
                raw,
                { aiService: service, zhinAgent },
                aiConfig,
                workroomJournal,
                workroomJournalPayloads.payloads,
                workroomCatalog,
                semanticMemory,
              );
              const grantModel = raw.models?.get('workroom_assignment_authority_grants');
              if (!grantModel) {
                throw new Error('Workroom requires the Assignment Authority Grant database model');
              }
              assignmentAuthorityGrants.activate(new DatabaseAssignmentAuthorityGrantRepository(
                raw as ConstructorParameters<typeof DatabaseAssignmentAuthorityGrantRepository>[0],
                grantModel as ConstructorParameters<typeof DatabaseAssignmentAuthorityGrantRepository>[1],
              ));
              const catalogSnapshot = await workroomCatalog.read();
              const projectIds = Object.keys(catalogSnapshot.definitions).sort();
              if (dataGovernanceStorage) {
                await dataGovernanceStorage.activateDatabase({
                  database: raw,
                  projectIds,
                  repositoryIdentity: 'database-root:primary',
                  signal,
                });
              }
              const knowledgeModel = raw.models?.get('workroom_project_knowledge');
              const promotionModel = raw.models?.get('workroom_overlay_pack_promotions');
              if (!knowledgeModel || !promotionModel) {
                throw new Error('Workroom requires the Project Knowledge and Overlay Promotion database models');
              }
              const databaseKnowledge = new DatabaseProjectKnowledgeJournal(
                raw as ConstructorParameters<typeof DatabaseProjectKnowledgeJournal>[0],
                knowledgeModel as ConstructorParameters<typeof DatabaseProjectKnowledgeJournal>[1],
              );
              await projectKnowledgeJournal.activate(
                databaseKnowledge,
                projectIds,
                fileProjectKnowledgeJournal,
              );
              const databasePromotions = new DatabaseOverlayPackPromotionRepository(
                raw as ConstructorParameters<typeof DatabaseOverlayPackPromotionRepository>[0],
                promotionModel as ConstructorParameters<typeof DatabaseOverlayPackPromotionRepository>[1],
              );
              const promotionIds = new Set<string>();
              for (const projectId of projectIds) {
                for (const record of await fileOverlayPackPromotions.list(projectId)) {
                  promotionIds.add(record.promotionId);
                }
                for (const record of await databasePromotions.list(projectId)) {
                  promotionIds.add(record.promotionId);
                }
              }
              await overlayPackPromotions.activate(
                databasePromotions,
                [...promotionIds].sort(),
                fileOverlayPackPromotions,
              );
              const portfolioControlModel = raw.models?.get('portfolio_control_outbox');
              if (!portfolioControlModel) {
                throw new Error('Workroom requires the Portfolio Control Outbox database model');
              }
              const portfolioRepository = resources.has(portfolioJournalRepositoryToken)
                ? resources.use(portfolioJournalRepositoryToken)
                : undefined;
              const portfolioIds = new Set([
                ...await filePortfolioControlOutbox.listPortfolioIds(),
                ...(portfolioRepository ? await portfolioRepository.listPortfolioIds() : []),
              ]);
              await portfolioControlOutbox.activate(
                new DatabasePortfolioControlOutboxRepository(
                  raw as ConstructorParameters<typeof DatabasePortfolioControlOutboxRepository>[0],
                  portfolioControlModel as ConstructorParameters<typeof DatabasePortfolioControlOutboxRepository>[1],
                ),
                [...portfolioIds].sort(),
                filePortfolioControlOutbox,
              );
              await assertWorkroomCatalogMatchesGeneration(
                workroomCatalog,
                listGenerationBindings().map((binding) => binding.name),
                generationEndpointKeys(),
              );
              await recoverHumanIngress();
              signal.throwIfAborted();
              logger.info(formatCompact({
                op: 'agent_host_persistence',
                mode: 'database',
                tables: tableCount,
              }));
            } catch (error) {
              throw new Error('Agent database persistence activation failed', { cause: error });
            } finally {
              zhinAgent.markMemoryPersistenceReady();
            }
          },
        });
      } catch (error) {
        throw new Error('Agent database model registration failed', { cause: error });
      }
    } else if (semanticMemory) {
      throw new Error('ai.memory.semantic.enabled requires the Database Root Host');
    } else {
      activateFileWorkroomJournal();
      await activateFileWorkroomCatalog();
      assignmentAuthorityGrants.activate(new FileAssignmentAuthorityGrantRepository(
        join(workroomStateRoot, 'workroom-assignment-authority-grants'),
      ));
      const projectIds = Object.keys((await workroomCatalog.read()).definitions).sort();
      await projectKnowledgeJournal.activate(fileProjectKnowledgeJournal, projectIds);
      const promotionIds = new Set<string>();
      for (const projectId of projectIds) {
        for (const record of await fileOverlayPackPromotions.list(projectId)) {
          promotionIds.add(record.promotionId);
        }
      }
      await overlayPackPromotions.activate(fileOverlayPackPromotions, [...promotionIds].sort());
      await portfolioControlOutbox.activate(
        filePortfolioControlOutbox,
        await filePortfolioControlOutbox.listPortfolioIds(),
      );
      zhinAgent.markMemoryPersistenceReady();
    }

    const bashTool = createBashTool();
    const ingress = new CapabilityIngress();
    const bootstrapText = await loadBootstrap(options.projectRoot);

    // Register before any await so a cancelled generation cannot leak Agent
    // Resources. DisposeStack continues through later cleanup when one
    // Resource fails.
    // Configured MCP joins the candidate's MCP projection. Its connection is
    // opened by generation activation and closed by rollback/retirement.
    for (const entry of mcpEntries) {
      const projected = projectHostMcp(entry);
      addFeature(projected.feature, projected.name, projected.definition);
    }

    // extraTools (e.g. voice_stt / voice_tts) join the candidate ToolFeature.
    // Native builtin file tools are projected via createNativeFileToolFeatures
    // below — they are the SSOT and own the security context (workspaceRoot
    // + execPreset). bash remains an explicit Tool projection consumed by
    // subagent createRuntimeSubagentAgentTools.
    for (const tool of [
      ...(options.extraTools ?? []),
      bashTool,
    ]) {
      if (!tool.description?.trim()) {
        throw new TypeError(`Host tool "${tool.name}" description cannot be empty`);
      }
      const projected = projectHostTool({
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
        approval: 'approval' in tool ? tool.approval : undefined,
        platforms: tool.platforms,
        scopes: tool.scopes,
        permissions: tool.permissions,
        hidden: tool.hidden,
        execute: (input) => tool.execute(input) as unknown | Promise<unknown>,
      });
      addFeature(projected.feature, projected.name, projected.definition);
    }

    for (const tool of [...scheduleTools, ...homeTools]) {
      addFeature(toolFeatureId, tool.name, tool.definition);
    }
    for (const tool of createNativeFileToolFeatures()) {
      addFeature(tool.feature, tool.name, tool.definition);
    }
    for (const tool of createNativeWebToolFeatures()) {
      addFeature(tool.feature, tool.name, tool.definition);
    }
    for (const tool of createNativeTodoToolFeatures(
      new FileTodoStore(join(options.projectRoot, '.zhin', 'todos')),
    )) {
      addFeature(tool.feature, tool.name, tool.definition);
    }
    for (const tool of createNativeInteractionToolFeatures()) {
      addFeature(tool.feature, tool.name, tool.definition);
    }
    if (semanticMemory) {
      for (const tool of createNativeSemanticMemoryToolFeatures(semanticMemory)) {
        addFeature(tool.feature, tool.name, tool.definition);
      }
    }

    const resourceHub = zhinAgent.resourceHub;
    if (!resourceHub) {
      throw new Error('Agent Host requires a ready AgentResourceHub before generation publication');
    }
    const workroomProfileConsoleControl: { current?: AgentHostWorkroomProfileControlPort } = {};
    const workroomKnowledgeConsoleControl: { current?: AgentHostWorkroomKnowledgeControlPort } = {};
    const portfolioSponsorConsoleControl: {
      current?: AgentHostPortfolioSponsorControlPort;
    } = {};
    const effectSponsorConsoleControl: {
      current?: AgentHostEffectSponsorControlPort;
    } = {};
    const dataLifecycleConsoleControl: {
      current?: WorkroomDataLifecycleConsoleControlPort;
    } = {};

    // Protocol Hosts (MCP/A2A) and Console consume this generation-owned port.
    // The Scope is sealed after all Root installers finish, so publication must
    // happen here rather than through a mutable process-global registry.
    resources.provide(agentHostToken, Object.freeze({
      protocol: Object.freeze({
        listBindings: listGenerationBindings,
        execute: (bindingName: string, request: TurnRequest) => {
          const selected = service.getBindingRegistry().getBinding(bindingName);
          if (!selected) throw new Error(`Agent binding not found: ${bindingName}`);
          return options.runtime.execute(rootPluginId(), request, {
            binding: selected,
            mcpServers: selected.mcpServers,
            ...(selected.name === 'zhin' ? {} : { agent: selected.name }),
          }, observeTrace(traceRuntime, request));
        },
      }),
      introspection: Object.freeze({
        listTools: () => resourceHub.tools.getAll().map((tool) => Object.freeze({
          name: tool.name,
          description: tool.description,
          hidden: 'hidden' in tool && tool.hidden === true,
        })),
        listMcpServers: () => resourceHub.mcps.getAll().map((entry) => Object.freeze({
          name: entry.name,
          connected: resourceHub.mcps.isConnected(entry.name),
          toolCount: resourceHub.mcps.getToolsFromServer(entry.name).length,
        })),
      }),
      console: Object.freeze({
        sessionTree: sessionTreeRuntime,
        workroom: workroomRuntime,
        workroomControl: Object.freeze({
          execute: (
            command: WorkroomRunControlCommand,
            authenticatedPrincipal: Readonly<{ principalId: string }>,
          ) =>
            workroomKernel.controlRun(command, authenticatedPrincipal),
        }),
        workroomCatalog,
        listBindings: listGenerationBindings,
        assistant: schedule.assistantRuntime,
        trace: traceRuntime,
        cancelSession: (sessionKey: string) => zhinAgent.cancelSession(sessionKey),
        get workroomProfiles() { return workroomProfileConsoleControl.current; },
        get workroomKnowledge() { return workroomKnowledgeConsoleControl.current; },
        get portfolioSponsor() { return portfolioSponsorConsoleControl.current; },
        get effectSponsor() { return effectSponsorConsoleControl.current; },
        get dataLifecycle() { return dataLifecycleConsoleControl.current; },
      }),
    }));
    resources.provide(
      turnJournalStoreToken,
      new FileJournalStore(join(options.projectRoot, '.zhin', 'agent-journal')),
    );
    resources.provide(agentTurnEngineToken, createFullAgentTurnEngine({
      host: asPrivate(zhinAgent),
      core: composedRuntime.agentCore,
      sessionSystem: composedRuntime.sessionSystem,
      contextSystem: composedRuntime.contextSystem,
      loopHooks: service.loopHooks,
      bootstrapContext: bootstrapText,
    }));

    const presetCount = await seedPresets();

    const binding = service.getBindingRegistry().requireZhinBinding();
    mkdirSync(workroomStateRoot, { recursive: true });
    const rootDataGovernance = await resolveWorkroomDataGovernanceRootAuthorities({
      resources,
      generation,
      requester: rootPluginId(),
      signal,
    });
    const dataGovernanceCryptography = rootDataGovernance?.cryptography
      ?? options.workroomPayloadVaultCryptography;
    if (dataGovernanceCryptography) {
      dataGovernanceStorage = createGenerationOwnedWorkroomDataGovernanceStorage({
        stateRoot: workroomStateRoot,
        generation,
        cryptography: dataGovernanceCryptography,
      });
      if (!useDatabase) await dataGovernanceStorage.activateFile();
    }
    const lifecycleAuthorities = rootDataGovernance?.lifecycle;
    const dataLifecycle = dataGovernanceStorage && lifecycleAuthorities
      ? createFileWorkroomDataLifecycleRuntime({
          stateRoot: workroomStateRoot,
          generation,
          signal,
          journal: dataGovernanceStorage.lifecycle,
          clock: lifecycleAuthorities.clock,
          authority: lifecycleAuthorities.authority,
          subjects: lifecycleAuthorities.subjects,
          deletion: lifecycleAuthorities.deletion,
          receipts: lifecycleAuthorities.receipts,
          objects: Object.freeze({
            resolve: async (
              handle: Parameters<
                Parameters<typeof createFileWorkroomDataLifecycleRuntime>[0]['objects']['resolve']
              >[0],
              operationSignal: AbortSignal,
            ) =>
              await dataGovernanceStorage?.vault.resolveLifecycleObject?.(handle, operationSignal),
          }),
          ...(lifecycleAuthorities.console
            ? {
                consoleAuthority: lifecycleAuthorities.console,
                consoleDisclosure: createCatalogGovernedConsoleDisclosureAuthority({
                  catalog: workroomCatalog,
                  governance: Object.freeze({
                    readProject: async (projectId: string) =>
                      await dataGovernanceRuntimeRef.current?.options.repository.readProject(projectId),
                  }),
                }),
              }
            : {}),
        })
      : undefined;
    dataLifecycleConsoleControl.current = dataLifecycle?.console;
    const dataGovernanceRuntime = installWorkroomDataGovernanceResources({
      projectRoot: options.projectRoot,
      generation,
      signal,
      resources,
      ...(rootDataGovernance?.cryptography ?? options.workroomPayloadVaultCryptography
        ? { cryptography: rootDataGovernance?.cryptography ?? options.workroomPayloadVaultCryptography }
        : {}),
      ...(rootDataGovernance?.governance ?? options.workroomDataGovernanceVerification
        ? { governance: rootDataGovernance?.governance ?? options.workroomDataGovernanceVerification }
        : {}),
      ...(dataGovernanceStorage ? { vault: dataGovernanceStorage.vault } : {}),
      ...(dataLifecycle && lifecycleAuthorities
        ? {
            payloadLifecycleIndex: Object.freeze({
              register: async (
                input: Parameters<WorkroomPayloadLifecycleIndexPort['register']>[0],
                operationSignal: AbortSignal,
              ) => {
                const state = await dataLifecycle.control.register({
                  version: 1,
                  operationId: input.operationId,
                  authenticatedPrincipalId: lifecycleAuthorities.registrationPrincipalId,
                  handle: input.handle,
                }, operationSignal);
                return Object.freeze({ digest: state.digest });
              },
            }),
          }
        : {}),
      ...(lifecycleAuthorities ? { payloadPurge: lifecycleAuthorities.orphanPurge } : {}),
      payloadPublicationVerifier: Object.freeze({
        async verify(
          intent: Parameters<NonNullable<
            Parameters<typeof installWorkroomDataGovernanceResources>[0]['payloadPublicationVerifier']
          >['verify']>[0],
          operationSignal: AbortSignal,
        ) {
          operationSignal.throwIfAborted();
          if (intent.consumer === 'journal_header') {
            return workroomJournal.verifyGovernedPayloadPublication
              ? await workroomJournal.verifyGovernedPayloadPublication(intent)
              : Object.freeze({ status: 'unknown' as const });
          }
          if (intent.consumer === 'evidence_header'
            || intent.consumer === 'task_report_header') {
            return await workroomReports.verifyGovernedPayloadPublication(intent);
          }
          return Object.freeze({ status: 'unknown' as const });
        },
      }),
      acceptanceProjectionSources: Object.freeze({
        async resolve(
          input: Parameters<WorkroomAcceptanceProjectionSourceAuthorityPort['resolve']>[0],
          operationSignal: AbortSignal,
        ) {
          if (!resources.has(workroomAcceptanceProjectionSourceAuthorityToken)) return undefined;
          return await resources.use(workroomAcceptanceProjectionSourceAuthorityToken)
            .resolve(input, operationSignal);
        },
      }),
    });
    dataGovernanceRuntimeRef.current = dataGovernanceRuntime;
    workroomJournalPayloads.activate(dataGovernanceRuntime.journalPayloads);
    handoff.add({
      activateNext: async operationSignal => {
        const catalog = await workroomCatalog.read();
        await dataGovernanceRuntime.reconcilePayloadPurges(
          Object.keys(catalog.definitions).sort(),
          operationSignal,
        );
      },
    });
    const governedOutbound = createGenerationOwnedWorkroomGovernedOutboundComposition({
      generation,
      signal,
      runtime: dataGovernanceRuntime,
    });
    const emergencyEffectBlockerPolicyBody = Object.freeze({
      kind: 'root_emergency_fallback' as const,
      ref: 'root-emergency-effect-blocker-policy:1',
      description: 'Conservative coordination blocker only; never authorizes an Effect',
    });
    const emergencyEffectBlockerPolicy = Object.freeze({
      kind: emergencyEffectBlockerPolicyBody.kind,
      ref: emergencyEffectBlockerPolicyBody.ref,
      digest: `sha256:${createHash('sha256')
        .update(JSON.stringify(emergencyEffectBlockerPolicyBody))
        .digest('hex')}`,
    });
    const effectComposition = installWorkroomEffectResources({
      projectRoot: options.projectRoot,
      generation,
      signal,
      resources,
      projects: Object.freeze({
        listProjectIds: async () => Object.freeze(Object.entries((await workroomCatalog.read()).definitions)
          .filter(([, definition]) => definition.enabled !== false)
          .map(([projectId]) => projectId)),
      }),
      clock: Object.freeze({
        read: async (state: Parameters<WorkroomEffectClockPort['read']>[0]) => (await workroomKernel.read(
          state.intent.projectId,
          state.intent.runId,
        )).now,
      }),
      blockerPolicy: Object.freeze({
        resolve: async ({ state, phase }: Parameters<WorkroomEffectBlockerPolicyPort['resolve']>[0]) => {
          const [catalog, run] = await Promise.all([
            workroomCatalog.read(),
            workroomKernel.read(state.intent.projectId, state.intent.runId),
          ]);
          const definition = catalog.definitions[state.intent.projectId];
          if (!definition || definition.enabled === false) {
            throw new Error('Effect blocker policy requires the current enabled Catalog Project');
          }
          const sponsors = [...new Set(definition.sponsors ?? [])];
          const exactOwner = sponsors.length === 1
            ? `sponsor:${sponsors[0]}@catalog:${catalog.revision}`
            : sponsors.length > 1
              ? `sponsor-set:${createHash('sha256').update(sponsors.sort().join('\0')).digest('hex')}@catalog:${catalog.revision}`
              : `orchestrator:${definition.conversation?.agent ?? 'project-role'}@catalog:${catalog.revision}`;
          return Object.freeze({
            owner: exactOwner,
            policy: emergencyEffectBlockerPolicy,
            deadline: run.now + 60_000,
            allowedSuccessors: Object.freeze(phase === 'reconcile'
              ? ['reconcile', 'cancel'] as const
              : ['retry', 'cancel'] as const),
          });
        },
      }),
      intervalMs: 1_000,
      onError: error => logger.error(formatCompact({
        op: 'workroom_effect_runtime',
        error: error instanceof Error ? error.message : String(error),
      })),
    });
    lifecycle.add(() => effectComposition.runtime.dispose());
    handoff.add({
      activateNext: operationSignal => {
        operationSignal.throwIfAborted();
        effectComposition.runtime.start();
      },
    });
    if (!options.snapshots) {
      throw new Error('Workroom Profile authority requires the process-owned SnapshotReader');
    }
    const runProfilePinAuthority = new JournalWorkroomRunProfilePinAuthority({
      generation,
      journal: workroomJournal,
    });
    const profileAuthority = createCatalogWorkroomProfilePublisherAuthority({
      catalog: workroomCatalog,
      trustedPackPublishers: options.workroomTrustedPackPublishers ?? [],
      decisionDirectory: join(workroomStateRoot, 'workroom-profile-authority-decisions'),
    });
    const profileComposition = installWorkroomProfileAuthorityResources({
      projectRoot: options.projectRoot,
      generation,
      signal,
      snapshots: options.snapshots,
      resources,
      authority: profileAuthority,
      runPinAuthority: runProfilePinAuthority,
      resolveGenerationView: snapshot => {
        const authority = createWorkroomGenerationAuthoritySnapshotFromRuntime(
          snapshot,
          listGenerationBindings(),
        );
        return createWorkroomProfileGenerationView({
          generation: authority.generation,
          tools: authority.tools.map(tool => ({ id: tool.name, digest: tool.digest })),
          skills: authority.skills.map(skill => ({ id: skill.name, digest: skill.digest })),
          agents: authority.agents.map(agent => ({ id: agent.id, digest: agent.digest })),
        });
      },
    });
    const projectProfiles = profileComposition.profiles;
    const profileRunPinWriter = new KernelPlanAdmissionRunProfilePinWriter({
      authority: runProfilePinAuthority,
      profiles: projectProfiles,
      runPins: profileComposition.runPins,
    });
    const acceptanceProfileSource = new PinnedProfileWorkroomAcceptanceProjectionSource({
      profiles: projectProfiles,
      catalog: workroomCatalog,
    });
    if (!resources.has(workroomAcceptanceProjectionSourceAuthorityToken)) {
      resources.provide(workroomAcceptanceProjectionSourceAuthorityToken, acceptanceProfileSource);
    }
    workroomProfileConsoleControl.current = Object.freeze({
      publishPack: async (
        command: Parameters<AgentHostWorkroomProfileControlPort['publishPack']>[0],
        authenticatedPrincipal: Parameters<AgentHostWorkroomProfileControlPort['publishPack']>[1],
      ) => {
        if (authenticatedPrincipal.principalId === WORKROOM_CONTROL_PLANE_ROOT_PRINCIPAL) {
          throw new Error('Control-plane Root Pack bootstrap is not exposed through Console HTTP');
        }
        return await profileComposition.control.publishPack({
          ...structuredClone(command),
          version: 1,
          authenticatedPrincipalId: authenticatedPrincipal.principalId,
        }, signal);
      },
      publishProfile: (
        command: Parameters<AgentHostWorkroomProfileControlPort['publishProfile']>[0],
        authenticatedPrincipal: Parameters<AgentHostWorkroomProfileControlPort['publishProfile']>[1],
      ) =>
        profileComposition.control.publishProfile({
        ...structuredClone(command),
        version: 1,
        authenticatedPrincipalId: authenticatedPrincipal.principalId,
        source: Object.freeze({
          kind: 'sponsor_decision' as const,
          sourceId: `console:${command.operationId}`,
        }),
      }, signal),
      publishRollback: (
        command: Parameters<AgentHostWorkroomProfileControlPort['publishRollback']>[0],
        authenticatedPrincipal: Parameters<AgentHostWorkroomProfileControlPort['publishRollback']>[1],
      ) =>
        profileComposition.control.publishRollback({
        ...structuredClone(command),
        version: 1,
        authenticatedPrincipalId: authenticatedPrincipal.principalId,
        source: Object.freeze({
          kind: 'sponsor_decision' as const,
          sourceId: `console:${command.operationId}`,
        }),
      }, signal),
      publishPlanningPolicy: async (
        command: Parameters<AgentHostWorkroomProfileControlPort['publishPlanningPolicy']>[0],
        authenticatedPrincipal: Parameters<AgentHostWorkroomProfileControlPort['publishPlanningPolicy']>[1],
      ) => {
        const [catalog, profiles] = await Promise.all([
          workroomCatalog.read(),
          projectProfiles.read(command.projectId),
        ]);
        const definition = catalog.definitions[command.projectId];
        const profile = profiles.revisions[command.profileRevisionId];
        if (!definition || definition.enabled === false || !profile) {
          throw new Error('Console Planning Policy targets an unavailable Project/Profile');
        }
        return await profileComposition.control.publishPlanningPolicy({
          ...structuredClone(command),
          version: 1,
          authenticatedPrincipalId: authenticatedPrincipal.principalId,
          catalogRevision: catalog.revision,
          projectDigest: digestWorkroomProfileCatalogProject(definition),
          profileDigest: profile.compiledDigest,
        }, signal);
      },
    });
    const knowledgeSourceAuthority = createCatalogProjectKnowledgeSourceAuthority({
      catalog: workroomCatalog,
      directory: join(workroomStateRoot, 'workroom-project-knowledge-authority'),
    });
    const projectKnowledge = new ProjectKnowledgeRegistry({
      journal: projectKnowledgeJournal,
      sourceAuthority: knowledgeSourceAuthority,
      generationView: Object.freeze({
        async withCurrent<TResult>(operation: Readonly<{
          generation: number; operationId: string; signal: AbortSignal;
        }>, use: () => TResult | Promise<TResult>): Promise<TResult> {
          operation.signal.throwIfAborted();
          if (operation.generation !== generation || !options.snapshots) {
            throw new Error('Project Knowledge operation targets another Root generation');
          }
          const lease = options.snapshots.acquire();
          try {
            if (!options.snapshots.owns(lease) || lease.value.generation !== generation) {
              throw new Error('Project Knowledge generation is no longer current');
            }
            return await use();
          } finally {
            lease.release();
          }
        },
      }),
    });
    const ephemeralAssignmentContext = createGenerationWorkroomEphemeralAssignmentContext({
      generation,
      signal,
    });
    const assignmentKnowledge = new WorkroomAssignmentKnowledgeContextProjector({
      profiles: projectProfiles,
      knowledge: projectKnowledge,
      contentReader: createP12WorkroomKnowledgeContentReader({
        governance: dataGovernanceRuntime.disclosureManifest,
        signal,
      }),
      publisher: ephemeralAssignmentContext,
    });
    resources.provide(workroomEphemeralAssignmentContextToken, ephemeralAssignmentContext);
    resources.provide(workroomAssignmentKnowledgeContextToken, assignmentKnowledge);
    lifecycle.add(() => ephemeralAssignmentContext.dispose());
    workroomKnowledgeConsoleControl.current = Object.freeze({
      read: (projectId: string) => projectKnowledge.read(projectId),
      publish: async (
        command: Parameters<AgentHostWorkroomKnowledgeControlPort['publish']>[0],
        authenticatedPrincipal: Parameters<AgentHostWorkroomKnowledgeControlPort['publish']>[1],
      ) => {
        const source = await knowledgeSourceAuthority.issueSponsorDecision({
          operationId: command.operationId,
          projectId: command.projectId,
          principalId: authenticatedPrincipal.principalId,
        });
        return await projectKnowledge.publish({
          ...structuredClone(command),
          version: 1,
          generation,
          ownerPrincipalId: authenticatedPrincipal.principalId,
          source,
        }, signal);
      },
      rollback: async (
        command: Parameters<AgentHostWorkroomKnowledgeControlPort['rollback']>[0],
        authenticatedPrincipal: Parameters<AgentHostWorkroomKnowledgeControlPort['rollback']>[1],
      ) => {
        const source = await knowledgeSourceAuthority.issueSponsorDecision({
          operationId: command.operationId,
          projectId: command.projectId,
          principalId: authenticatedPrincipal.principalId,
        });
        return await projectKnowledge.rollback({
          ...structuredClone(command),
          version: 1,
          generation,
          ownerPrincipalId: authenticatedPrincipal.principalId,
          source,
        }, signal);
      },
    });
    const workroomReports = new FileWorkroomTaskReportStore(
      join(workroomStateRoot, 'workroom-task-reports'),
      Object.freeze({
        write: async (input: WorkroomTaskReportPayloadWriteInput, operationSignal: AbortSignal) => {
          if (!resources.has(workroomTaskReportPayloadToken)) {
            throw new Error('Governed Workroom Task Report Payload Port is unavailable');
          }
          return await resources.use(workroomTaskReportPayloadToken).write(input, operationSignal);
        },
        read: async (input: WorkroomTaskReportPayloadReadInput, operationSignal: AbortSignal) => {
          if (!resources.has(workroomTaskReportPayloadToken)) {
            throw new Error('Governed Workroom Task Report Payload Port is unavailable');
          }
          return await resources.use(workroomTaskReportPayloadToken).read(input, operationSignal);
        },
      }),
      signal,
    );
    if (!resources.has(workroomAcceptedReportReaderToken)) {
      resources.provide(workroomAcceptedReportReaderToken, workroomReports);
    }
    const acceptanceProjectionAuthority: WorkroomAcceptanceProjectionAuthorityPort = Object.freeze({
      async authorize(
        candidate: Parameters<WorkroomAcceptanceProjectionAuthorityPort['authorize']>[0],
      ) {
        if (!resources.has(workroomAcceptanceProjectionSourceAuthorityToken)) return false;
        const bindingDigest = workroomAcceptanceProjectionSourceBindingDigest(candidate);
        const trusted = await resources.use(workroomAcceptanceProjectionSourceAuthorityToken).resolve({
          projectId: candidate.projection.projectId,
          projectionDigest: candidate.projection.digest,
          source: Object.freeze({ ...candidate.source, bindingDigest }),
        }, signal);
        return Boolean(trusted && trusted.verification === 'verified'
          && trusted.kind === candidate.source.kind && trusted.ref === candidate.source.ref
          && trusted.digest === candidate.source.digest && trusted.issuer === candidate.source.issuer
          && trusted.issuerDigest === candidate.source.issuerDigest
          && trusted.revision === candidate.source.revision
          && trusted.bindingDigest === bindingDigest);
      },
    });
    const acceptanceProjections = new FileWorkroomAcceptanceProjectionRepository({
      directory: join(workroomStateRoot, 'workroom-acceptance-projections'),
      payloads: resources.use(workroomAcceptanceProjectionPayloadToken),
      authority: acceptanceProjectionAuthority,
      signal,
    });
    const acceptanceProjects = Object.freeze({
      listProjectIds: async () => Object.freeze(Object.entries((await workroomCatalog.read()).definitions)
        .filter(([, definition]) => definition.enabled !== false)
        .map(([projectId]) => projectId)),
    });
    const acceptanceProfileProjector = new WorkroomAcceptanceProfileProjectionRuntime({
      source: acceptanceProfileSource,
      repository: acceptanceProjections,
      projects: acceptanceProjects,
      signal,
      intervalMs: 1_000,
      onError: error => logger.error(formatCompact({
        op: 'workroom_acceptance_profile_projector',
        error: error instanceof Error ? error.message : String(error),
      })),
    });
    lifecycle.add(() => acceptanceProfileProjector.dispose());
    handoff.add({
      activateNext: operationSignal => {
        operationSignal.throwIfAborted();
        acceptanceProfileProjector.start();
      },
    });
    const resolveCurrentAssignmentIssuance = async (input: Readonly<{
      projectId: string;
      runId: string;
      taskKey: string;
    }>) => {
      const [local, remote] = await Promise.all([
        workroomKernel.listLocalAssignmentIssuances(),
        workroomKernel.listRemoteAssignmentIssuances(),
      ]);
      const matching = [
        ...local.map(issuance => ({ kind: 'local' as const, issuance })),
        ...remote.map(issuance => ({ kind: 'remote' as const, issuance })),
      ].filter(({ issuance }) => {
        const envelope = issuance.envelope;
        return envelope.projectId === input.projectId && envelope.runId === input.runId
          && envelope.taskKey === input.taskKey
          && issuance.state.tasks[input.taskKey]?.currentAssignmentId === envelope.assignmentId;
      });
      return matching.length === 1 ? matching[0] : undefined;
    };
    const artifactRiskProducer = new WorkroomAuthenticatedArtifactRiskProducer({
      generation,
      reports: workroomReports,
      effectJournal: effectComposition.journal,
    });
    const riskHeaderAuthority: WorkroomRiskHeaderProducerAuthorityPort = Object.freeze({
      async authorize(
        publication: Parameters<WorkroomRiskHeaderProducerAuthorityPort['authorize']>[0],
      ) {
        if (publication.producer.generation !== generation) return false;
        if (publication.producer.kind === 'workspace-artifact') {
          return await artifactRiskProducer.authorize(publication);
        }
        if (publication.producer.kind === 'effect-ledger') {
          if (publication.producer.issuer !== 'workroom-effect-ledger') return false;
          const events = await effectComposition.journal.read(publication.header.scope.projectId);
          return events.some(event => {
            if (event.type !== 'effect.intent_recorded') return false;
            const intent = event.payload.intent;
            return Boolean(intent && typeof intent === 'object'
              && 'id' in intent && intent.id === publication.producer.factRef
              && 'digest' in intent && intent.digest === publication.producer.factDigest
              && event.digest === publication.producer.issuerDigest);
          });
        }
        if (publication.producer.issuer !== 'workroom-kernel') return false;
        const current = await resolveCurrentAssignmentIssuance(publication.header.scope);
        if (!current) return false;
        const fact = publication.producer.kind === 'kernel-plan'
          ? current.issuance.envelope.plan
          : current.issuance.envelope.capabilitySnapshot;
        return fact.ref === publication.producer.factRef
          && fact.digest === publication.producer.factDigest
          && current.issuance.envelope.digest === publication.producer.issuerDigest;
      },
    });
    const riskHeaders = new FileWorkroomKernelRiskHeaderRepository({
      directory: join(workroomStateRoot, 'workroom-risk-headers'),
      generation,
      authority: riskHeaderAuthority,
    });
    const artifactRiskHeaders = new WorkroomArtifactRiskHeaderResolver({
      repository: riskHeaders,
      producer: artifactRiskProducer,
    });
    const typedChecks = resources.has(workroomTypedAcceptanceCheckRegistryToken)
      ? resources.use(workroomTypedAcceptanceCheckRegistryToken)
      : new ImmutableWorkroomTypedCheckRegistry([]);
    const contextRoutes: WorkroomEphemeralContextRoutePort = Object.freeze({
      async resolve(eligibility: Parameters<WorkroomEphemeralContextRoutePort['resolve']>[0]) {
        const current = await resolveCurrentAssignmentIssuance(eligibility);
        if (!current) return undefined;
        return Object.freeze({
          kind: current.kind,
          ref: `kernel-assignment:${current.issuance.envelope.assignmentId}`,
          digest: current.issuance.envelope.digest,
        });
      },
    });
    const localContextCapability: WorkroomEphemeralContextReleaseCapabilityPort = Object.freeze({
      async release(
        input: Parameters<WorkroomEphemeralContextReleaseCapabilityPort['release']>[0],
        operationSignal: AbortSignal,
      ) {
        operationSignal.throwIfAborted();
        const receipt = ephemeralAssignmentContext.releaseTask(input.request.eligibility);
        return Object.freeze({
          status: 'released' as const,
          receiptRef: `${receipt.receiptRef}:route:${input.route.digest}`,
          authenticatedBy: `local-assignment-context-generation:${generation}`,
        });
      },
      async reconcile(
        input: Parameters<WorkroomEphemeralContextReleaseCapabilityPort['reconcile']>[0],
        operationSignal: AbortSignal,
      ) {
        operationSignal.throwIfAborted();
        const receipt = ephemeralAssignmentContext.releaseTask(input.request.eligibility);
        return Object.freeze({
          status: 'released' as const,
          receiptRef: `${receipt.receiptRef}:route:${input.route.digest}`,
          authenticatedBy: `local-assignment-context-generation:${generation}`,
        });
      },
    });
    const contextIdentity = (kind: 'local' | 'remote') => Object.freeze({
      kind,
      id: `${kind}-assignment-context-generation:${generation}`,
      digest: `sha256:${createHash('sha256').update(JSON.stringify({
        version: 1, kind, generation,
      })).digest('hex')}`,
    });
    const contextConsumer = new FileWorkroomEphemeralContextDisposer({
      directory: join(workroomStateRoot, 'workroom-ephemeral-context-release'),
      signal,
      providers: Object.freeze([
        createRoutedWorkroomEphemeralContextProvider({
          identity: contextIdentity('local'), routes: contextRoutes, capability: localContextCapability,
        }),
        createRoutedWorkroomEphemeralContextProvider({
          identity: contextIdentity('remote'),
          routes: contextRoutes,
          capability: createGenerationRemoteContextReleaseCapability(() =>
            resources.has(workroomRemoteContextReleaseProviderToken)
              ? resources.use(workroomRemoteContextReleaseProviderToken)
              : undefined),
        }),
      ]),
    });
    const acceptanceComposition = installWorkroomAcceptanceResources({
      projectRoot: options.projectRoot,
      generation,
      signal,
      resources,
      profiles: projectProfiles,
      catalog: workroomCatalog,
      reports: workroomReports,
      projections: acceptanceProjections,
      riskHeaders: artifactRiskHeaders,
      checks: typedChecks.list(),
      contextConsumer,
      effectJournal: effectComposition.journal,
      runState: Object.freeze({
        read: (projectId: string, runId: string) => workroomKernel.read(projectId, runId),
      }),
      projects: acceptanceProjects,
      projectorIntervalMs: 1_000,
      onProjectorError: error => logger.error(formatCompact({
        op: 'workroom_effect_authorization_projector',
        error: error instanceof Error ? error.message : String(error),
      })),
    });
    effectSponsorConsoleControl.current = Object.freeze({
      decide: (
        command: Parameters<AgentHostEffectSponsorControlPort['decide']>[0],
        authenticatedPrincipal: Parameters<AgentHostEffectSponsorControlPort['decide']>[1],
      ) => acceptanceComposition.effectSponsorControl.decide({
        ...structuredClone(command),
        principalId: authenticatedPrincipal.principalId,
      }),
    });
    lifecycle.add(() => acceptanceComposition.projectorRuntime.dispose());
    handoff.add({
      activateNext: operationSignal => {
        operationSignal.throwIfAborted();
        acceptanceComposition.projectorRuntime.start();
      },
    });
    const acceptedSourceRuntime = new WorkroomAcceptedSourceRuntime({
      journal: workroomJournal,
      repository: new FileProjectMemoryApplicationRepository(
        join(workroomStateRoot, 'workroom-project-memory'),
      ),
      reports: workroomReports,
      schemas: Object.freeze({
        resolve: async (input: Parameters<WorkroomProjectMemorySchemaAuthorityPort['resolve']>[0]) => {
          if (!resources.has(workroomProjectMemorySchemaAuthorityToken)) {
            throw new Error('Generation/Profile Project Memory Schema authority is unavailable');
          }
          return await resources.use(workroomProjectMemorySchemaAuthorityToken).resolve(input);
        },
      }),
      release: Object.freeze({
        release: async (input: Parameters<WorkroomExecutionContextReleasePort['release']>[0]) => {
          if (!resources.has(workroomExecutionContextReleaseToken)) {
            throw new Error('Execution Context Release authority is unavailable');
          }
          return await resources.use(workroomExecutionContextReleaseToken).release(input);
        },
      }),
      releases: new FileWorkroomContextReleaseJournal(
        join(workroomStateRoot, 'workroom-context-release'),
      ),
      intervalMs: 1_000,
      onError: error => logger.error(formatCompact({
        op: 'workroom_accepted_source',
        error: error instanceof Error ? error.message : String(error),
      })),
    });
    resources.provide(workroomAcceptedSourceRuntimeToken, acceptedSourceRuntime);
    if (!resources.has(workroomAcceptedSourceRecallToken)) {
      resources.provide(workroomAcceptedSourceRecallToken, acceptedSourceRuntime);
    }
    lifecycle.add(() => acceptedSourceRuntime.dispose());
    handoff.add({
      activateNext: operationSignal => {
        operationSignal.throwIfAborted();
        acceptedSourceRuntime.start();
      },
    });
    if (!resources.has(portfolioJournalRepositoryToken)) {
      resources.provide(
        portfolioJournalRepositoryToken,
        new FilePortfolioJournalRepository(join(workroomStateRoot, 'portfolio-journal')),
      );
    }
    if (!resources.has(portfolioControlOutboxRepositoryToken)) {
      resources.provide(portfolioControlOutboxRepositoryToken, portfolioControlOutbox);
    }
    if (!resources.has(portfolioSponsorCommandToken)) {
      const portfolioSponsor = new WorkroomPortfolioSponsorRuntime({
        generation,
        repository: resources.use(portfolioJournalRepositoryToken),
        authority: createCatalogPortfolioSponsorCommandAuthority(workroomCatalog),
      });
      resources.provide(portfolioSponsorCommandToken, portfolioSponsor);
    }
    const portfolioSponsor = resources.use(portfolioSponsorCommandToken);
    const projectionReader = createGovernedPortfolioSponsorProjectionReader({
      source: portfolioSponsor,
      authority: createCatalogGovernedWorkroomProjectionAuthority({
        catalog: workroomCatalog,
        governance: Object.freeze({
          readProject: async (projectId: string) =>
            await dataGovernanceRuntimeRef.current?.options.repository.readProject(projectId),
        }),
      }),
    });
    portfolioSponsorConsoleControl.current = Object.freeze({
      read: projectionReader.read,
      execute: portfolioSponsor.execute.bind(portfolioSponsor),
    });
    const portfolioSponsorProjectionSource: Readonly<{
      listPortfolioIds(): Promise<readonly string[]>;
      read(portfolioId: string): Promise<PortfolioSponsorProjection>;
    }> = Object.freeze({
      listPortfolioIds: () => resources.use(portfolioJournalRepositoryToken).listPortfolioIds(),
      read: (portfolioId: string) => portfolioSponsor.read(portfolioId),
    });
    const portfolioCapacity = resources.has(portfolioCapacityRuntimeToken)
      ? resources.use(portfolioCapacityRuntimeToken)
      : new GenerationOwnedPortfolioCapacityRuntime({
        generation,
        repository: resources.use(portfolioJournalRepositoryToken),
        policyAuthority: Object.freeze({
          resolve: async (portfolioId: string) => resources.has(portfolioPolicyAuthorityToken)
            ? await resources.use(portfolioPolicyAuthorityToken).resolve(portfolioId)
            : undefined,
        }),
        bundleAuthority: Object.freeze({
          validate: async (input: Parameters<PortfolioAtomicBundleAuthorityPort['validate']>[0]) => resources.has(portfolioAtomicBundleAuthorityToken)
            ? await resources.use(portfolioAtomicBundleAuthorityToken).validate(input)
            : undefined,
        }),
        kernelAuthority: new WorkroomPortfolioAssignmentFailureAuthority({
          generation,
          portfolioJournal: resources.use(portfolioJournalRepositoryToken),
          workroomJournal,
          fallback: Object.freeze({
            authorize: async (input: Parameters<PortfolioKernelCommandAuthorityPort['authorize']>[0]) => resources.has(portfolioKernelCommandAuthorityToken)
              ? await resources.use(portfolioKernelCommandAuthorityToken).authorize(input)
              : undefined,
          }),
        }),
        usageAuthority: Object.freeze({
          authenticate: async (input: Parameters<PortfolioUsageGatewayAuthorityPort['authenticate']>[0]) => resources.has(portfolioUsageGatewayAuthorityToken)
            ? await resources.use(portfolioUsageGatewayAuthorityToken).authenticate(input)
            : undefined,
        }),
        clockAuthority: Object.freeze({
          read: async (input: Parameters<PortfolioClockAuthorityPort['read']>[0]) => resources.has(portfolioClockAuthorityToken)
            ? await resources.use(portfolioClockAuthorityToken).read(input)
            : undefined,
        }),
      });
    if (!resources.has(portfolioCapacityRuntimeToken)) {
      resources.provide(portfolioCapacityRuntimeToken, portfolioCapacity);
    }
    if (!resources.has(workroomSchedulerCapacityRequestToken)) {
      resources.provide(workroomSchedulerCapacityRequestToken, portfolioCapacity);
    }
    const schedulerDispatch = installWorkroomSchedulerPortfolioDispatchResources({
      generation,
      signal,
      resources,
      catalog: workroomCatalog,
      profiles: projectProfiles,
      journal: workroomJournal,
    });
    resources.provide(workroomAssignmentAuthorityGrantRepositoryToken, assignmentAuthorityGrants);
    resources.provide(
      workroomAssignmentAuthorityGrantToken,
      createDurableWorkroomAssignmentAuthorityGrantProvider({
        repository: assignmentAuthorityGrants,
        generation,
      }),
    );
    resources.provide(
      workroomAssignmentGrantClaimPreviewToken,
      new JournalWorkroomAssignmentGrantClaimPreview({
        generation,
        journal: workroomJournal,
        profiles: projectProfiles,
        catalog: workroomCatalog,
      }),
    );
    if (options.snapshots && !resources.has(workroomLocalAssignmentAuthorityToken)) {
      resources.provide(workroomLocalAssignmentAuthorityToken, Object.freeze({
        resolveLocal: async (
          input: Parameters<GenerationOwnedWorkroomAssignmentAuthorityProvider['resolveLocal']>[0],
        ) => {
          const lease = options.snapshots!.acquire();
          try {
            if (lease.value.generation !== generation) {
              throw new Error('Local Assignment authority generation is no longer current');
            }
            return await new GenerationOwnedWorkroomAssignmentAuthorityProvider({
              generation: createWorkroomGenerationAuthoritySnapshotFromRuntime(
                lease.value,
                listGenerationBindings(),
              ),
              profiles: projectProfiles,
              catalog: workroomCatalog,
              grants: resources.use(workroomAssignmentAuthorityGrantToken),
              endpoints: Object.freeze({ resolve: async () => undefined }),
            }).resolveLocal(input);
          } finally {
            lease.release();
          }
        },
      }));
    }
    if (!resources.has(workroomHumanIngressPlanningToken)) {
      resources.provide(workroomHumanIngressPlanningToken, createGenerationOwnedDynamicPlanningProvider({
        generation: createWorkroomDynamicPlanningGenerationSnapshot(generation),
        profiles: resources.use(workroomProjectProfileRegistryToken),
        catalog: workroomCatalog,
        resolvePolicy: () => resources.has(workroomDynamicPlanningPolicyToken)
          ? resources.use(workroomDynamicPlanningPolicyToken)
          : undefined,
        resolveDisclosure: () => resources.has(workroomPlanningDisclosureToken)
          ? resources.use(workroomPlanningDisclosureToken)
          : undefined,
        signal,
        model: Object.freeze({
          async generate(modelInput: WorkroomStructuredDagModelInput, operationSignal: AbortSignal) {
            operationSignal.throwIfAborted();
            if (modelInput.binding.generation !== generation) {
              throw new Error('Dynamic planning model binding escaped its Root generation');
            }
            const binding = service.getBindingRegistry()
              .getBinding(modelInput.binding.agentDefinitionId);
            if (!binding) throw new WorkroomPlanningClarificationError('planning_unavailable');
            const result = await service.runAgent(JSON.stringify(modelInput.prompt), {
              provider: binding.providerAlias,
              model: binding.model,
              systemPrompt: WORKROOM_DYNAMIC_PLANNING_SYSTEM_PROMPT,
              tools: [],
              useBuiltinTools: false,
              collectExternalTools: false,
              maxIterations: 1,
              signal: operationSignal,
            });
            operationSignal.throwIfAborted();
            try {
              return JSON.parse(result.content) as unknown;
            } catch (error) {
              throw new Error('Dynamic planning model did not return one strict JSON DAG candidate', {
                cause: error,
              });
            }
          },
        }),
      }));
    }
    const projectionRepository = new FileWorkroomProjectionRepository(
      join(workroomStateRoot, 'workroom-projections'),
    );
    const projectionReplyResolver = new WorkroomProjectionReplyResolver({
      repository: projectionRepository,
      runState: Object.freeze({
        read: async (projectId: string, runId: string) =>
          await workroomKernel.read(projectId, runId),
      }),
    });
    const projectionRuntime = new WorkroomProjectionRuntime({
      catalog: workroomCatalog,
      journal: workroomJournal,
      repository: projectionRepository,
      outbound: createWorkroomProjectionMessageGatewayPort(
        resources.use(messageGatewayToken),
        rootPluginId(),
      ),
      workerId: `workroom-projection:${randomUUID()}`,
      leaseMs: 30_000,
      maxRunsPerTick: 64,
      maxDeliveriesPerTick: 32,
      governance: governedOutbound.projection,
      resolveSponsorConversation: (_projectId, definition) =>
        resolveCatalogSponsorProjectionConversation(definition, options.im.listEndpoints()),
      ...(dataLifecycle ? { lifecycleOverdue: dataLifecycle.overdue } : {}),
      ...(portfolioSponsorProjectionSource
        ? { portfolioSponsor: portfolioSponsorProjectionSource }
        : {}),
    });
    const projectionScheduler = new WorkroomProjectionScheduler({
      runtime: projectionRuntime,
      intervalMs: 1_000,
      onError: error => logger.error(formatCompact({
        op: 'workroom_projection_tick',
        error: error instanceof Error ? error.message : String(error),
      })),
    });
    lifecycle.add(() => projectionScheduler.dispose());
    handoff.add({
      activateNext: signal => {
        signal.throwIfAborted();
        projectionScheduler.start();
      },
    });
    if (options.snapshots && resources.has(workroomLocalAssignmentAuthorityToken)) {
      const localTurn = createAgentCoreWorkroomLocalTurnPort({
        host: asPrivate(zhinAgent),
        core: composedRuntime.agentCore,
        generation,
        loopHooks: service.loopHooks,
        resolveBinding: agentDefinitionId => agentDefinitionId
          ? service.getBindingRegistry().getBinding(agentDefinitionId) ?? undefined
          : undefined,
      });
      const localModel = new DurableReportLocalModelExecutionPort({
        turn: localTurn,
        reports: workroomReports,
        payloads: Object.freeze({
          write: async (input: WorkroomEvidencePayloadWriteInput, signal: AbortSignal) => {
            if (!resources.has(workroomEvidencePayloadWriterToken)) {
              throw new Error('Governed Workroom Evidence Payload Writer is unavailable');
            }
            return await resources.use(workroomEvidencePayloadWriterToken).write(input, signal);
          },
        }),
        readPrompt: async request => {
          const state = await workroomKernel.read(
            request.envelope.projectId,
            request.envelope.runId,
          );
          const task = state.tasks[request.envelope.taskKey];
          if (!task || task.revision !== request.envelope.taskRevision) {
            throw new Error('Local Assignment prompt targets a stale Task revision');
          }
          return [
            `Execute Workroom Task: ${task.title}`,
            `Task identity: ${task.key}@${task.revision}`,
            `Workspace mount: ${request.envelope.workspace.mountRef}`,
            `Acceptance Contract: ${task.acceptanceContract?.id ?? 'missing'}`,
            'Return only structured Task Report JSON with claims[] and evidence[].',
          ].join('\n');
        },
      });
      const capabilityProjection = Object.freeze({
        resolve: async (envelope: Parameters<LocalAssignmentExecutor['execute']>[0]) => {
          const lease = options.snapshots!.acquire();
          let releaseOwned = true;
          try {
            if (lease.value.generation !== generation) {
              throw new Error('Local Assignment capability generation is no longer current');
            }
            const issuance = (await workroomKernel.listLocalAssignmentIssuances())
              .find(candidate => candidate.envelope.assignmentId === envelope.assignmentId);
            if (!issuance || issuance.envelope.digest !== envelope.digest) {
              throw new Error('Local Assignment capability projection lacks exact issuance');
            }
            const state = await workroomKernel.read(envelope.projectId, envelope.runId);
            const task = state.tasks[envelope.taskKey];
            if (!task?.acceptanceContract || task.revision !== envelope.taskRevision) {
              throw new Error('Local Assignment capability projection targets a stale Task');
            }
            const authority = await resources.use(workroomLocalAssignmentAuthorityToken).resolveLocal({
              projectId: envelope.projectId,
              runId: envelope.runId,
              task: Object.freeze({
                key: task.key,
                revision: task.revision,
                acceptanceContract: task.acceptanceContract,
              }),
              assignment: Object.freeze({
                id: envelope.assignmentId,
                revision: envelope.assignmentRevision,
                attempt: envelope.attempt,
                fence: envelope.fence,
              }),
              requestedAgentDefinitionId: issuance.agentDefinitionId,
              factAnchor: envelope.factAnchor,
            });
            const canonicalEnvelope = createAssignmentExecutionEnvelope({
              projectId: envelope.projectId,
              runId: envelope.runId,
              taskKey: envelope.taskKey,
              taskRevision: envelope.taskRevision,
              assignmentId: envelope.assignmentId,
              assignmentRevision: envelope.assignmentRevision,
              attempt: envelope.attempt,
              fence: envelope.fence,
              principalId: authority.principalId,
              role: authority.role,
              agentDefinition: authority.agentDefinition,
              plan: authority.plan,
              contextPolicy: authority.contextPolicy,
              factAnchor: envelope.factAnchor,
              capabilitySnapshot: authority.capabilitySnapshot,
              policySnapshot: authority.policySnapshot,
              workspace: authority.workspace,
            });
            if (canonicalEnvelope.digest !== envelope.digest) {
              throw new Error('Local Assignment current generation authority drifted from Envelope');
            }
            const capabilities = await ingress.read(
              lease.value,
              rootPluginId(),
              () => lease.active,
            );
            const capabilitySnapshot = createWorkroomRoleCapabilitySnapshot({
              envelope,
              ...authority.capabilitySupplies,
            });
            const projection = Object.freeze({
              agentDefinitionId: issuance.agentDefinitionId,
              capabilities,
              capabilitySnapshot,
              realization: bindWorkroomCapabilityRealization(
                capabilities,
                envelope,
                capabilitySnapshot,
              ),
              sessionSnapshot: Object.freeze({ loadedTools: {}, loadedSkills: [] }),
              config: asPrivate(zhinAgent).config,
              persistSnapshot: async () => undefined,
              release: () => {
                if (!releaseOwned) return;
                releaseOwned = false;
                lease.release();
              },
            });
            return projection;
          } catch (error) {
            if (releaseOwned) {
              releaseOwned = false;
              lease.release();
            }
            throw error;
          }
        },
      });
      const localAssignments = new WorkroomLocalAssignmentRuntime({
        kernel: workroomKernel,
        executor: new LocalAssignmentExecutor(localModel, capabilityProjection),
        intervalMs: 1_000,
        onError: error => logger.error(formatCompact({
          op: 'workroom_local_assignment',
          error: error instanceof Error ? error.message : String(error),
        })),
      });
      resources.provide(workroomLocalAssignmentRuntimeToken, localAssignments);
      const localRoute = new PinnedProfileCatalogLocalAssignmentRoute({ profiles: projectProfiles });
      lifecycle.add(schedulerDispatch.routes.register({
        providerId: `local-agent-bindings:generation:${generation}`,
        generation,
        resolve: async input => {
          if (!resources.has(workroomEvidencePayloadWriterToken)
            || !resources.has(workroomTaskReportPayloadToken)) return null;
          const route = await localRoute.resolve(input);
          if (!route || route.kind !== 'local') return null;
          return service.getBindingRegistry().getBinding(route.agentDefinitionId)
            ? route
            : null;
        },
      }));
      lifecycle.add(() => localAssignments.dispose());
      handoff.add({
        activateNext: signal => {
          signal.throwIfAborted();
          localAssignments.start();
        },
      });
    }
    const workroomScheduler = new WorkroomSchedulerRuntime({
      journal: workroomJournal,
      commands: createWorkroomSchedulerKernelCommandPort(workroomKernel),
      resolveSupply: () => resources.has(workroomSchedulerDispatchSupplyToken)
        ? resources.use(workroomSchedulerDispatchSupplyToken)
        : undefined,
      unavailableControl: Object.freeze({
        block: async decision => {
          const state = await workroomKernel.read(decision.projectId, decision.runId);
          const task = state.tasks[decision.taskKey];
          const blockerId = `scheduler-supply:${decision.decisionId}`;
          if (!task || task.revision !== decision.taskRevision || task.status !== 'ready') return;
          if (task.blockers.some(blocker => blocker.id === blockerId)) return;
          await workroomKernel.execute(decision.projectId, decision.runId, {
            type: 'block_task',
            taskKey: decision.taskKey,
            blockerId,
            kind: 'capability',
            owner: 'workroom-scheduler-assignment-supply',
            reason: 'No exact generation-owned Assignment route or trusted Portfolio Capacity authority is available',
            deadline: state.now + 300_000,
          });
        },
        recover: async decision => {
          const state = await workroomKernel.read(decision.projectId, decision.runId);
          const task = state.tasks[decision.taskKey];
          const blockerId = `scheduler-supply:${decision.decisionId}`;
          if (!task || task.revision !== decision.taskRevision) return;
          if (!task.blockers.some(blocker => blocker.id === blockerId
            && blocker.owner === 'workroom-scheduler-assignment-supply')) return;
          await workroomKernel.execute(decision.projectId, decision.runId, {
            type: 'resolve_blocker',
            taskKey: decision.taskKey,
            blockerId,
          });
        },
      }),
      intervalMs: 1_000,
      onError: error => {
        // Missing exact route/Portfolio authority is an expected fail-closed
        // state; no Assignment is claimed and a later provider can recover
        // from the same Journal.
        if (error instanceof WorkroomSchedulerSupplyUnavailableError) return;
        logger.error(formatCompact({
          op: 'workroom_scheduler_tick',
          error: error instanceof Error ? error.message : String(error),
        }));
      },
    });
    resources.provide(workroomSchedulerRuntimeToken, workroomScheduler);
    lifecycle.add(() => workroomScheduler.dispose());
    handoff.add({
      activateNext: signal => {
        signal.throwIfAborted();
        workroomScheduler.start();
      },
    });
    const workroomPreemption = new WorkroomPreemptionRuntime({
      journal: workroomJournal,
      delivery: new WorkroomAssignmentCheckpointDelivery({
        kernel: workroomKernel,
        resolveProvider: () => resources.has(workroomCheckpointDeliveryProviderToken)
          ? resources.use(workroomCheckpointDeliveryProviderToken)
          : undefined,
      }),
      unavailableControl: Object.freeze({
        block: async (preemption: WorkroomPreemptionState, reason: string) => {
          const state = await workroomKernel.read(preemption.projectId, preemption.runId);
          const task = state.tasks[preemption.reservedTaskKey];
          const blockerId = `checkpoint-delivery:${preemption.decisionId}`;
          if (!task || task.revision !== preemption.reservedTaskRevision
            || !['ready', 'blocked'].includes(task.status)
            || task.blockers.some(blocker => blocker.id === blockerId)) return;
          await workroomKernel.execute(preemption.projectId, preemption.runId, {
            type: 'block_task',
            taskKey: preemption.reservedTaskKey,
            blockerId,
            kind: 'capability',
            owner: 'workroom-checkpoint-delivery',
            reason: `Typed Assignment checkpoint transport unavailable: ${reason}`,
            deadline: preemption.deadline,
          });
        },
        recover: async (preemption: WorkroomPreemptionState) => {
          const state = await workroomKernel.read(preemption.projectId, preemption.runId);
          const task = state.tasks[preemption.reservedTaskKey];
          const blockerId = `checkpoint-delivery:${preemption.decisionId}`;
          if (!task || task.revision !== preemption.reservedTaskRevision
            || !task.blockers.some(blocker => blocker.id === blockerId
              && blocker.owner === 'workroom-checkpoint-delivery')) return;
          await workroomKernel.execute(preemption.projectId, preemption.runId, {
            type: 'resolve_blocker',
            taskKey: preemption.reservedTaskKey,
            blockerId,
          });
        },
      }),
      intervalMs: 1_000,
      onError: error => logger.error(formatCompact({
        op: 'workroom_preemption_tick',
        error: error instanceof Error ? error.message : String(error),
      })),
    });
    resources.provide(workroomPreemptionRuntimeToken, workroomPreemption);
    if (!resources.has(workroomPortfolioCheckpointAckAdapterToken)) {
      resources.provide(
        workroomPortfolioCheckpointAckAdapterToken,
        new WorkroomPortfolioCheckpointAckAdapter(
          new JournalWorkroomPreemptionCheckpointAckReader(workroomJournal),
        ),
      );
    }
    const portfolioIssuances = new KernelPortfolioGrantAssignmentIssuance(workroomKernel);
    const portfolioGrantAuthority = new PortfolioGrantAssignmentAuthority({
      portfolioJournal: resources.use(portfolioJournalRepositoryToken),
      workroomJournal,
      catalog: workroomCatalog,
      schedulerRoute: schedulerDispatch.routes,
      issuances: portfolioIssuances,
    });
    const portfolioGrantAssignments = new WorkroomPortfolioGrantAssignmentSaga({
      generation,
      capacity: portfolioCapacity,
      bindings: portfolioGrantAuthority,
      issuances: portfolioIssuances,
    });
    const portfolioControlWorker = installWorkroomPortfolioControlWorker({
      generation,
      signal,
      resources,
      journal: resources.use(portfolioJournalRepositoryToken),
      outbox: resources.use(portfolioControlOutboxRepositoryToken),
      capacity: portfolioCapacity,
      route: portfolioGrantAuthority.routeAuthority,
      grantAssignments: portfolioGrantAssignments,
      checkpointAcks: resources.use(workroomPortfolioCheckpointAckAdapterToken),
      intervalMs: 1_000,
      autoStart: false,
      onError: error => logger.error(formatCompact({
        op: 'portfolio_control_tick',
        error: error instanceof Error ? error.message : String(error),
      })),
    });
    lifecycle.add(() => portfolioControlWorker.dispose());
    handoff.add({
      activateNext: operationSignal => {
        operationSignal.throwIfAborted();
        portfolioControlWorker.start();
      },
    });
    lifecycle.add(() => workroomPreemption.dispose());
    handoff.add({
      activateNext: signal => {
        signal.throwIfAborted();
        workroomPreemption.start();
      },
    });
    resources.provide(
      workroomRemoteCallbackRuntimeToken,
      createWorkroomRemoteCallbackRuntime({
        kernel: workroomKernel,
        stateRoot: workroomStateRoot,
        governance: governedOutbound.remote,
      }),
    );
    const interactionSpaceBindings = new FileInteractionSpaceBindingRepository(
      join(workroomStateRoot, 'interaction-space-bindings'),
    );
    const humanIngressProposals = new FileHumanIngressProposalRepository(
      join(workroomStateRoot, 'workroom-human-ingress'),
    );
    const humanIngressApplications = new FileHumanIngressApplicationRepository(
      join(workroomStateRoot, 'workroom-human-ingress-application'),
    );
    const interactionSpaceRouter = new InteractionSpaceRouter(interactionSpaceBindings);
    const productionHumanIngressPort = new ProductionHumanIngressOrchestratorPort({
      sources: new ConversationEventHumanIngressSourceReader(() => options.im.conversationEvents),
      kernel: workroomKernel,
      resolveProject: async projectId => {
        const snapshot = await workroomCatalog.read();
        const definition = snapshot.definitions[projectId];
        if (!definition || definition.enabled === false || !definition.conversation) return null;
        const agent = definition.conversation.agent;
        if (!definition.members.some(member => member.agent === agent && member.role === 'orchestrator')) {
          throw new Error(`Workroom Catalog ${projectId} has no valid Orchestrator binding`);
        }
        const projectDigest = workroomProjectionCatalogBindingDigest(definition);
        return Object.freeze({
          orchestratorAgentDefinitionId: agent,
          projectRevision: snapshot.revision,
          projectDigest,
          orchestratorAuthorityDigest: `sha256:${createHash('sha256').update(JSON.stringify({
            projectId,
            projectRevision: snapshot.revision,
            projectDigest,
            agentDefinitionId: agent,
            role: 'orchestrator',
          })).digest('hex')}`,
        });
      },
      authorizeProjectSource: async ({ projectId, proposal, source }) => {
        if (proposal.space === 'sponsor_room') {
          const snapshot = await workroomCatalog.read();
          const definition = snapshot.definitions[projectId];
          const configured = definition?.sponsorConversation;
          if (!definition || definition.enabled === false || !configured) return false;
          const projectionState = await projectionRepository.read();
          const binding = projectionState.bindings[
            workroomProjectionBindingKey(projectId, 'sponsor_room')
          ];
          if (!binding) return false;
          const replyEntry = proposal.projectionReply
            ? projectionState.messageIndex[proposal.projectionReply.messageKey]
            : undefined;
          if (proposal.projectionReply && (!replyEntry
            || replyEntry.projectionId !== proposal.projectionReply.projectionId
            || replyEntry.target.projectId !== proposal.projectionReply.projectId
            || replyEntry.bindingRevision !== proposal.projectionReply.bindingRevision
            || digestInstallerValue(replyEntry.target) !== proposal.projectionReply.targetDigest)) {
            return false;
          }
          return proposal.projectId === projectId
            && proposal.bindingDigest === catalogSpaceSourceDigest(
              projectId, 'sponsor_room', configured,
            )
            && proposal.bindingRevision === binding.bindingRevision
            && binding.catalogBindingDigest === workroomProjectionCatalogBindingDigest(definition)
            && conversationRefKey(source.event.conversation) === conversationRefKey(binding.conversation);
        }
        const decision = await interactionSpaceRouter.resolve({
          conversation: source.event.conversation,
          conversationSequence: source.sequence,
        });
        return decision.status === 'resolved'
          && decision.source === 'binding'
          && decision.projectId === projectId
          && decision.space === proposal.space
          && decision.bindingRevision === proposal.bindingRevision
          && decision.bindingDigest === proposal.bindingDigest;
      },
      planning: resources.has(workroomHumanIngressPlanningToken)
        ? createGenerationHumanIngressPlanningPort(() =>
            resources.has(workroomHumanIngressPlanningToken)
              ? resources.use(workroomHumanIngressPlanningToken)
              : undefined)
        : undefined,
      controls: createPortfolioSponsorHumanIngressControlPort({
        resolve: () => resources.has(portfolioSponsorCommandToken)
          ? resources.use(portfolioSponsorCommandToken)
          : undefined,
        generationSignal: signal,
        fallback: createWorkroomDataLifecycleHumanIngressControlPort({
          resolve: () => dataLifecycleConsoleControl.current,
          generationSignal: signal,
          fallback: createPlanGateHumanIngressControlPort(workroomKernel),
        }),
      }),
      afterPlanAdmission: input => profileRunPinWriter.afterPlanAdmission(input, signal),
    });
    const humanIngressApplication = new HumanIngressApplicationService({
      proposals: humanIngressProposals,
      applications: humanIngressApplications,
      port: options.workroomHumanIngressPort ?? productionHumanIngressPort,
    });
    let humanIngressRetryTimer: ReturnType<typeof setTimeout> | undefined;
    let humanIngressRetryAt: number | undefined;
    const scheduleHumanIngressRetry = (retryAt: number) => {
      if (humanIngressRetryAt !== undefined && humanIngressRetryAt <= retryAt) return;
      if (humanIngressRetryTimer) clearTimeout(humanIngressRetryTimer);
      humanIngressRetryAt = retryAt;
      humanIngressRetryTimer = setTimeout(() => {
        humanIngressRetryTimer = undefined;
        humanIngressRetryAt = undefined;
        void recoverHumanIngress().catch(error => {
          logger.error(formatCompact({
            op: 'workroom_human_ingress_recovery',
            error: error instanceof Error ? error.message : String(error),
          }));
          scheduleHumanIngressRetry(Date.now() + 5_000);
        });
      }, Math.max(0, retryAt - Date.now()));
      humanIngressRetryTimer.unref?.();
    };
    lifecycle.add(() => {
      if (humanIngressRetryTimer) clearTimeout(humanIngressRetryTimer);
      humanIngressRetryTimer = undefined;
      humanIngressRetryAt = undefined;
    });
    const drainHumanIngressProject = async (projectId: string) => {
      const results = await humanIngressApplication.drain(projectId);
      for (const result of results) {
        if (result.status === 'retry_scheduled') scheduleHumanIngressRetry(result.retryAt);
        if (result.status === 'waiting') scheduleHumanIngressRetry(result.wakeAt);
      }
      return results;
    };
    recoverHumanIngress = async () => {
      const catalog = await workroomCatalog.read();
      for (const projectId of Object.keys(catalog.definitions).sort()) {
        await drainHumanIngressProject(projectId);
      }
    };
    if (!persistencePendingActivate) await recoverHumanIngress();
    const workroomHumanIngress = new WorkroomHumanIngressPreRoute({
      bindings: interactionSpaceBindings,
      bindingRouter: interactionSpaceRouter,
      proposals: humanIngressProposals,
      application: Object.freeze({ drain: drainHumanIngressProject }),
      sourceEvents: () => options.im.conversationEvents,
      resolveIntent: resolveWorkroomHumanIntent,
      createTargetResolver: (message, intent, decision) =>
        decision.space === 'sponsor_room' && intent === 'control'
          ? createSponsorProjectionControlTargetResolver({
              projectionRepository,
              message,
              intent,
            })
          : createProjectionHumanIngressTargetResolver({
              resolver: projectionReplyResolver,
              ...(message.replyTo
                ? { replyTo: { conversation: message.conversation, id: message.replyTo.id } }
                : {}),
              intent,
            }),
      onWorkroomResolved: async (message, decision) => {
        const catalog = await workroomCatalog.read();
        const exact = createCatalogWorkroomProjectionBinding(
          catalog,
          decision.projectId,
          message.conversation,
          decision.bindingRevision,
        );
        for (let conflict = 0; conflict < 8; conflict += 1) {
          const current = await projectionRepository.read();
          try {
            await projectionRepository.bind(current.revision, exact);
            return;
          } catch (error) {
            if (!(error instanceof WorkroomProjectionRevisionConflictError)) throw error;
          }
        }
        throw new Error('Workroom Projection binding CAS retries exhausted');
      },
      principalOwner: String(rootPluginId()),
      resolveCatalogSpace: async message => {
        const adapter = capabilityLocalName(String(message.conversation.endpoint.id));
        const endpoint = adapterLiveEndpointId(message);
        const repository = adapter === 'github'
          ? stringMetadata(message.metadata, 'repo')
          : undefined;
        const kind = repository
          ? 'repository' as const
          : message.conversation.kind === 'group' || message.conversation.kind === 'channel'
            ? message.conversation.kind
            : null;
        if (!kind) return null;
        const catalogSnapshot = await workroomCatalog.read();
        const explicitProjectId = sponsorRoomProjectId(message.content);
        const projectionState = await projectionRepository.read();
        const replyEntry = message.replyTo
          ? projectionState.messageIndex[workroomProjectionMessageKey({
              conversation: message.conversation,
              id: message.replyTo.id,
            })]
          : undefined;
        const repliedProjectId = replyEntry?.target.projectId;
        if (explicitProjectId && repliedProjectId && explicitProjectId !== repliedProjectId) {
          return Object.freeze({ status: 'rejected' as const, reason: 'project_conflict' as const });
        }
        let identity: ReturnType<typeof resolveWorkroomBotIdentity>;
        try {
          identity = resolveWorkroomBotIdentity(catalogSnapshot.definitions, {
          adapter,
          endpoint,
          kind,
          id: repository ?? message.conversation.id,
          ...(explicitProjectId ?? repliedProjectId
            ? { projectId: explicitProjectId ?? repliedProjectId }
            : {}),
          });
        } catch (error) {
          if (error instanceof Error && /explicit Project/u.test(error.message)) {
            return Object.freeze({ status: 'rejected' as const, reason: 'project_required' as const });
          }
          throw error;
        }
        if (!identity) return null;
        const definition = catalogSnapshot.definitions[identity.projectId];
        const configured = identity.space === 'workroom'
          ? definition?.conversation
          : definition?.sponsorConversation;
        if (!definition || !configured) {
          throw new Error(`Workroom Catalog ${identity.projectId} has no collaboration space`);
        }
        const sponsorBinding = identity.space === 'sponsor_room'
          ? projectionState.bindings[workroomProjectionBindingKey(
              identity.projectId, 'sponsor_room',
            )]
          : undefined;
        if (identity.space === 'sponsor_room') {
          if (!sponsorBinding
            || sponsorBinding.catalogBindingDigest !== workroomProjectionCatalogBindingDigest(definition)
            || conversationRefKey(sponsorBinding.conversation) !== conversationRefKey(message.conversation)) {
            return Object.freeze({ status: 'rejected' as const, reason: 'binding_unavailable' as const });
          }
          if (replyEntry && replyEntry.bindingRevision !== sponsorBinding.bindingRevision) {
            return Object.freeze({ status: 'rejected' as const, reason: 'stale_binding' as const });
          }
        }
        const sourceRef = `workroom-catalog:${encodeURIComponent(identity.projectId)}:${identity.space}`;
        return createCatalogWorkroomSpace({
          projectId: identity.projectId,
          agentDefinitionId: identity.agent,
          space: identity.space,
          sourceRef,
          sourceDigest: catalogSpaceSourceDigest(identity.projectId, identity.space, configured),
          ...(identity.space === 'sponsor_room'
            ? { bindingRevision: sponsorBinding!.bindingRevision }
            : {}),
        });
      },
    });

    resources.provide(ingressRouteToken, Object.freeze({
      preRoute: async (
        message: Message,
        _lease: import('@zhin.js/plugin-runtime').SnapshotLease,
        _requester: PluginId,
        conversationSequence: number | undefined,
      ) => await workroomHumanIngress.preRoute(message, conversationSequence),
      route: async (
        message: Message,
        lease: import('@zhin.js/plugin-runtime').SnapshotLease,
        requester: PluginId,
        conversationSequence: number | undefined,
      ) => {
      const snapshot = lease.value;
      const trigger = service.getTriggerConfig();
      const matched = matchAiTrigger(message, trigger);

      const ownerId = resolveOwnerForRuntimeMessage(message, options.resolveEndpointOwner);
      const endpointTrusted = resolveTrustedForRuntimeMessage(message, options.resolveEndpointTrusted);
      const senderRoles = resolveRuntimeSenderRoles(message, ownerId, endpointTrusted, trigger);
      const turnAccess = createRuntimeTurnAccess(message, senderRoles);
      const sessionKey = runtimeImSessionKey(turnAccess);

      // Runtime message.adapter is a CapabilityId (\0-separated); strip it and
      // use Endpoint liveName so the OutboundHost resolve() succeeds.
      const effectiveAdapter = capabilityLocalName(String(message.conversation.endpoint.id));
      const effectiveEndpoint = adapterLiveEndpointId(message);
      const reply = async (
        content: SendContent,
      ): Promise<Awaited<ReturnType<Message['$reply']>>> => {
        const receipt = await message.$reply(content);
        logger.debug(formatCompact({
          op: 'replychain_message_reply',
          status: receipt.status,
          code: receipt.failure?.code,
          messageId: receipt.message?.id,
        }));
        return receipt;
      };

      // 管理命令（原 MessageCommand /models /tree /reset…）— 在 AI trigger 前拦截
      const managementReply = await handleRuntimeManagementCommand({
        service,
        zhinAgent,
        sessionKey,
        content: message.content,
        senderRoles,
      });
      if (managementReply != null) {
        await reply(managementReply);
        logger.info(formatCompact({ op: 'agent_host_management', handled: true }));
        return true;
      }

      const approveReply = /^\/approve(?:\s|$)/iu.test(message.content.trim())
        ? handleRuntimeOwnerApproveCommand(
            {
              platform: turnAccess.origin.kind === 'im' ? turnAccess.origin.platform : '',
              endpoint: turnAccess.origin.kind === 'im' ? turnAccess.origin.endpoint : '',
              ownerId,
              subjectId: turnAccess.principal.subjectId,
              scope: turnAccess.origin.kind === 'im' ? turnAccess.origin.scope : 'private',
            },
            message.content,
          )
        : null;
      if (approveReply != null) {
        await reply(approveReply);
        logger.info(formatCompact({ op: 'agent_host_approve', handled: true }));
        return true;
      }

      if (!matched) {
        return false;
      }

      if (isClearCommand(matched.content)) {
        await zhinAgent.archiveSession(sessionKey);
        await reply('已清空本会话的 AI 多轮上下文。');
        return true;
      }

      let capabilityActive = true;
      try {
        const inbound = await preprocessInboundTurn(
          message,
          matched.content,
          options.transcribeUrl,
        );
        const capabilities = await readCapabilities(
          ingress,
          snapshot,
          requester,
          message,
          senderRoles,
          () => capabilityActive,
        );
        const routed = routeSpecialistAgent(inbound.text, capabilities);
        // thinkingMessage：进入 AI 处理前先回占位（对齐 legacy inbound-turn-pipeline）。
        // 占位消息不 await 回包——平台 ack 慢不应拖住 turn 启动；
        // 失败仅记日志（正式回复仍走 replyAndRecord 的完整确认）。
        if (trigger.thinkingMessage) {
          message.$reply(trigger.thinkingMessage).catch((error: unknown) => {
            logger.debug(formatCompact({
              op: 'agent_host_thinking_reply_failed',
              error: error instanceof Error ? error.message : String(error),
            }));
          });
        }

        const outcome = await withTriggerTimeout(
          async (signal) => {
            const turnPolicy = resolveSandboxTurnPolicy({
              platform: turnAccess.origin.kind === 'im' ? turnAccess.origin.platform : '',
              isMaster: senderRoles.isMaster,
              metadata: message.metadata,
              projectRoot: options.projectRoot,
              defaultNetwork: interactiveNetworkPolicy(service.getAgentConfig()),
            });
            const request = createRuntimeTurnRequest(message, routed.userText, senderRoles, {
              traceId: randomUUID(),
              turnId: randomUUID(),
              signal,
              workspaceRoot: turnPolicy.filesystem.workspaceRoot,
              workingDirectory: turnPolicy.filesystem.workingDirectory,
              filesystemAccess: turnPolicy.filesystem.access,
              shell: turnPolicy.shell,
              network: turnPolicy.network,
              intent: await resolveProductTurnIntent(
                message,
                senderRoles,
                service.getAgentConfig()?.inboundQueue?.groupMode,
                resolveSnapshotTurnIntentResolver(snapshot, requester) ?? options.resolveTurnIntent,
              ),
              resolveReference: (reference, limits, referenceSignal) =>
                options.im.resolveConversationReference(lease, reference, {
                  signal: referenceSignal,
                  maxDepth: limits.depth,
                  maxEntries: limits.maxEntries,
                  maxChars: limits.maxChars,
                }),
              ...(conversationSequence === undefined ? {} : {
                readConversationContext: async (consumer: string, contextSignal: AbortSignal) => {
                  contextSignal.throwIfAborted();
                  if (!lease.active) throw new Error('Conversation context generation lease expired');
                  return options.im.readConversationContext(
                    message.conversation,
                    consumer,
                    conversationSequence,
                    50,
                    message.message?.id,
                  );
                },
                commitConversationContext: async (consumer: string, cursor: number) => {
                  if (!lease.active) throw new Error('Conversation context generation lease expired');
                  await options.im.commitConversationContext(message.conversation, consumer, cursor);
                },
              }),
              ports: {
                approval: options.approvalPort ?? createRuntimeApprovalPort({
                  // Sandbox `ask` must be a real interaction, even though the
                  // authenticated Console user maps to the endpoint owner.
                  isMaster: senderRoles.isMaster && turnPolicy.shell?.approvalMode !== 'ask',
                  interaction: ownerId
                    ? options.im.createInteraction(message, { subjectId: ownerId })
                    : undefined,
                  ...(turnPolicy.shell?.approvalMode === 'ask' ? {
                    rememberSession: {
                      isApproved: (approval) => rememberedSandboxApprovals
                        .get(sessionKey)
                        ?.has(approval.scopeKey ?? approval.toolName) === true,
                      grant: (approval) => {
                        let sessionApprovals = rememberedSandboxApprovals.get(sessionKey);
                        if (!sessionApprovals) {
                          if (rememberedSandboxApprovals.size >= 64) rememberedSandboxApprovals.clear();
                          sessionApprovals = new Set<string>();
                          rememberedSandboxApprovals.set(sessionKey, sessionApprovals);
                        }
                        if (sessionApprovals.size >= 64) sessionApprovals.clear();
                        sessionApprovals.add(approval.scopeKey ?? approval.toolName);
                      },
                    },
                  } : {}),
                }),
                question: createRuntimeQuestionPort(options.im, message),
                reply: {
                  send: async (output) => {
                    logger.debug(formatCompact({
                      op: 'replychain_port_send',
                      outputElements: output.length,
                      outputPreview: flattenOutputElements(output).trim() || '(empty)',
                    }));
                    const content = await publishOutboundElements([...output], effectiveAdapter || undefined);
                    logger.debug(formatCompact({
                      op: 'replychain_publish_outbound',
                      segments: content.length,
                    }));
                    if (content.length === 0) return { status: 'suppressed' as const };
                    const outcome = deliveryOutcomeFromReceipt(
                      await reply(content),
                    );
                    logger.debug(formatCompact({
                      op: 'replychain_delivery_outcome',
                      status: outcome.status,
                      code: 'code' in outcome ? outcome.code : undefined,
                      messageId: 'messageId' in outcome ? outcome.messageId : undefined,
                    }));
                    return outcome;
                  },
                },
              },
            });
            return options.runtime.executeLeased(
              lease,
              requester,
              request,
              {
                binding,
                mcpServers: binding.mcpServers,
                agent: routed.agent?.qualifiedName ?? routed.agent?.name,
              },
              observeTrace(traceRuntime, request),
            );
          },
          resolveTriggerTimeoutMs(trigger),
        );
        const elements = completedOutput(outcome);
        const outputText = flattenOutputElements(elements).trim();
        if (!outputText) {
          // spawn_task 等委派回合 finalReply 为空：用户可见文案由 subagent auto-continue
          // + proactive 出站；勿把 '(empty AI response)' 当成正文发给用户。
          logger.debug(formatCompact({
            op: 'agent_host_turn_no_outbound',
            reason: 'empty_elements_delegated',
          }));
        }
        logger.debug(formatCompact({
          op: 'agent_host_turn',
          turnMode: 'agent_runtime.execute',
          tools: outcome.status === 'completed' ? capabilities.tools.length : 0,
          ingressTools: capabilities.tools.length,
          elements: elements.length,
          model: binding.model,
          provider: binding.providerAlias,
          stt: inbound.sttApplied,
          agent: routed.agent?.name ?? '-',
        }));
        return true;
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        logger.warn(formatCompact({ op: 'agent_host_turn_fail', error: detail }));
        try {
          await reply(renderTriggerError(trigger, detail));
        } catch {
          /* ignore reply failure */
        }
        return true;
      } finally {
        capabilityActive = false;
      }
      },
    }));

    const providers = service.listProviders();
    const features = [
      zhinAgent.getSubagentSystem() ? 'subagent' : '',
      options.transcribeUrl ? 'inboundStt' : '',
      scheduleTools.length > 0 ? 'schedule' : '',
      homeTools.length > 0 ? 'home' : '',
      assistantEnabled ? 'assistant' : '',
      'bash',
      options.resolveEndpointOwner ? 'approve' : '',
    ].filter(Boolean).join(',');
    logger.info(
      `ready | ${binding.name}@${binding.providerAlias}/${binding.model}`
      + ` | providers: ${providers.length}`
      + ` | presets: ${presetCount}`
      + ` | mcp: ${mcpEntries.map((entry) => entry.name).join(',') || '-'}`
      + ` | ${features}`
      + ` | persistence: ${persistencePendingActivate ? 'pending_activate' : 'file'}`,
    );
    logger.debug(
      `ready detail | providers: ${providers.join(',')}`
      + ` | mcp: ${mcpEntries.map((entry) => entry.name).join(',') || '-'}`
      + ` | tools: ${(options.extraTools ?? []).map((tool) => tool.name).join(',') || '-'}`,
    );
  };
}

/**
 * Persist schedule-jobs.json + schedule_* tools for Plugin Runtime Agent Host.
 * When `assistant.enabled`, also sync profile routines and register Event Ingress.
 */
function wireRuntimeSchedule(
  agent: ZhinAgent,
  service: AIService,
  runtime: AgentRuntime,
  im: ImRuntime,
  projectRoot: string,
  assistantRaw: AssistantConfig | undefined,
  lifecycle: DisposeStack,
  trace: AgentTraceRecorder,
): {
  tools: ReturnType<typeof createScheduleTools>;
  dispose: () => Promise<void>;
  assistantEnabled: boolean;
  notificationRouter: ReturnType<typeof createNotificationRouter>;
  defaultNotify: ReturnType<typeof parseJobNotify> | undefined;
  bindCallHaService: (fn: (service: string, target?: string, data?: unknown) => Promise<void>) => void;
  assistantRuntime: AssistantRuntimeHandle | null;
} {
  const dataDir = join(projectRoot, 'data');
  mkdirSync(dataDir, { recursive: true });

  const assistantCfg = resolveAssistantConfig(assistantRaw);
  const defaults = resolveAssistantDefaultsConfig(assistantCfg.defaults);
  let defaultNotify = defaults.notify;
  if (defaultNotify) {
    try {
      defaultNotify = parseJobNotify(defaultNotify);
    } catch {
      defaultNotify = undefined;
    }
  }

  let callHaServiceImpl: ((service: string, target?: string, data?: unknown) => Promise<void>) | undefined;
  const bindCallHaService = (fn: (service: string, target?: string, data?: unknown) => Promise<void>) => {
    callHaServiceImpl = fn;
  };

  const proactiveOutbound = createRuntimeProactiveOutbound(im);
  const notificationRouter = createNotificationRouter({
    resolveAdapter: () => undefined,
    sendIm: async (notify, content, source) => {
      await proactiveOutbound.send({
        scene: notify.target.scene,
        source: (source ?? 'scheduled') as import('@zhin.js/agent').ProactiveSendSource,
      }, content);
    },
    callHaService: async (service, target, data) => {
      if (callHaServiceImpl) {
        await callHaServiceImpl(service, target, data);
        return;
      }
      logger.info(formatCompact({
        op: 'job_notify_ha_stub',
        service,
        target,
      }));
    },
  });
  const executor = createTaskExecutor({
    turn: createRuntimeScheduleTurnPort(runtime, service, projectRoot, trace),
    config: asPrivate(agent).config,
    activity: createScheduleActivityPort(agent),
    dataDir,
    resolveAdapter: () => undefined,
    router: notificationRouter,
    defaultNotify,
  });

  const store = createScheduleJobStoreFromConfig(dataDir, {
    defaultNotify,
  });
  const jobWorker = new JobWorker({
    executor,
    queue: assistantCfg.queue,
  });
  const jobEngine = new ScheduleJobEngine({
    store,
    worker: jobWorker,
    notifyOnFailure: defaults.notifyOnFailure,
    router: notificationRouter,
    defaultNotify,
  });

  const scheduleManager = {
    scheduleFeature: {
      getStatus: () => [],
    },
    engine: jobEngine,
    previewTask: (prompt: string, context: import('@zhin.js/agent').ScheduleInvocationContext, options?: { activityFeedback?: boolean }) =>
      executor.preview(prompt, context, options),
  };

  let assistantRuntime: AssistantRuntimeHandle | null = null;
  if (assistantCfg.enabled) {
    const ingress = new AssistantEventIngress({
      store,
      engine: jobEngine,
      eventsConfig: assistantCfg.events,
    });
    assistantRuntime = {
      events: {
        isEnabled: () => ingress.isEnabled(),
        handle: (body) => ingress.handle(body),
      },
      jobs: {
        list: () => jobEngine.listJobs(),
        add: (job) => jobEngine.addJob(job),
        remove: (id) => jobEngine.removeJob(id),
        pause: (id) => jobEngine.pauseJob(id),
        resume: (id) => jobEngine.resumeJob(id),
      },
    };
    void (async () => {
      const profile = await loadAssistantProfileFile(projectRoot, assistantCfg.profile);
      if (profile) {
        for (const err of validateAssistantProfile(profile)) {
          logger.warn(formatCompact({ assistant_profile: err }));
        }
      }
      await syncProfileHeartbeatToStore(store, profile);
      await syncProfileRoutinesToStore(store, profile);
      await pruneStaleProfileCronJobs(store, profile);
      jobEngine.load();
    })().catch((error) => {
      logger.warn(formatCompact({
        op: 'assistant_profile_load_fail',
        error: error instanceof Error ? error.message : String(error),
      }));
      jobEngine.load();
    });
    logger.info(formatCompact({
      op: 'agent_host_assistant',
      enabled: true,
      events: ingress.isEnabled(),
      profile: assistantCfg.profile?.enabled === true,
    }));
  } else {
    jobEngine.load();
  }

  const tools = createScheduleTools(scheduleManager);

  return {
    tools,
    assistantEnabled: assistantCfg.enabled,
    notificationRouter,
    defaultNotify,
    bindCallHaService,
    assistantRuntime,
    // assistant / schedule-manager 注册随 generation lifecycle 反注册（provide 时挂接）
    dispose: async () => {
      jobEngine.unload();
      await jobWorker.stop();
    },
  };
}

function createRuntimeScheduleTurnPort(
  runtime: AgentRuntime,
  service: AIService,
  projectRoot: string,
  trace: AgentTraceRecorder,
) {
  return Object.freeze({
    execute: async (input: ScheduleTurnExecutionRequest): Promise<TurnOutcome> => {
      const binding = input.agent
        ? service.getBindingRegistry().getBinding(input.agent)
        : service.getBindingRegistry().requireZhinBinding();
      if (!binding) throw new Error(`Schedule Agent binding not found: ${input.agent}`);
      const creator = input.createdBy ? demoteScheduleCreator(input.createdBy) : undefined;
      const request: TurnRequest = {
        identity: { traceId: input.executionId, turnId: input.executionId },
        origin: { kind: 'schedule', jobId: input.jobId },
        intent: { kind: 'new' },
        principal: {
          subjectId: creator?.userId ?? 'schedule',
          ...(creator?.name ? { displayName: creator.name } : {}),
          roles: [...(creator?.roles ?? [])],
        },
        input: { text: input.prompt },
        session: { key: `schedule:${input.jobId}` },
        policy: {
          permissions: [],
          unattended: true,
          network: {
            enabled: true,
            httpsOnly: true,
            allowedDomains: [...input.security.allowedDomains],
          },
          shell: { preset: input.security.execPreset },
          filesystem: { workspaceRoot: projectRoot },
        },
        execution: {
          kind: 'schedule',
          executionPlan: input.executionPlan,
          createdBy: input.createdBy,
          security: {
            execPreset: input.security.execPreset,
            allowedDomains: [...input.security.allowedDomains],
          },
        },
        signal: input.signal,
        ports: {},
      };
      return runtime.execute(rootPluginId(), request, {
        binding,
        mcpServers: binding.mcpServers,
        ...(binding.name === 'zhin' ? {} : { agent: binding.name }),
      }, observeTrace(trace, request, input.onTurnEvent));
    },
  });
}

function observeTrace(
  trace: AgentTraceRecorder,
  request: TurnRequest,
  downstream?: (event: TurnEvent) => void,
): (event: TurnEvent) => void {
  return (event) => {
    const tracedEvent: TurnEvent = event.type === 'turn_start'
      && request.origin.kind === 'im'
      && request.origin.messageId
      ? { ...event, sourceMessageId: request.origin.messageId }
      : event;
    trace.record(request.session.key, request.identity.turnId, tracedEvent);
    downstream?.(event);
  };
}

function createScheduleActivityPort(agent: ZhinAgent) {
  return Object.freeze({
    publish: (event: ScheduleActivityEvent) => {
      const payload = scheduleActivityPayload(event);
      if (!payload) return;
      agent.getEventEmitter().emit(`schedule.${event.phase}`, payload);
    },
  });
}

function scheduleActivityPayload(event: ScheduleActivityEvent) {
  const previewIm = event.previewSource?.origin.kind === 'im' ? event.previewSource.origin : undefined;
  const notifyIm = event.notify.channel === 'im' ? event.notify.target.scene : undefined;
  const address = previewIm
    ? {
        platform: previewIm.platform,
        endpointKey: previewIm.endpoint,
        sceneId: previewIm.sceneId,
        scope: previewIm.scope,
        messageId: previewIm.messageId,
      }
    : notifyIm
      ? {
          platform: notifyIm.platform,
          endpointKey: notifyIm.endpointKey,
          sceneId: notifyIm.sceneId,
          scope: notifyIm.kind,
        }
      : undefined;
  if (!address) return undefined;
  return {
    sessionId: event.previewSource?.sessionKey ?? `schedule:${event.job.id}`,
    source: 'zhin-agent' as const,
    mode: 'text' as const,
    userId: event.job.createdBy?.userId ?? 'schedule',
    ...address,
    hookContext: {
      scheduleJobId: event.job.id,
      ...(event.job.createdBy ? { scheduleCreatedBy: event.job.createdBy } : {}),
      ...(event.previewSource ? { schedulePreview: true } : {}),
      scheduleActivityFeedback: true,
      ...(event.job.executionPlan ? { scheduleExecutionPlan: event.job.executionPlan } : {}),
    },
  };
}

async function wireRuntimeHome(
  projectRoot: string,
  assistantRaw: AssistantConfig | undefined,
  notificationRouter: ReturnType<typeof createNotificationRouter>,
  bindCallHaService: (fn: (service: string, target?: string, data?: unknown) => Promise<void>) => void,
  defaultNotify: ReturnType<typeof parseJobNotify> | undefined,
): Promise<{
  tools: BootstrapAssistantHomeResult['tools'];
  dispose: () => void;
  homeActive: boolean;
  watchActive: boolean;
}> {
  const assistantCfg = resolveAssistantConfig(assistantRaw);
  const result = await bootstrapAssistantHome({
    homeRaw: assistantCfg.home,
    profile: assistantCfg.profile,
    projectRoot,
    notificationRouter,
    defaultNotify,
    bindCallHaService,
    log: (payload) => logger.info(formatCompact(payload)),
  });
  return {
    tools: result.tools,
    dispose: result.dispose,
    homeActive: result.homeActive,
    watchActive: result.watchActive,
  };
}

function createRuntimeZhinAgent(
  service: AIService,
  im: ImRuntime,
  projectRoot: string,
  approvalPort?: ApprovalPort,
): {
  agent: ZhinAgent;
  runtime: ReturnType<typeof composeZhinAgentRuntime>;
  seedPresets: () => Promise<number>;
} {
  const binding = service.getBindingRegistry().requireZhinBinding();
  const provider = service.getProvider(binding.providerAlias);
  const agent = new ZhinAgent(provider, {
    ...(service.getAgentConfig() ?? {}),
    chatModel: binding.model,
  });
  asPrivate(agent).approvalPort = approvalPort;
  const composed = composeZhinAgentRuntime(agent, provider, createRuntimeProactiveOutbound(im));
  const resourceHub = new AgentResourceHub();
  agent.configure({
    agentCore: composed.agentCore,
    toolSystem: composed.toolSystem,
    contextSystem: composed.contextSystem,
    memorySystem: composed.memorySystem,
    sessionSystem: composed.sessionSystem,
    eventSystem: composed.eventSystem,
    resourceHub,
    providerResolver: (alias) => service.getProvider(alias),
    activeBinding: binding,
    deferredResultSender: composed.deliverOutbound,
    subagentSender: composed.deliverOutbound,
  });

  agent.initSubagentSystem(() => buildRuntimeSubagentAgentTools(projectRoot));
  agent.getSubagentSystem()?.configureRouting({
    getProvider: (alias) => service.getProvider(alias),
    resolveBinding: (name) => service.getBindingRegistry().getBinding(name),
    getMcpRegistry: () => null,
    resolveAgentMeta: async (name) => {
      const metas = await discoverWorkspaceAgents(null, projectRoot);
      return metas.find((meta) => meta.name === name) ?? null;
    },
    getParentContextSnapshot: (origin) => agent.buildParentContextSnapshotForSubagent(origin),
  });

  // Persistence readiness is latched after DatabaseHost activateNext (or
  // immediately when sessions.useDatabase === false / no DatabaseHost).
  return {
    agent,
    runtime: composed,
    seedPresets: () => seedResourceHubAgentPresets(resourceHub, projectRoot),
  };
}

/**
 * Subagent tool pool — derived from the same generation projection as the
 * main turn so the ToolIndex is the single source of truth. Native builtin
 * tools (file / web) are projected via the same helpers the main agent uses;
 * bash stays on the legacy Tool path until its native projection lands.
 */
function buildRuntimeSubagentAgentTools(_projectRoot: string): AgentTool[] {
  const nativeFiles = createNativeFileToolFeatures();
  const nativeWeb = createNativeWebToolFeatures();
  const bash = createBashTool();
  const fromNative: AgentTool[] = [...nativeFiles, ...nativeWeb].map((native) => ({
    name: native.name,
    description: native.definition.description,
    parameters: native.definition.inputSchema as JsonSchema,
    source: 'builtin',
    execute: (args: Record<string, unknown>, _ctx?: unknown, execCtx?: unknown) =>
      (native.definition.execute as (input: unknown, context: unknown) => Promise<unknown>)(
        args,
        execCtx,
      ),
  }));
  return [
    ...fromNative,
    {
      name: bash.name,
      description: bash.description,
      parameters: bash.parameters as JsonSchema,
      source: 'builtin',
      execute: bash.execute as (args: Record<string, unknown>) => Promise<unknown>,
    },
  ];
}

async function seedResourceHubAgentPresets(
  resourceHub: AgentResourceHub,
  projectRoot: string,
): Promise<number> {
  try {
    const metas = await discoverWorkspaceAgents(null, projectRoot);
    for (const meta of metas) {
      if (resourceHub.subagents.getPreset(meta.name)) continue;
      resourceHub.addAgentPreset({
        name: meta.name,
        description: meta.description,
        systemPrompt: '',
        tools: meta.toolNames,
        model: meta.model,
        filePath: meta.filePath,
        pluginName: meta.ownerPlugin,
      });
    }
    if (metas.length > 0) {
      logger.info(formatCompact({
        op: 'agent_host_presets',
        count: metas.length,
        names: metas.map((meta) => meta.name).join(','),
      }));
    }
    return metas.length;
  } catch (error) {
    logger.warn(formatCompact({
      op: 'agent_host_presets_fail',
      error: error instanceof Error ? error.message : String(error),
    }));
    return 0;
  }
}

function createRuntimeProactiveOutbound(im: ImRuntime): ProactiveOutboundService {
  return {
    async send(ctx, content) {
      const result = await im.sendEndpointMessage({
        adapter: ctx.scene.platform,
        endpointKey: ctx.scene.endpointKey,
        conversation: {
          kind: ctx.scene.kind as 'private' | 'group' | 'channel',
          id: ctx.scene.sceneId,
        },
        content,
      });
      return result.messageId || 'ok';
    },
    async sendElements(ctx, elements) {
      const content = await publishOutboundElements(elements, ctx.scene.platform);
      if (content.length === 0) return [];
      const id = await this.send(ctx, content);
      return [id];
    },
  };
}

export interface RuntimeSenderRoles {
  readonly isMaster: boolean;
  readonly isTrusted: boolean;
}

/**
 * 对齐 legacy resolveSenderRoles（ai-trigger.ts:260）：
 * trigger.masters ∪ endpoint master → master 角色（审批放行）；
 * trigger.trusted ∪ endpoint trusted → trusted 角色（弱于 master，不参与 Owner 审批）。
 */
export function resolveRuntimeSenderRoles(
  message: Message,
  endpointMaster: string | undefined,
  endpointTrusted: readonly string[],
  trigger?: AITriggerConfig,
): RuntimeSenderRoles {
  const senderId = message.sender?.id ?? resolveAuthenticatedSenderId(message);
  const triggerMasters = (trigger?.masters ?? []).map(String);
  const triggerTrusted = (trigger?.trusted ?? []).map(String);
  const isMaster = senderId != null
    && ((endpointMaster != null && senderId === String(endpointMaster))
      || triggerMasters.includes(senderId));
  const isTrusted = !isMaster && senderId != null
    && (triggerTrusted.includes(senderId) || endpointTrusted.map(String).includes(senderId));
  return { isMaster, isTrusted };
}

/**
 * Canonical IM → Agent TurnRequest mapper. Runtime Message remains owned by IM.
 */
export function createRuntimeTurnRequest(
  message: Message,
  text: string,
  roles: RuntimeSenderRoles,
  input: Readonly<{
    traceId: string;
    turnId: string;
    signal: AbortSignal;
    workspaceRoot: string;
    workingDirectory?: string;
    filesystemAccess?: NonNullable<TurnRequest['policy']['filesystem']>['access'];
    shell?: TurnRequest['policy']['shell'];
    network?: TurnRequest['policy']['network'];
    intent: TurnIntent;
    ports: TurnRequestPorts;
    resolveReference?: (
      reference: ConversationReference,
      options: Readonly<{ depth: number; maxEntries: number; maxChars: number }>,
      signal: AbortSignal,
    ) => Promise<ConversationResolution>;
    readConversationContext?: (consumer: string, signal: AbortSignal) => Promise<Readonly<{
      blocks: readonly import('@zhin.js/im-contract').ConversationContextBlock[];
      cursor: number;
    }>>;
    commitConversationContext?: (consumer: string, cursor: number) => Promise<void>;
    /** Configuration-owned metadata; applied after untrusted adapter metadata. */
    trustedMetadata?: Readonly<Record<string, unknown>>;
  }>,
): TurnRequest {
  const access = createRuntimeTurnAccess(message, roles);
  const origin = access.origin;
  if (origin.kind !== 'im') throw new Error('Runtime IM ingress must produce an IM origin');
  const mediaEntries = collectSegmentMedia(
    message.segments ? toCanonicalSegments(message.segments) : undefined,
  ).map(({ type, media: ref }) => Object.freeze({
    kind: type as 'image' | 'audio' | 'video' | 'file',
    source: Object.freeze({
      kind: ref.kind === 'file' ? 'platform_ref' as const : ref.kind,
      value: ref.value,
    }),
    ...(ref.mime_type ? { mimeType: ref.mime_type } : {}),
    ...(ref.file_name ? { name: ref.file_name } : {}),
  }));
  const conversationReferences: ConversationReference[] = [];
  if (message.replyTo?.id) {
    conversationReferences.push(Object.freeze({
      kind: 'message',
      message: Object.freeze({ conversation: message.conversation, id: message.replyTo.id }),
    }));
  }
  for (const segment of toCanonicalSegments(message.segments ?? [])) {
    if (segment.type !== 'forward') continue;
    const forwardId = String(segment.data.forward_id ?? '').trim();
    if (!forwardId) continue;
    conversationReferences.push(Object.freeze({
      kind: 'forward',
      conversation: message.conversation,
      forwardId,
    }));
  }
  for (const entry of mediaEntries) {
    if (entry.source.kind !== 'platform_ref') continue;
    conversationReferences.push(Object.freeze({
      kind: 'media',
      conversation: message.conversation,
      media: Object.freeze({
        kind: 'file',
        value: entry.source.value,
        ...(entry.mimeType ? { mime_type: entry.mimeType } : {}),
        ...(entry.name ? { file_name: entry.name } : {}),
      }),
    }));
  }
  const turnReferences = conversationReferences.map((reference, index) => Object.freeze({
    key: `ref-${index + 1}`,
    kind: reference.kind,
    sourceId: reference.kind === 'message'
      ? reference.message.id
      : reference.kind === 'forward'
        ? reference.forwardId
        : reference.media.value,
  }));
  const referenceByKey = new Map<string, ConversationReference>(turnReferences.map((reference, index) => [
    reference.key,
    conversationReferences[index]!,
  ]));
  const media = mediaEntries.map((entry) => {
    if (entry.source.kind !== 'platform_ref') return entry;
    const reference = turnReferences.find((candidate) => candidate.kind === 'media' && candidate.sourceId === entry.source.value);
    return Object.freeze({ ...entry, ...(reference ? { referenceKey: reference.key } : {}) });
  });
  if (turnReferences.length > 0 && !input.resolveReference) {
    throw new TypeError('Runtime IM references require a generation-bound resolver');
  }
  const referencePort = turnReferences.length > 0
    ? Object.freeze({
        resolve: async (
          key: string,
          options: Readonly<{ depth: number; maxEntries: number; maxChars: number }>,
          signal: AbortSignal,
        ) => {
          const reference = referenceByKey.get(key);
          if (!reference) return Object.freeze({ status: 'forbidden' as const, code: 'reference_not_in_turn' });
          const result = await input.resolveReference!(reference, options, signal);
          if (result.status !== 'resolved') return result;
          const bounded = boundReferenceContent(result.value, options);
          return Object.freeze({
            status: 'resolved' as const,
            content: bounded.content,
            ...(bounded.truncated ? { truncated: true } : {}),
          });
        },
      })
    : undefined;
  // Conversation events belong to the Agent session, not to whichever principal
  // happened to trigger the next turn in a shared room.
  const sessionKey = runtimeImSessionKey(access);
  const contextConsumer = `agent-session:${sessionKey}`;
  const conversationContext = input.readConversationContext && input.commitConversationContext
    ? Object.freeze({
        readPending: (signal: AbortSignal) => input.readConversationContext!(contextConsumer, signal),
        commit: (cursor: number) => input.commitConversationContext!(contextConsumer, cursor),
      })
    : undefined;

  return Object.freeze({
    identity: Object.freeze({ traceId: input.traceId, turnId: input.turnId }),
    origin,
    principal: access.principal,
    intent: Object.freeze({ ...input.intent }),
    input: Object.freeze({
      text,
      ...(media.length > 0 ? { media: Object.freeze(media) } : {}),
      ...(turnReferences.length > 0 ? { references: Object.freeze(turnReferences) } : {}),
      metadata: Object.freeze({ ...message.metadata, ...input.trustedMetadata }),
    }),
    session: Object.freeze({
      key: sessionKey,
    }),
    policy: Object.freeze({
      ...access.policy,
      filesystem: Object.freeze({
        workspaceRoot: input.workspaceRoot,
        ...(input.workingDirectory ? { workingDirectory: input.workingDirectory } : {}),
        ...(input.filesystemAccess ? { access: input.filesystemAccess } : {}),
      }),
      ...(input.shell ? { shell: Object.freeze({ ...input.shell }) } : {}),
      ...(input.network ? { network: Object.freeze({
        enabled: input.network.enabled,
        httpsOnly: input.network.httpsOnly,
        allowedDomains: Object.freeze([...(input.network.allowedDomains ?? [])]),
      }) } : {}),
    }),
    signal: input.signal,
    ports: Object.freeze({
      ...input.ports,
      ...(referencePort ? { references: referencePort } : {}),
      ...(conversationContext ? { conversationContext } : {}),
    }),
  });
}

function boundReferenceContent(
  input: unknown,
  options: Readonly<{ depth: number; maxEntries: number; maxChars: number }>,
): Readonly<{ content: unknown; truncated: boolean }> {
  if (
    input && typeof input === 'object'
    && ['url', 'path', 'base64', 'file'].includes(String((input as { kind?: unknown }).kind ?? ''))
    && typeof (input as { value?: unknown }).value === 'string'
  ) {
    return Object.freeze({ content: input, truncated: false });
  }
  let remainingChars = Math.max(0, options.maxChars);
  let remainingEntries = Math.max(0, options.maxEntries);
  let truncated = false;
  const seen = new WeakSet<object>();

  const visit = (value: unknown, depth: number, key?: string): unknown => {
    if (typeof value === 'string') {
      if (remainingChars <= 0) {
        truncated = true;
        return '';
      }
      if (value.length <= remainingChars) {
        remainingChars -= value.length;
        return value;
      }
      const result = value.slice(0, remainingChars);
      remainingChars = 0;
      truncated = true;
      return `${result}…[truncated]`;
    }
    if (value == null || typeof value !== 'object') return value;
    if (seen.has(value)) {
      truncated = true;
      return '[cycle omitted]';
    }
    seen.add(value);
    if (Array.isArray(value)) {
      const isForwardEntries = key === 'entries' || (key === undefined && depth === 0);
      if (isForwardEntries && depth > options.depth) {
        truncated = true;
        return [];
      }
      const take = isForwardEntries ? Math.min(value.length, remainingEntries) : value.length;
      if (isForwardEntries) remainingEntries -= take;
      if (isForwardEntries && take < value.length) truncated = true;
      return Object.freeze(value.slice(0, take).map((item) => visit(item, isForwardEntries ? depth + 1 : depth)));
    }
    const output: Record<string, unknown> = {};
    for (const [childKey, childValue] of Object.entries(value as Record<string, unknown>)) {
      output[childKey] = visit(childValue, depth, childKey);
    }
    return Object.freeze(output);
  };

  return Object.freeze({ content: visit(input, 0), truncated });
}

/**
 * Trusted adapter metadata may select an active-turn coordination intent.
 * Unknown/malformed values fail closed instead of silently becoming supersede.
 */
export function resolveRuntimeTurnIntent(
  message: Message,
  groupMode: 'supersede' | 'fifo' = 'supersede',
): TurnIntent {
  const raw = message.metadata?.turnIntent;
  if (raw === undefined) {
    return Object.freeze({
      kind: groupMode === 'fifo' && isGroupOrChannelRuntimeMessage(message) ? 'new' : 'supersede',
    });
  }
  if (!raw || typeof raw !== 'object') {
    throw new TypeError('Runtime turnIntent metadata must be an object');
  }
  const record = raw as Record<string, unknown>;
  const kind = record.kind;
  if (!['new', 'steer', 'follow_up', 'supersede', 'observe'].includes(String(kind))) {
    throw new TypeError(`Runtime turnIntent kind is invalid: ${String(kind)}`);
  }
  const targetTurnId = record.targetTurnId;
  if (targetTurnId !== undefined && (typeof targetTurnId !== 'string' || !targetTurnId.trim())) {
    throw new TypeError('Runtime turnIntent targetTurnId must be a non-empty string');
  }
  const authorizedBy = record.authorizedBy;
  if (authorizedBy !== undefined) {
    throw new TypeError('Runtime turnIntent authorizedBy must be supplied by trusted product policy');
  }
  return Object.freeze({
    kind: kind as TurnIntent['kind'],
    ...(targetTurnId ? { targetTurnId } : {}),
  });
}

function isGroupOrChannelRuntimeMessage(message: Message): boolean {
  return message.conversation.kind === 'group' || message.conversation.kind === 'channel';
}

export function resolveSnapshotTurnIntentResolver(
  snapshot: Pick<RuntimeSnapshot, 'resources'>,
  requester: PluginId,
): TurnIntentResolver | undefined {
  const candidate = snapshot.resources.get(requester)?.get(turnIntentResolverToken.id);
  return typeof candidate === 'function' ? candidate as TurnIntentResolver : undefined;
}

export async function resolveProductTurnIntent(
  message: Message,
  senderRoles: Readonly<RuntimeSenderRoles>,
  groupMode: 'supersede' | 'fifo' | undefined,
  resolver: InstallAgentHostOptions['resolveTurnIntent'],
): Promise<TurnIntent> {
  const defaultIntent = resolveRuntimeTurnIntent(message, groupMode);
  if (!resolver) return defaultIntent;
  const resolved = await resolver(Object.freeze({ message, senderRoles, defaultIntent }));
  return Object.freeze({ ...resolved });
}

/** IM adapter for the origin-neutral interaction authority. */
export function createRuntimeQuestionPort(
  im: ImRuntime,
  message: Message,
): NonNullable<TurnRequestPorts['question']> {
  const interaction = im.createInteraction(message);
  if (!interaction) throw new Error('User interaction is unavailable for this message');
  return Object.freeze({
    async ask(request: Parameters<NonNullable<TurnRequestPorts['question']>['ask']>[0]) {
      const options = {
        ...(request.timeoutMs !== undefined ? { timeout: request.timeoutMs } : {}),
        ...(request.defaultValue !== undefined ? { default: request.defaultValue } : {}),
        signal: request.signal,
      };
      if (request.type === 'text') {
        const value = await interaction.ask({ type: 'text', title: request.question, ...options });
        return Object.freeze({ type: 'text' as const, value });
      }
      if (request.type === 'number') {
        const numericDefault = request.defaultValue === undefined
          ? undefined
          : Number(request.defaultValue);
        const value = await interaction.ask({
          type: 'number',
          title: request.question,
          ...(request.timeoutMs !== undefined ? { timeout: request.timeoutMs } : {}),
          ...(Number.isFinite(numericDefault) ? { default: numericDefault } : {}),
          signal: request.signal,
        });
        return Object.freeze({ type: 'number' as const, value });
      }
      if (request.type === 'confirm') {
        const value = await interaction.ask({
          type: 'confirm',
          title: request.question,
          ...(request.timeoutMs !== undefined ? { timeout: request.timeoutMs } : {}),
          ...(request.defaultValue !== undefined
            ? { default: /^(?:y|yes|true|1|是|确认|同意)$/i.test(request.defaultValue) }
            : {}),
          signal: request.signal,
        });
        return Object.freeze({ type: 'confirm' as const, value });
      }
      const choices = request.options ?? [];
      const value = await interaction.ask({
        type: 'select',
        title: request.question,
        options: choices.map((label) => ({ label, value: label })),
        ...(request.timeoutMs !== undefined ? { timeout: request.timeoutMs } : {}),
        ...(request.defaultValue !== undefined ? { default: request.defaultValue } : {}),
        signal: request.signal,
      }) as string;
      return Object.freeze({ type: 'pick' as const, value, index: choices.indexOf(value) });
    },
  });
}

/** IM ApprovalPort: master is already the authority; others wait via UserInteraction. */
export function createRuntimeApprovalPort(options: {
  readonly isMaster: boolean;
  readonly interaction?: UserInteraction;
  readonly rememberSession?: Readonly<{
    isApproved(input: ApprovalRequestInput): boolean;
    grant(input: ApprovalRequestInput): void;
  }>;
}): ApprovalPort {
  return Object.freeze({
    available: options.isMaster || options.interaction != null,
    async requestApproval(input: ApprovalRequestInput) {
      if (options.isMaster) return true;
      if (!options.interaction) return false;
      try {
        if (options.rememberSession?.isApproved(input)) return true;
        if (options.rememberSession) {
          const decision = await options.interaction.ask({
            type: 'select',
            title: '操作确认',
            description: input.question,
            tip: '“本会话允许”仅在当前 Host 生命周期内生效。',
            options: [
              { label: '允许一次', value: 'once', description: '仅执行当前操作。' },
              { label: '本会话允许', value: 'session', description: '后续同会话、同一具体操作自动放行。' },
              { label: '拒绝', value: 'deny', description: '阻止当前操作。' },
            ],
            default: 'deny',
            ...(input.timeoutMs !== undefined ? { timeout: input.timeoutMs } : {}),
            signal: input.signal,
          });
          if (decision === 'session') options.rememberSession.grant(input);
          return decision === 'once' || decision === 'session';
        }
        return await options.interaction.ask({
          type: 'confirm',
          title: '操作确认',
          description: input.question,
          tip: '请由 master 用户确认是否继续。',
          confirmLabel: '允许一次',
          cancelLabel: '拒绝',
          ...(input.timeoutMs !== undefined ? { timeout: input.timeoutMs } : {}),
          default: false,
          signal: input.signal,
        });
      } catch {
        return false;
      }
    },
  });
}

export function deliveryOutcomeFromReceipt(
  receipt: Awaited<ReturnType<Message['$reply']>>,
): DeliveryOutcome {
  switch (receipt.status) {
    case 'sent':
      return {
        status: 'sent' as const,
        ...(receipt.message?.id
          ? { messageId: receipt.message.id }
          : {}),
      };
    case 'suppressed':
      return { status: 'suppressed' as const };
    case 'unsupported':
      return {
        status: 'unsupported' as const,
        code: receipt.failure?.code ?? 'outbound_unsupported',
      };
    case 'rejected':
      return {
        status: 'rejected' as const,
        code: receipt.failure?.code ?? 'outbound_payload_rejected',
      };
    case 'failed':
      return {
        status: 'failed' as const,
        code: receipt.failure?.code ?? 'endpoint_send_failed',
        retryable: receipt.failure?.retryable === true,
      };
  }
}

function interactiveNetworkPolicy(
  config: ReturnType<AIService['getAgentConfig']>,
): TurnRequest['policy']['network'] | undefined {
  return config?.execPreset === 'network'
    ? Object.freeze({ enabled: true, httpsOnly: true, allowedDomains: Object.freeze([]) })
    : undefined;
}

export function createRuntimeTurnAccess(
  message: Message,
  roles: RuntimeSenderRoles,
): TurnAccessContext {
  const platform = capabilityLocalName(String(message.conversation.endpoint.id));
  const endpoint = message.endpointId?.trim();
  if (!endpoint) throw new TypeError('Runtime IM ingress requires endpoint identity');
  const subjectId = message.sender?.id?.trim();
  if (!subjectId) throw new TypeError('Runtime IM ingress requires authenticated sender identity');
  const scope = resolveChannelType(message);
  const trustRole = roles.isMaster ? 'master' : roles.isTrusted ? 'trusted' : 'user';
  const principalRoles = [...new Set([...(message.sender?.roles ?? []), trustRole])];
  return Object.freeze({
    origin: Object.freeze({
      kind: 'im' as const,
      platform,
      endpoint,
      scope,
      sceneId: resolveChannelId(message),
      ...(message.id ? { messageId: message.id } : {}),
    }),
    principal: Object.freeze({
      subjectId,
      ...(message.sender?.name ? { displayName: message.sender.name } : {}),
      roles: Object.freeze(principalRoles),
    }),
    policy: Object.freeze({
      permissions: Object.freeze(principalRoles),
      unattended: false,
    }),
  });
}

function runtimeImSessionKey(access: TurnAccessContext): string {
  const origin = access.origin;
  if (origin.kind !== 'im') throw new TypeError('Runtime IM access requires an IM origin');
  return `${origin.platform}:${origin.endpoint}:${origin.scope}:${origin.sceneId}`;
}

function resolveOwnerForRuntimeMessage(
  message: Message,
  resolve?: InstallAgentHostOptions['resolveEndpointOwner'],
): string | undefined {
  if (!resolve) return undefined;
  const localName = capabilityLocalName(String(message.conversation.endpoint.id));
  const endpointKey = String(
    message.metadata?.endpoint
    ?? message.metadata?.endpointKey
    ?? localName,
  );
  return resolve(localName, endpointKey) ?? resolve(endpointKey, endpointKey);
}

function resolveTrustedForRuntimeMessage(
  message: Message,
  resolve?: InstallAgentHostOptions['resolveEndpointTrusted'],
): readonly string[] {
  if (!resolve) return [];
  const localName = capabilityLocalName(String(message.conversation.endpoint.id));
  const endpointKey = String(
    message.metadata?.endpoint
    ?? message.metadata?.endpointKey
    ?? localName,
  );
  const merged = [...resolve(localName, endpointKey), ...resolve(endpointKey, endpointKey)];
  return [...new Set(merged.map((id) => String(id).trim()).filter(Boolean))];
}

/** ai.trigger.timeout（默认 60000，对齐 legacy DEFAULT_AI_TRIGGER_CONFIG）。 */
const DEFAULT_TRIGGER_TIMEOUT_MS = 60_000;
/** ai.trigger.errorTemplate 默认值，对齐 legacy DEFAULT_AI_TRIGGER_CONFIG。 */
const DEFAULT_TRIGGER_ERROR_TEMPLATE = '❌ AI 处理失败: {error}';

export function resolveTriggerTimeoutMs(trigger?: AITriggerConfig): number {
  const raw = trigger?.timeout;
  return typeof raw === 'number' && Number.isFinite(raw) && raw > 0
    ? raw
    : DEFAULT_TRIGGER_TIMEOUT_MS;
}

export function renderTriggerError(trigger: AITriggerConfig | undefined, detail: string): string {
  const template = trigger?.errorTemplate?.trim()
    ? trigger.errorTemplate
    : DEFAULT_TRIGGER_ERROR_TEMPLATE;
  return template.replace('{error}', detail);
}

export class TriggerTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`AI 处理超时（${timeoutMs}ms）`);
    this.name = 'TriggerTimeoutError';
  }
}

/**
 * Runs one ingress-owned turn with a cancellation signal. On timeout the
 * signal reaches the inbound queue, PromptController, provider stream, and
 * tool execution instead of merely hiding a late result.
 */
export function withTriggerTimeout<T>(
  run: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
): Promise<T>;
/** @deprecated Promise inputs cannot be cancelled; pass a signal-aware callback. */
export function withTriggerTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T>;
export function withTriggerTimeout<T>(
  work: Promise<T> | ((signal: AbortSignal) => Promise<T>),
  timeoutMs: number,
): Promise<T> {
  if (typeof work === 'function') {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new TriggerTimeoutError(timeoutMs)), timeoutMs);
    return work(controller.signal).finally(() => clearTimeout(timer));
  }
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new TriggerTimeoutError(timeoutMs));
    }, timeoutMs);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function resolveChannelId(message: Message): string {
  const id = message.conversation.id.trim();
  if (!id) throw new TypeError('Runtime IM ingress requires scene identity');
  return id;
}

function capabilityLocalName(id: string): string {
  const parts = id.split('\0');
  const local = parts.length >= 3 ? parts[2]! : id;
  // 展开 id 形如 `slot~entry`（多 endpoint）：adapter 名取 slot localName
  return local.split('~')[0]!;
}

/** Endpoint liveName (e.g. ICQQ uin, sandbox bot name) — first-class field, metadata fallback. */
function adapterLiveEndpointId(message: Message): string {
  if (message.endpointId) return message.endpointId;
  const live = String(message.metadata?.endpoint ?? message.metadata?.endpointKey ?? '');
  if (live) return live;
  return capabilityLocalName(String(message.conversation.endpoint.id));
}

/** Portfolio Sponsor Rooms require the Project to be explicit in typed control text. */
function sponsorRoomProjectId(content: string): string | undefined {
  const text = content.trim();
  const lifecycle = /^\/control\s+data-lifecycle\s+project\s+([a-z0-9][a-z0-9_-]{0,63})(?:\s|$)/iu.exec(text);
  if (lifecycle?.[1]) return lifecycle[1].toLowerCase();
  const portfolio = /^\/control\s+portfolio\s+\S+\s+project\s+([a-z0-9][a-z0-9_-]{0,63})(?:\s|$)/iu.exec(text);
  return portfolio?.[1]?.toLowerCase();
}

function catalogSpaceSourceDigest(
  projectId: string,
  space: 'workroom' | 'sponsor_room',
  configured: Readonly<{
    adapter: string;
    endpoint: string;
    kind: 'group' | 'channel' | 'repository';
    id: string;
    agent: string;
  }>,
): string {
  const binding = [
    projectId,
    configured.adapter,
    configured.endpoint,
    configured.kind,
    configured.id,
    configured.agent,
  ];
  return `sha256:${createHash('sha256').update(JSON.stringify(
    space === 'workroom' ? binding : [projectId, space, ...binding.slice(1)],
  )).digest('hex')}`;
}

function createSponsorProjectionControlTargetResolver(options: Readonly<{
  projectionRepository: Pick<FileWorkroomProjectionRepository, 'read'>;
  message: Message;
  intent: 'control';
}>): HumanIngressTargetResolverPort {
  return Object.freeze({
    async resolve(request: HumanIngressTargetResolutionRequest) {
      const resolverRef = 'sponsor-projection-message-index:v1';
      if (!options.message.replyTo) {
        return Object.freeze({
          ...request,
          status: 'unaddressed' as const,
          intent: options.intent,
          resolverRef,
          resolverDigest: digestInstallerValue({
            resolverRef,
            intent: options.intent,
            status: 'unaddressed',
          }),
        });
      }
      const messageKey = workroomProjectionMessageKey({
        conversation: options.message.conversation,
        id: options.message.replyTo.id,
      });
      const state = await options.projectionRepository.read();
      const entry = state.messageIndex[messageKey];
      if (!entry || entry.target.projectId !== request.decision.projectId
        || entry.bindingRevision !== request.decision.bindingRevision) {
        const candidateRefs = entry ? [entry.projectionId] : [];
        return Object.freeze({
          ...request,
          status: 'clarification_required' as const,
          intent: options.intent,
          resolverRef,
          resolverDigest: digestInstallerValue({
            resolverRef,
            intent: options.intent,
            status: 'clarification_required',
            messageKey,
            candidateRefs,
          }),
          reason: entry && entry.target.projectId !== request.decision.projectId
            ? 'cross_project_target' as const
            : 'target_not_found' as const,
          candidateRefs: Object.freeze(candidateRefs),
        });
      }
      const projectionReply = Object.freeze({
        version: 1 as const,
        projectionId: entry.projectionId,
        projectId: entry.target.projectId,
        bindingRevision: entry.bindingRevision,
        messageKey,
        targetDigest: digestInstallerValue(entry.target),
      });
      return Object.freeze({
        ...request,
        status: 'unaddressed' as const,
        intent: options.intent,
        resolverRef,
        resolverDigest: digestInstallerValue({
          resolverRef,
          intent: options.intent,
          status: 'unaddressed',
          projectionReply,
        }),
        projectionReply,
      });
    },
  });
}

function digestInstallerValue(value: unknown): string {
  return `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
}

function stringMetadata(metadata: Message['metadata'], key: string): string | undefined {
  const value = metadata?.[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function resolveChannelType(
  message: Message,
): 'private' | 'group' | 'channel' {
  return message.conversation.kind;
}

/**
 * 稳定发送者 ID：sender.id 是适配器从平台 API 传入的一等字段（稳定平台 ID），
 * metadata userId/user_id 降为 fallback（兼容尚未迁移的适配器）。
 */
function resolveStableSenderId(message: Message): string {
  return message.sender?.id ?? resolveAuthenticatedSenderId(message) ?? 'anon';
}

/**
 * Fallback sender identity from metadata. Only used when sender.id is absent
 * (legacy adapters that haven't migrated to MessageSenderRef).
 */
function resolveAuthenticatedSenderId(message: Message): string | undefined {
  for (const key of ['userId', 'user_id', 'senderId'] as const) {
    const value = message.metadata?.[key];
    if (value != null && String(value).trim()) return String(value);
  }
  return undefined;
}

function isClearCommand(content: string): boolean {
  const normalized = content.trim().toLowerCase();
  return normalized === 'clear'
    || normalized === '/clear'
    || normalized === '重置'
    || normalized === '清空';
}

async function loadBootstrap(projectRoot: string): Promise<string> {
  const parts: string[] = [];
  let total = 0;
  for (const name of BOOTSTRAP_FILES) {
    try {
      const raw = await readFile(join(projectRoot, name), 'utf8');
      const body = raw.trim();
      if (!body) continue;
      const chunk = truncate(body, Math.max(500, MAX_BOOTSTRAP_CHARS - total));
      parts.push(`## ${name}\n${chunk}`);
      total += chunk.length;
      if (total >= MAX_BOOTSTRAP_CHARS) break;
    } catch {
      /* missing bootstrap files are optional */
    }
  }
  return parts.join('\n\n');
}

async function readCapabilities(
  ingress: CapabilityIngress,
  snapshot: RuntimeSnapshot,
  requester: PluginId,
  message: Message,
  roles: RuntimeSenderRoles,
  isActive: () => boolean,
): Promise<AgentCapabilities> {
  return ingress.read(snapshot, requester, isActive, createRuntimeTurnAccess(message, roles));
}

export function runtimeApprovalPolicy(
  approval: ToolCapability['approval'],
): 'never' | 'always' | 'once' | 'on-risk' {
  return approval;
}

/** A small non-interactive ApprovalPort suitable for CLI/service hosts and tests. */
export function createDeterministicApprovalPort(
  decision: 'approve' | 'deny' = 'deny',
): ApprovalPort {
  return {
    available: true,
    requestApproval: async () => decision === 'approve',
  };
}

function parseMcpServers(raw: AIConfig['mcpServers']): McpServerEntry[] {
  if (raw == null) return [];
  if (!Array.isArray(raw)) throw new TypeError('ai.mcpServers must be an array');
  return raw.map((item, index) => {
    const entry = toMcpServerEntry(item);
    if (!entry) throw new TypeError(`Invalid ai.mcpServers[${index}] declaration`);
    return entry;
  });
}

function toMcpServerEntry(raw: McpServerConfig): McpServerEntry | null {
  if (!raw || typeof raw.name !== 'string' || !raw.name.trim()) return null;
  const transport = raw.transport;
  if (transport !== 'stdio' && transport !== 'streamable-http' && transport !== 'sse') return null;
  if (transport === 'stdio') {
    if (!raw.command?.trim()) return null;
  } else if (!raw.url?.trim()) {
    return null;
  }
  return {
    name: raw.name.trim(),
    transport,
    url: raw.url,
    command: raw.command,
    args: raw.args,
    env: raw.env,
    headers: raw.headers,
  };
}

function completedOutput(
  outcome: TurnOutcome,
): Array<Extract<TurnOutcome, { status: 'completed' }>['output'][number]> {
  if (outcome.status === 'completed') return [...outcome.output];
  if (outcome.status === 'cancelled') {
    throw new Error(`Agent turn cancelled: ${outcome.reason}`);
  }
  if (outcome.status === 'budget_exceeded') {
    throw new Error(`Agent turn exceeded budget: ${outcome.budget}`);
  }
  throw new Error(`${outcome.error.code}: ${outcome.error.message}`);
}

async function preprocessInboundTurn(
  message: Message,
  content: string,
  transcribeUrl?: (audioUrl: string) => Promise<string | null>,
): Promise<{ readonly text: string; readonly sttApplied: boolean }> {
  const audioUrl = resolveInboundAudioUrl(message);
  if (!audioUrl || !transcribeUrl) {
    return { text: stripAudioPlaceholders(content), sttApplied: false };
  }
  const transcript = await transcribeUrl(audioUrl);
  if (!transcript) {
    return { text: stripAudioPlaceholders(content) || content, sttApplied: false };
  }
  const rest = stripAudioPlaceholders(content).trim();
  const text = rest ? `${rest}\n${transcript}` : transcript;
  return { text, sttApplied: true };
}

function resolveInboundAudioUrl(
  message: Message,
): string | undefined {
  if (message.segments) {
    for (const seg of message.segments) {
      if (seg.type === 'audio' || seg.type === 'record') {
        const media = seg.data?.media as { kind?: string; value?: string } | undefined;
        if (media?.kind === 'url' && typeof media.value === 'string' && media.value.trim()) {
          return media.value.trim();
        }
        const d = seg.data as Record<string, unknown> | undefined;
        const url = d?.url ?? d?.src ?? d?.file;
        if (typeof url === 'string' && url.trim()) return url.trim();
      }
    }
  }
  const fromMeta = message.metadata?.audio_url;
  if (typeof fromMeta === 'string' && fromMeta.trim()) return fromMeta.trim();
  const match = message.content.match(/\[audio:([^\]]+)\]/u);
  const fromContent = match?.[1]?.trim();
  return fromContent || undefined;
}

function stripAudioPlaceholders(content: string): string {
  return content.replace(/\[audio:[^\]]*\]/gu, '').trim();
}

function routeSpecialistAgent(
  userText: string,
  capabilities: AgentCapabilities,
): { readonly userText: string; readonly agent?: AgentCapabilities['agents'][number] } {
  const match = userText.match(/^@([^\s:：]+)[:：]?\s*/u);
  if (!match) return { userText };
  const name = match[1]!.toLowerCase();
  const agent = capabilities.agents.find((item) => item.name.toLowerCase() === name);
  if (!agent) return { userText };
  return { userText: userText.slice(match[0].length).trim() || userText, agent };
}

/**
 * 默认值与 legacy `DEFAULT_AI_TRIGGER_CONFIG`
 * （packages/im/core/src/built/ai-trigger.ts）对齐。
 */
const DEFAULT_AI_TRIGGER_PREFIXES = ['#', 'AI:', 'ai:'];
const DEFAULT_AI_TRIGGER_IGNORE_PREFIXES = ['/', '!', '！'];

/**
 * 新 Plugin Runtime 的 AI 触发判定，对齐 legacy `shouldTriggerAI` 的顺序：
 * ignorePrefixes → 前缀 → @(群/频道，metadata.mentioned) → 私聊 → 关键词(仅单人会话)。
 *
 * 与 legacy 的差异：Runtime Message.content 为纯文本，at 信息由适配器经
 * `metadata.mentioned: true` 标注（icqq 扫 CQ 码、QQ 官方看 AT 事件、slack 看
 * app_mention）；且前缀触发对群聊同样生效（test-bot 群聊依赖 `ai:` 前缀，
 * legacy 群/频道仅 @ 触发）。
 */
export function matchAiTrigger(
  message: Message,
  trigger: AITriggerConfig | undefined,
): { content: string } | null {
  if (trigger && trigger.enabled === false) return null;
  const text = message.content.trim();
  if (!text) return null;

  // 0. 忽略前缀（命令前缀，避免与命令冲突）
  const ignorePrefixes = trigger?.ignorePrefixes?.length
    ? trigger.ignorePrefixes
    : DEFAULT_AI_TRIGGER_IGNORE_PREFIXES;
  for (const prefix of ignorePrefixes) {
    if (prefix && text.startsWith(prefix)) return null;
  }

  const isPrivate = isPrivateRuntimeMessage(message);

  // 1. 前缀触发（与 legacy 差异：群聊同样生效，见 docs/advanced/ai.md）
  const prefixes = trigger?.prefixes?.length ? trigger.prefixes : DEFAULT_AI_TRIGGER_PREFIXES;
  for (const prefix of prefixes) {
    if (!prefix) continue;
    if (text.startsWith(prefix)) {
      const content = text.slice(prefix.length).trim();
      return content ? { content } : null;
    }
  }

  // 2. @ 触发（群/频道主路径；剥离提及后为空也触发，与 legacy 一致）
  const respondToAt = trigger?.respondToAt !== false;
  if (respondToAt && !isPrivate && (message.mentioned === true || message.metadata?.mentioned === true)) {
    return { content: stripMentionMarkup(text) };
  }

  // 3. 私聊直接对话
  const respondToPrivate = trigger?.respondToPrivate !== false;
  if (respondToPrivate && isPrivate) {
    return { content: text };
  }

  // 4. 关键词触发（仅私聊等单人会话，避免群聊旁听误触发，与 legacy 一致）
  const keywords = trigger?.keywords ?? [];
  if (isPrivate && keywords.length > 0) {
    const lowerText = text.toLowerCase();
    for (const keyword of keywords) {
      if (keyword && lowerText.includes(keyword.toLowerCase())) {
        return { content: text };
      }
    }
  }

  return null;
}

/** 剥离 @ 触发后残留的提及标记：icqq CQ 码、QQ 官方/频道与 Slack 的 `<@!id>`。 */
function stripMentionMarkup(text: string): string {
  return text
    .replace(/\[CQ:(?:at|mention),[^\]]*\]/giu, '')
    .replace(/<@!?[^>\s]+>/gu, '')
    .replace(/\[(?:at|mention):[^\]]*\]/giu, '')
    .trim();
}

function isPrivateRuntimeMessage(message: Message): boolean {
  return message.conversation.kind === 'private';
}

function flattenOutputElements(elements: readonly OutputElementLike[]): string {
  const parts: string[] = [];
  for (const el of elements) {
    switch (el.type) {
      case 'text':
        if (el.content) parts.push(el.content);
        break;
      case 'image':
        parts.push(el.url ? `[image:${el.url}]` : '[image]');
        break;
      case 'audio':
        parts.push(el.fallbackText || (el.url ? `[audio:${el.url}]` : '[audio]'));
        break;
      case 'video':
        parts.push(el.fallbackText || (el.url ? `[video:${el.url}]` : '[video]'));
        break;
      case 'card': {
        const card = [el.title ?? 'card'];
        if (el.description) card.push(el.description);
        parts.push(card.join('\n'));
        break;
      }
      case 'file':
        parts.push(el.url ? `${el.name ?? 'file'}: ${el.url}` : (el.name ?? '[file]'));
        break;
    }
  }
  return parts.join('\n');
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, Math.max(0, max - 1))}…`;
}

async function readConfigDocument(
  config: RuntimeConfigDocument | ConfigDocumentPort,
): Promise<unknown> {
  if (!isConfigDocumentPort(config)) return config;
  return (await config.read()).document;
}

function isConfigDocumentPort(value: unknown): value is ConfigDocumentPort {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<ConfigDocumentPort>;
  return typeof candidate.read === 'function';
}
