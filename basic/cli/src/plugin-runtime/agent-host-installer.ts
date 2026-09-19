import { readFile } from 'node:fs/promises';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { formatCompact, getLogger } from '@zhin.js/logger';
import { type AITriggerConfig, type Tool } from '@zhin.js/core';
import {
  ingressRouteToken,
  outboundMessageToken,
  type ImRuntime,
  type Message,
  type SendContent,
} from '@zhin.js/core/runtime';
import type { RootResourceInstaller } from '@zhin.js/runtime';
import { databaseRootHostToken, rootPluginId, type DisposeStack, type PluginId, type RuntimeSnapshot, type SnapshotReader } from '@zhin.js/plugin-runtime';
import {
  AIService,
  AgentResourceHub,
  ActivatableWorkroomJournal,
  FileWorkroomJournal,
  ActivatableWorkroomCatalog,
  FileWorkroomCatalog,
  WorkroomKernel,
  createCatalogWorkroomRunControlAuthority,
  handleRuntimeManagementCommand,
  publishOutboundElements,
  type AssistantConfig,
  type ApprovalPort,
  type AudioTranscriptionPort,
  type TurnRequest,
  type WorkroomDefinition,
  type WorkroomMemberRole,
  FileJournalStore,
  resolveWorkroomBotIdentity,
  workroomProjectionBindingKey,
  FileHumanIngressProposalRepository,
  FileHumanIngressApplicationRepository,
  HumanIngressApplicationService,
  type HumanIngressOrchestratorProposalPort,
  WorkroomPlanningClarificationError,
  type WorkroomPlanGateAuthorityPort,
  ConversationEventHumanIngressSourceReader,
  ProductionHumanIngressOrchestratorPort,
  createPlanGateHumanIngressControlPort,
  FileInteractionSpaceBindingRepository,
  InteractionSpaceRouter,
  FileWorkroomProjectionRepository,
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
  createWorkroomRoleCapabilitySnapshot,
  createAssignmentExecutionEnvelope,
  type WorkroomPreemptionState,
  createWorkroomSchedulerPolicySnapshot,
} from '@zhin.js/agent';
import {
  agentHostToken,
  agentEventBusToken,
  CapabilityIngress,
  projectHostTool,
  projectHostMcp,
  toolFeatureId,
  turnJournalStoreToken,
  agentTurnEngineToken,
  createFullAgentTurnEngine,
  createNativeAgentToolSuite,
  MarkdownKnowledgeIndex,
  createNativeTodoToolFeatures,
  createNativeInteractionToolFeatures,
  createNativeSemanticMemoryToolFeatures,
  SemanticMemoryRuntime,
  FileTodoStore,
  AgentRuntime,
  ZhinAgent,
  composeZhinAgentRuntime,
  activateAiDatabaseStorage,
  defineAiDatabaseModels,
  createAgentTraceRuntime,
  createCatalogGovernedWorkroomProjectionAuthority,
  createCatalogGovernedConsoleDisclosureAuthority,
  createGovernedPortfolioSponsorProjectionReader,
  createWorkroomRuntime,
  createSessionTreeRuntimeFromAgent,
  type AgentCapabilities,
  type WorkroomRuntimeHandle,
  type WorkroomRunControlCommand,
  type SessionTreeRuntimeHandle,
  type TurnIntentResolver,
  createGenerationWorkroomAcceptancePolicyPort,
  workroomAcceptancePolicyDecisionToken,
  createGenerationWorkroomAcceptanceAuthority,
  workroomAcceptanceAuthorityToken,
  createCatalogWorkroomPlanGateAuthority,
  createGenerationWorkroomPlanGateAuthority,
  workroomPlanGateAuthorityToken,
  CatalogWorkroomPriorityAuthority,
  GenerationWorkroomPriorityAuthority,
  workroomPriorityAuthorityToken,
  createGenerationHumanIngressPlanningPort,
  createGenerationOwnedDynamicPlanningProvider,
  createWorkroomDynamicPlanningGenerationSnapshot,
  createWorkroomDynamicPlanningPolicySnapshot,
  createCapabilityPackManifest,
  createWorkroomProfileOverlay,
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
  createWorkroomProjectionOutboundMessageServicePort,
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
  type WorkroomGenerationAuthoritySnapshot,
  WorkroomLocalAssignmentRuntime,
  LocalAssignmentExecutor,
  workroomLocalAssignmentRuntimeToken,
  PinnedProfileCatalogLocalAssignmentRoute,
  DurableReportLocalModelExecutionPort,
  workroomEvidencePayloadWriterToken,
  workroomTaskReportPayloadToken,
  type WorkroomEvidencePayloadWriteInput,
  createAgentCoreWorkroomLocalTurnPort,
  structuredTaskReportPrompt,
  bindWorkroomCapabilityRealization,
  installWorkroomDataGovernanceResources,
  createWorkroomDataGovernanceBootstrapCandidate,
  WorkroomDataGovernanceAuthorityWriter,
  digestWorkroomCatalogProjectBinding,
  resolveWorkroomDataGovernanceRootAuthorities,
  createGenerationOwnedWorkroomDataGovernanceStorage,
  assertAcceptanceProjectionDataGovernanceAuthority,
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
  type WorkroomPlanningBootstrapCommand,
  type WorkroomPlanningSetupStatus,
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
  createSelfDeliveryProjectForHost,
  createSelfDeliveryAssignmentExecutor,
  workroomDeliveryProviderToken,
  selfDeliveryProjectToken,
  type SelfDeliveryHostConfiguration,
} from '@zhin.js/agent/runtime';
import type { LocalWorkroomDataGovernanceAuthority } from './local-workroom-data-governance.js';
import {
  createLocalWorkroomAssignmentGrantProvider,
  installLocalWorkroomPortfolioAuthorities,
  LOCAL_WORKROOM_RESOURCE_REQUIREMENTS,
} from './local-workroom-portfolio.js';

export { AgentRuntime, AgentTurnCoordinator } from '@zhin.js/agent/runtime';

import { conversationRefKey } from '@zhin.js/im-contract';
import { resolveSandboxTurnPolicy } from './sandbox-turn-policy.js';
import {
  WorkroomHumanIngressPreRoute,
  createCatalogWorkroomSpace,
  resolveWorkroomHumanIntent,
  type WorkroomAgentTurnContinuation,
} from './workroom-human-ingress-route.js';
import {
  assertWorkroomCatalogMatchesGeneration,
  catalogSpaceSourceDigest,
  classifyWorkroomIngressSource,
  createSponsorProjectionControlTargetResolver,
  ensureCatalogWorkroomProjectionBinding,
  resolveCatalogSponsorProjectionConversation,
  resolveCatalogWorkroomProjectionConversation,
  resolveIndexedProjectionReply,
  sponsorRoomProjectId,
} from './workroom-projection.js';
import {
  renderTriggerError,
  resolveRuntimeAgentTrigger,
  resolveTriggerTimeoutMs,
  resolveWorkroomOrchestratorConversation,
  restrictWorkroomAgentCapabilities,
  routeSpecialistAgent,
  withTriggerTimeout,
  workroomOrchestratorSessionKey,
} from './agent-turn-trigger.js';
import {
  adapterLiveEndpointId,
  capabilityLocalName,
  createRuntimeApprovalPort,
  createRuntimeQuestionPort,
  createRuntimeTurnAccess,
  createRuntimeTurnRequest,
  deliveryOutcomeFromReceipt,
  interactiveNetworkPolicy,
  resolveOwnerForRuntimeMessage,
  resolveProductTurnIntent,
  resolveRuntimeSenderRoles,
  resolveSnapshotTurnIntentResolver,
  resolveTrustedForRuntimeMessage,
  runtimeImSessionKey,
  type RuntimeSenderRoles,
} from './agent-turn-request.js';
import {
  createRuntimeZhinAgent,
  observeAgentTurnTrace,
} from './agent-runtime-factory.js';
import {
  createAssistantHomeRuntime,
  createAssistantScheduleRuntime,
} from './assistant-runtime.js';
import {
  assertFixedWorkroomStorageMode,
  assessWorkroomDisclosureSetup,
  isWorkroomPlanningPolicyReady,
  resolveAgentHostMcpServers,
  resolveAgentHostKnowledgeDirectory,
  resolveAssistantConfigDocument,
  resolveWorkroomDisclosureAuthorityPublication,
  resolveWorkroomDisclosureBootstrap,
  resolveWorkroomPlanningPolicyPublication,
  resolveWorkroomStorageMode,
  type AgentHostAIConfig as AIConfig,
  type WorkroomStorageMode,
} from './agent-host-config.js';
import {
  createWorkroomBootstrapAcceptancePolicy,
  createWorkroomPlanningBootstrapArtifacts,
} from './workroom-planning-bootstrap.js';
import {
  completedOutput,
  flattenOutputElements,
  isClearCommand,
  preprocessInboundTurn,
  resolveStableSenderId,
  stringMetadata,
} from './agent-turn-content.js';

const WORKROOM_DYNAMIC_PLANNING_SYSTEM_PROMPT = `You produce one untrusted Workroom DAG candidate as strict JSON.
Return exactly: {"version":1,"strategy":{"id":"...","version":"...","digest":"sha256:..."},"tasks":[...]}
Each task must contain exactly: key, title, role, required, maxAttempts, localRank, dependsOn, requires, approval.
requires must contain exactly tools, skills, integrations, authorities arrays. approval is "none" or "sponsor_required".
Copy every requirement only from the matching supplied capability array: tools from tools, skills from skills, integrations from integrations, and authorities from authorities. Never classify a skill as a tool.
Use only the supplied strategies, roles, capabilities and constraints. Include at least one required task.
Do not output markdown, commentary, identity, authority, Project state, Sponsor lane, deadline, policy, assignment, or execution state.`;

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

const logger = getLogger('agent');
const BOOTSTRAP_FILES = ['SOUL.md', 'AGENTS.md', 'TOOLS.md'] as const;
const MAX_BOOTSTRAP_CHARS = 12_000;

export interface InstallAgentHostOptions {
  /** Root-private self-delivery authentication/integration configuration. Never accepts model-supplied policy. */
  readonly selfDelivery?: SelfDeliveryHostConfiguration;
  /** Process-owned execution authority attached to exactly one Root. */
  readonly runtime: AgentRuntime;
  /** Process-owned Snapshot reader; local Assignment operations hold an exact generation lease. */
  readonly snapshots?: SnapshotReader;
  /** Process-fixed Workroom storage identity. Changing it requires restart. */
  readonly workroomStorageMode: WorkroomStorageMode;
  readonly im: ImRuntime;
  readonly projectRoot: string;
  /**
   * Resolve Endpoint Owner id for `/approve` + bashAlways key.
   * Key: `localName` (e.g. icqq) or live endpoint name (uin).
   */
  readonly resolveEndpointOwner?: (adapterLocalName: string, endpointKey: string) => string | undefined;
  /**
   * Resolve Endpoint trusted id 列表（plugins.<key>.trusted / endpoints[].trusted）。
   * trusted 角色弱于 master，不参与 Owner 审批放行。
   */
  readonly resolveEndpointTrusted?: (adapterLocalName: string, endpointKey: string) => readonly string[];
  /** Candidate config Endpoint identities; never read from the old live ImRuntime projection. */
  readonly resolveConfiguredEndpointKeys?: () => Promise<ReadonlySet<string>>;
  /** Extra Host tools (e.g. Speech Host voice_stt / voice_tts). */
  readonly extraTools?: readonly AgentToolLike[];
  /** Optional inbound STT (Speech Host). */
  readonly transcribeUrl?: (audioUrl: string) => Promise<string | null>;
  /** Owner-scoped STT boundary for canonical turn media. */
  readonly audioTranscriber?: AudioTranscriptionPort;
  /** Optional host approval override; IM turns otherwise use createRuntimeApprovalPort. */
  readonly approvalPort?: ApprovalPort;
  /** Trusted product-policy seam for explicit steer/follow-up/observe intent and authorization. */
  readonly resolveTurnIntent?: TurnIntentResolver;
  /** Trusted idempotent Orchestrator/Kernel proposal seam for Workroom human ingress. */
  readonly workroomHumanIngressPort?: HumanIngressOrchestratorProposalPort;
  /** P12 governed model-provider disclosure; absence fails closed before model invocation. */
  readonly workroomPlanningDisclosurePort?: WorkroomPlanningDisclosurePort;
  /** Persistent exact Project/Profile planning policy; absence fails closed. */
  readonly workroomDynamicPlanningPolicyPort?: WorkroomDynamicPlanningPolicyPort;
  /** Authenticated Sponsor authority for typed pre-execution Plan Gate decisions. */
  readonly workroomPlanGateAuthority?: WorkroomPlanGateAuthorityPort;
  /** Process-owned shared Pack publisher membership; never accepted from HTTP request bodies. */
  readonly workroomTrustedPackPublishers?: readonly string[];
  /** Self-hosted Root-private KMS and signed governance decision issuer. */
  readonly workroomLocalDataGovernance?: LocalWorkroomDataGovernanceAuthority;
}

/**
 * Plugin Runtime Agent Host:
 * - AIService from top-level `ai`
 * - Command miss → `ai:` trigger → **ZhinAgent.process** (inbound queue + session)
 * - CapabilityIngress tools + `ai.mcpServers` + SOUL/AGENTS/TOOLS bootstrap
 * - SubagentSystem + `spawn_task` (parallel sub-agents) + deferred meta tools
 * - Optional inbound STT / `@agent` specialist prompt injection
 * - generation-owned Hook resources / `aiHookRuntimeBus`, ScheduleJobEngine + `schedule_*`
 * - Assistant profile sync + Event Ingress registry (HTTP via Console API)
 * - Subagent/main-turn `bash` (sandbox + safety) + Owner `/approve` 命令面
 */
export function installAgentHost(options: InstallAgentHostOptions): RootResourceInstaller {
  return async ({ generation, signal, resources, lifecycle, handoff, config: primaryConfig, addFeature }) => {
    const aiConfig = primaryConfig.get<AIConfig>('ai');
    const assistantConfig = primaryConfig.get<AssistantConfig>('assistant');
    if (!aiConfig || typeof aiConfig !== 'object') return;
    const mcpEntries = resolveAgentHostMcpServers(aiConfig);
    const knowledgeDirectory = resolveAgentHostKnowledgeDirectory(aiConfig, options.projectRoot);
    const knowledgeIndex = knowledgeDirectory
      ? new MarkdownKnowledgeIndex(knowledgeDirectory)
      : undefined;

    let service: AIService;
    try {
      service = new AIService(aiConfig);
    } catch (error) {
      throw new Error('Agent Host rejected invalid AI configuration', { cause: error });
    }
    if (!service.isReady()) {
      await service.dispose();
      throw new Error('Agent Host requires at least one ready AI provider');
    }
    if (!service.getBindingRegistry().getBinding('zhin')) {
      await service.dispose();
      throw new Error('Agent Host requires a ready ai.agents.zhin binding');
    }
    lifecycle.add(() => service.dispose());
    const listGenerationBindings = () => Object.freeze(
      service.getBindingRegistry().listAgentNames()
        .map((name) => service.getBindingRegistry().getBinding(name))
        .filter((entry): entry is NonNullable<typeof entry> => entry != null)
        .map((entry) => Object.freeze({ ...entry, mcpServers: [...entry.mcpServers] })),
    );
    let zhinAgent: ZhinAgent | undefined;
    let composedRuntime: ReturnType<typeof composeZhinAgentRuntime> | undefined;
    let seedPresets: () => Promise<number>;
    let scheduleTools: ReturnType<typeof createAssistantScheduleRuntime>['tools'] = [];
    let homeTools: Awaited<ReturnType<typeof createAssistantHomeRuntime>>['tools'] = [];
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
        new CatalogWorkroomPriorityAuthority(workroomCatalog),
      );
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
      priorityAuthority: new GenerationWorkroomPriorityAuthority(() =>
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
        await options.resolveConfiguredEndpointKeys?.(),
      );
    };
    let workroomRuntime: WorkroomRuntimeHandle;
    let consoleProjectionAuthority: ReturnType<typeof createCatalogGovernedWorkroomProjectionAuthority>;
    const dataGovernanceRuntimeRef: {
      current?: ReturnType<typeof installWorkroomDataGovernanceResources>;
    } = {};
    let sessionTreeRuntime: SessionTreeRuntimeHandle;
    const traceRuntime = createAgentTraceRuntime();
    const rememberedSandboxApprovals = new Map<string, Set<string>>();
    let schedule: ReturnType<typeof createAssistantScheduleRuntime>;
    try {
      const created = createRuntimeZhinAgent(
        service,
        options.im,
        options.projectRoot,
        options.approvalPort,
        options.audioTranscriber,
        knowledgeIndex,
      );
      zhinAgent = created.agent;
      composedRuntime = created.runtime;
      lifecycle.add(() => created.agent.dispose());
      lifecycle.add(() => created.events.clear());
      resources.provide(agentEventBusToken, created.events);
      seedPresets = created.seedPresets;

      // Console reads the same replayed facts as tools; it never receives the
      // command authority or a mutable repository.
      consoleProjectionAuthority = createCatalogGovernedWorkroomProjectionAuthority({
        catalog: workroomCatalog,
        governance: Object.freeze({
          readProject: async (projectId: string) =>
            await dataGovernanceRuntimeRef.current?.options.repository.readProject(projectId),
        }),
      });
      workroomRuntime = createWorkroomRuntime(workroomJournal, consoleProjectionAuthority);
      sessionTreeRuntime = createSessionTreeRuntimeFromAgent(composedRuntime.host);
      schedule = createAssistantScheduleRuntime(
        zhinAgent,
        service,
        options.runtime,
        options.im,
        options.projectRoot,
        assistantConfig,
        traceRuntime,
      );
      scheduleTools = schedule.tools;
      assistantEnabled = schedule.assistantEnabled;
      lifecycle.add(schedule.dispose);

      const home = await createAssistantHomeRuntime(
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
                await options.resolveConfiguredEndpointKeys?.(),
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
    // Host-provided tools join the same candidate ToolFeature projection.
    for (const tool of options.extraTools ?? []) {
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
    for (const tool of createNativeAgentToolSuite({
      resolveProvider: (alias) => service.getProvider(alias),
      resolveImageDefaults: (alias) => service.getImageGenerationDefaults(alias),
      knowledgeIndex,
    })) {
      addFeature(toolFeatureId, tool.name, tool.definition);
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
          }, observeAgentTurnTrace(traceRuntime, request));
        },
      }),
      introspection: Object.freeze({
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
      host: composedRuntime.host,
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
    const localDataGovernance = rootDataGovernance
      ? undefined
      : options.workroomLocalDataGovernance;
    const dataGovernanceCryptography = rootDataGovernance?.cryptography
      ?? localDataGovernance?.cryptography;
    const dataGovernanceVerification = rootDataGovernance?.governance
      ?? localDataGovernance?.verification;
    if (dataGovernanceCryptography) {
      dataGovernanceStorage = createGenerationOwnedWorkroomDataGovernanceStorage({
        stateRoot: workroomStateRoot,
        generation,
        cryptography: dataGovernanceCryptography,
      });
      if (!useDatabase) await dataGovernanceStorage.activateFile();
    }
    const lifecycleAuthorities = rootDataGovernance?.lifecycle
      ?? localDataGovernance?.lifecycle;
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
      ...(dataGovernanceCryptography ? { cryptography: dataGovernanceCryptography } : {}),
      ...(dataGovernanceVerification ? { governance: dataGovernanceVerification } : {}),
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
            const verification = workroomJournal.verifyGovernedPayloadPublication
              ? await workroomJournal.verifyGovernedPayloadPublication(intent)
              : Object.freeze({ status: 'unknown' as const });
            return verification.status === 'missing'
              ? Object.freeze({ status: 'unknown' as const })
              : verification;
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
    if (options.selfDelivery) {
      if (options.selfDelivery.deliveryProvider) {
        if (resources.has(workroomDeliveryProviderToken)) throw new Error('Self-delivery Delivery provider conflicts with existing Host provider');
        resources.provide(workroomDeliveryProviderToken, options.selfDelivery.deliveryProvider);
      }
      resources.provide(selfDeliveryProjectToken, createSelfDeliveryProjectForHost({
        directory: join(workroomStateRoot, 'self-delivery-issues'),
        configuration: options.selfDelivery,
        kernel: workroomKernel,
        catalog: workroomCatalog,
        profiles: projectProfiles,
        pins: profileRunPinWriter,
        signal,
      }));
    }
    const acceptanceProfileSource = new PinnedProfileWorkroomAcceptanceProjectionSource({
      profiles: projectProfiles,
      catalog: workroomCatalog,
    });
    if (!resources.has(workroomAcceptanceProjectionSourceAuthorityToken)) {
      resources.provide(workroomAcceptanceProjectionSourceAuthorityToken, acceptanceProfileSource);
    }
    const trustedPackPublishers = new Set(options.workroomTrustedPackPublishers ?? []);
    const resolveDisclosureBootstrap = (definition: WorkroomDefinition | undefined) =>
      resolveWorkroomDisclosureBootstrap(
        definition,
        agentId => service.getBindingRegistry().getBinding(agentId)?.providerAlias,
        aiConfig,
      );
    const ensureDisclosureAuthority = async (input: Readonly<{
      projectId: string;
      catalogRevision: string;
      definition: WorkroomDefinition;
      principalId: string;
    }>): Promise<void> => {
      const repository = dataGovernanceRuntime.options.repository;
      const current = await repository.readProject(input.projectId);
      const currentAuthorization = await consoleProjectionAuthority.authorize({
        destination: 'console',
        projectId: input.projectId,
        recipientPrincipalId: input.principalId,
        requestedMode: 'metadata_only',
      });
      let acceptanceProjectionAuthorityCurrent = current !== undefined;
      if (current) {
        try {
          assertAcceptanceProjectionDataGovernanceAuthority(current);
        } catch {
          acceptanceProjectionAuthorityCurrent = false;
        }
      }
      const publication = resolveWorkroomDisclosureAuthorityPublication(
        current,
        currentAuthorization !== null && acceptanceProjectionAuthorityCurrent,
      );
      if (!publication) return;
      if (!localDataGovernance) {
        throw new Error('Workroom 披露初始化缺少 Root-private Data Governance 签发能力');
      }
      const { modelProviderAlias, contract } = resolveDisclosureBootstrap(input.definition);
      if (!modelProviderAlias) {
        throw new Error('Workroom orchestrator 没有可用的 ai.agents model binding');
      }
      if (!contract) {
        throw new Error(`请先配置 ai.workroom.disclosure.modelProviders.${modelProviderAlias}`);
      }
      const candidate = createWorkroomDataGovernanceBootstrapCandidate({
        projectId: input.projectId,
        tenantId: aiConfig.workroom?.disclosure?.tenantId ?? `workroom:${input.projectId}`,
        definition: input.definition,
        revision: publication.revision,
        ...(publication.previousDigest ? { previousDigest: publication.previousDigest } : {}),
        model: {
          providerId: modelProviderAlias,
          endpoint: contract.endpoint,
          ...(contract.owner ? { owner: contract.owner } : {}),
          ...(contract.trustDomain ? { trustDomain: contract.trustDomain } : {}),
          processingRegions: contract.processingRegions,
          maxConfidentiality: contract.maxConfidentiality,
          external: contract.external,
          noTraining: contract.noTraining,
          loggingMode: contract.loggingMode,
          maximumRetentionSeconds: contract.maximumRetentionSeconds,
          allowsRedisclosure: contract.allowsRedisclosure,
          supportsDeletion: contract.supportsDeletion,
        },
      });
      const writer = new WorkroomDataGovernanceAuthorityWriter({
        catalog: workroomCatalog,
        repository,
        decisions: Object.freeze({
          authorize: async (
            decisionInput: Parameters<ConstructorParameters<
              typeof WorkroomDataGovernanceAuthorityWriter
            >[0]['decisions']['authorize']>[0],
            operationSignal: AbortSignal,
          ) =>
            await localDataGovernance.issuePublicationDecision({
              ...decisionInput,
              principalId: input.principalId,
              authorizedBy: 'sponsor',
            }, operationSignal),
        }),
      });
      await writer.publish({
        catalogRevision: input.catalogRevision,
        catalogBindingDigest: digestWorkroomCatalogProjectBinding(input.definition),
        candidate,
      }, signal);
    };
    const readPlanningSetupStatus = async (
      projectId: string,
      authenticatedPrincipal?: Readonly<{ principalId: string }>,
    ): Promise<WorkroomPlanningSetupStatus> => {
      const [catalog, profiles] = await Promise.all([
        workroomCatalog.read(),
        projectProfiles.read(projectId),
      ]);
      const definition = catalog.definitions[projectId];
      const principalId = authenticatedPrincipal?.principalId;
      const lease = options.snapshots!.acquire();
      try {
        if (lease.value.generation !== generation) {
          throw new Error('Workroom Planning setup targets another Root generation');
        }
        const supply = createWorkroomGenerationAuthoritySnapshotFromRuntime(
          lease.value,
          listGenerationBindings(),
        );
        const availableAgents = supply.agents.map(agent => agent.id).sort();
        const availableTools = supply.tools.map(tool => tool.name).sort();
        const availableSkills = supply.skills.map(skill => skill.name).sort();
        const diagnostics: string[] = [];
        const trustedPackPublisher = principalId !== undefined && trustedPackPublishers.has(principalId);
        const projectSponsor = principalId !== undefined && definition?.sponsors?.includes(principalId) === true;
        if (!principalId) diagnostics.push('当前 Console token 未绑定 principalId');
        else {
          if (!trustedPackPublisher) diagnostics.push(`principal ${principalId} 不在 ai.workroom.trustedPackPublishers`);
          if (!projectSponsor) diagnostics.push(`principal ${principalId} 不在 Project sponsors`);
        }
        let catalogReady = definition !== undefined && definition.enabled !== false
          && definition.conversation !== undefined;
        if (!definition) diagnostics.push(`Workroom Project ${projectId} 不存在`);
        else {
          if (definition.enabled === false) diagnostics.push(`Workroom Project ${projectId} 已停用`);
          if (!definition.conversation) diagnostics.push('Project 尚未绑定 Workroom conversation');
          const rolesByAgent = new Map<string, Set<string>>();
          for (const member of definition.members) {
            const roles = rolesByAgent.get(member.agent) ?? new Set<string>();
            roles.add(member.role);
            rolesByAgent.set(member.agent, roles);
            if (!availableAgents.includes(member.agent)) {
              diagnostics.push(`成员 ${member.agent} 没有对应的 ai.agents binding`);
              catalogReady = false;
            }
          }
          for (const [agent, roles] of rolesByAgent) {
            if (roles.size > 1) {
              diagnostics.push(`成员 ${agent} 同时承担 ${[...roles].sort().join('/')}；每个 Workroom 角色需要独立 Agent binding`);
              catalogReady = false;
            }
          }
          const orchestrator = definition.members.find(member => member.role === 'orchestrator'
            && member.agent === definition.conversation?.agent);
          if (!orchestrator) {
            diagnostics.push('conversation.agent 必须对应唯一 orchestrator 成员');
            catalogReady = false;
          }
        }
        const active = profiles.active;
        const activeRevision = active ? profiles.revisions[active.revisionId] : undefined;
        if (!active || !activeRevision) diagnostics.push('尚未发布并激活 Project Profile');
        let planningPolicyReady = false;
        let acceptancePolicyReady = false;
        if (definition && active && activeRevision) {
          const profile = activeRevision.compiledProfile;
          const acceptance = profile.acceptancePolicies ?? [];
          acceptancePolicyReady = acceptance.length === 1
            && profile.workflows.every(workflow => workflow.tasks.every(task =>
              acceptance[0]!.tasks.some(policyTask => policyTask.taskKey === task.key)));
          if (!acceptancePolicyReady) {
            diagnostics.push('active Profile 尚未绑定覆盖 Workflow Task 的 Acceptance Policy');
          }
          const authority = await profileComposition.planningPolicy.resolve({
            version: 1,
            generation: createWorkroomDynamicPlanningGenerationSnapshot(generation),
            projectId,
            catalogRevision: catalog.revision,
            projectDigest: digestWorkroomProfileCatalogProject(definition),
            profile: {
              revisionId: active.revisionId,
              digest: active.compiledDigest,
              strategies: profile.workflows.map(workflow => ({
                id: workflow.id,
                version: active.revisionId,
                digest: workflow.digest,
              })),
              roles: [...new Set(profile.agents.map(agent => agent.role))].sort(),
              capabilities: {
                tools: profile.tools.map(tool => tool.id).sort(),
                skills: profile.skills.map(skill => skill.id).sort(),
                integrations: [],
                authorities: [],
              },
            },
          });
          planningPolicyReady = isWorkroomPlanningPolicyReady(authority);
          if (!authority) diagnostics.push('active Profile 尚未绑定 Planning Policy');
          else if (!planningPolicyReady) {
            diagnostics.push('active Planning Policy 的 Scheduler 序列锚点已过期');
          }
        }
        const { modelProviderAlias, contract } = resolveDisclosureBootstrap(definition);
        const disclosureAuthority = await dataGovernanceRuntime.options.repository.readProject(projectId);
        const disclosureAuthorization = principalId
          ? await consoleProjectionAuthority.authorize({
              destination: 'console',
              projectId,
              recipientPrincipalId: principalId,
              requestedMode: 'metadata_only',
            })
          : null;
        const disclosure = assessWorkroomDisclosureSetup({
          resolution: { modelProviderAlias, contract },
          authorityPublished: disclosureAuthority !== undefined,
          authorityCurrent: disclosureAuthorization !== null,
          localIssuerAvailable: localDataGovernance !== undefined,
        });
        diagnostics.push(...disclosure.diagnostics);
        const { disclosureReady, disclosureConfigReady } = disclosure;
        const ready = catalogReady && activeRevision !== undefined && planningPolicyReady
          && acceptancePolicyReady && disclosureReady;
        return Object.freeze({
          projectId,
          ready,
          ...(principalId ? { principalId } : {}),
          trustedPackPublisher,
          projectSponsor,
          catalogReady,
          registryRevision: profiles.registryRevision,
          ...(active ? { activeProfile: Object.freeze({
            revisionId: active.revisionId,
            digest: active.compiledDigest,
          }) } : {}),
          planningPolicyReady,
          disclosureReady,
          disclosureConfigReady,
          ...(modelProviderAlias ? { modelProviderAlias } : {}),
          availableAgents: Object.freeze(availableAgents),
          availableTools: Object.freeze(availableTools),
          availableSkills: Object.freeze(availableSkills),
          diagnostics: Object.freeze(diagnostics),
        });
      } finally {
        lease.release();
      }
    };
    const bootstrapPlanning = async (
      command: WorkroomPlanningBootstrapCommand,
      authenticatedPrincipal: Readonly<{ principalId: string }>,
    ): Promise<WorkroomPlanningSetupStatus> => {
      if (authenticatedPrincipal.principalId === WORKROOM_CONTROL_PLANE_ROOT_PRINCIPAL) {
        throw new Error('Control-plane Root Pack bootstrap is not exposed through Console HTTP');
      }
      const before = await readPlanningSetupStatus(command.projectId, authenticatedPrincipal);
      if (before.ready) return before;
      if (!before.catalogReady || !before.trustedPackPublisher || !before.projectSponsor) {
        throw new Error(before.diagnostics.join('; ') || 'Workroom Planning bootstrap prerequisites are unavailable');
      }
      if (before.registryRevision !== command.expectedRegistryRevision) {
        throw new Error(
          `Project Profile Registry revision conflict: expected ${command.expectedRegistryRevision}, actual ${before.registryRevision}`,
        );
      }
      const [catalog, profiles] = await Promise.all([
        workroomCatalog.read(),
        projectProfiles.read(command.projectId),
      ]);
      const definition = catalog.definitions[command.projectId]!;
      const activeRevision = before.activeProfile
        ? profiles.revisions[before.activeProfile.revisionId]
        : undefined;
      const activeAcceptancePolicies = activeRevision?.compiledProfile.acceptancePolicies ?? [];
      const activeAcceptanceReady = Boolean(activeRevision && activeAcceptancePolicies.length === 1
        && activeRevision.compiledProfile.workflows.every(workflow => workflow.tasks.every(task =>
          activeAcceptancePolicies[0]!.tasks.some(policyTask => policyTask.taskKey === task.key))));
      if (before.planningPolicyReady && activeAcceptanceReady) {
        await ensureDisclosureAuthority({
          projectId: command.projectId,
          catalogRevision: catalog.revision,
          definition,
          principalId: authenticatedPrincipal.principalId,
        });
        return await readPlanningSetupStatus(command.projectId, authenticatedPrincipal);
      }
      const lease = options.snapshots!.acquire();
      try {
        if (lease.value.generation !== generation) {
          throw new Error('Workroom Planning bootstrap targets another Root generation');
        }
        const supply = createWorkroomGenerationAuthoritySnapshotFromRuntime(
          lease.value,
          listGenerationBindings(),
        );
        const artifacts = createWorkroomPlanningBootstrapArtifacts({
          projectId: command.projectId,
          definition,
          supply,
          principalId: authenticatedPrincipal.principalId,
          ...(command.includeTools ? { includeTools: command.includeTools } : {}),
          ...(command.includeSkills ? { includeSkills: command.includeSkills } : {}),
        });
        if (before.activeProfile) {
          const active = profiles.revisions[before.activeProfile.revisionId];
          if (!active) throw new Error('Active Project Profile revision is unavailable');
          if (!activeAcceptanceReady) {
            if ((active.compiledProfile.acceptancePolicies ?? []).length > 0) {
              throw new Error('active Profile 的 Acceptance Policy 未完整覆盖 Workflow Task，请发布修订后的 Profile');
            }
            const acceptancePolicy = createWorkroomBootstrapAcceptancePolicy({
              projectId: command.projectId,
              definition,
              principalId: authenticatedPrincipal.principalId,
              tasks: active.compiledProfile.workflows.flatMap(workflow => workflow.tasks),
            });
            const acceptancePack = createCapabilityPackManifest({
              id: `workroom:${command.projectId}:acceptance-bootstrap`,
              version: '1.0.0',
              kind: 'policy',
              acceptancePolicies: [acceptancePolicy],
            });
            const { digest: _acceptancePackDigest, ...acceptancePackInput } = acceptancePack;
            const publication = await profileComposition.control.publishPack({
              version: 1,
              operationId: `${command.operationId}:acceptance-pack`,
              authenticatedPrincipalId: authenticatedPrincipal.principalId,
              pack: acceptancePackInput,
            }, signal);
            const upgradedOverlay = createWorkroomProfileOverlay({
              version: 1,
              projectId: command.projectId,
              revisionId: `${active.revisionId}:acceptance:1`,
              charterRevisionId: active.charterRevisionId,
              parentRevisionId: active.revisionId,
              packs: [...active.packRefs, publication.pack],
              enabledTools: active.compiledProfile.tools.map(tool => tool.id),
              enabledSkills: active.compiledProfile.skills.map(skill => skill.id),
              enabledAgents: active.compiledProfile.agents.map(agent => agent.id),
              enabledWorkflows: active.compiledProfile.workflows.map(workflow => workflow.id),
              enabledMemories: active.compiledProfile.memories.map(memory => memory.id),
              enabledGlossaries: active.compiledProfile.glossaries.map(glossary => glossary.id),
              enabledAcceptancePolicies: [acceptancePolicy.id],
            });
            const upgraded = await profileComposition.control.publishProfile({
              version: 1,
              operationId: `${command.operationId}:acceptance-profile`,
              authenticatedPrincipalId: authenticatedPrincipal.principalId,
              projectId: command.projectId,
              expectedRegistryRevision: profiles.registryRevision,
              overlay: upgradedOverlay,
              source: {
                kind: 'sponsor_decision',
                sourceId: `console-bootstrap:${command.operationId}:acceptance`,
              },
              activate: true,
            }, signal);
            const upgradedActive = upgraded.active!;
            const currentPlanningPolicy = await profileComposition.control.readPlanningPolicy(
              command.projectId,
              upgradedActive.revisionId,
            );
            const planningPublication = resolveWorkroomPlanningPolicyPublication(currentPlanningPolicy);
            await profileComposition.control.publishPlanningPolicy({
              version: 1,
              operationId: `${command.operationId}:policy`,
              authenticatedPrincipalId: authenticatedPrincipal.principalId,
              projectId: command.projectId,
              catalogRevision: catalog.revision,
              projectDigest: digestWorkroomProfileCatalogProject(definition),
              profileRevisionId: upgradedActive.revisionId,
              profileDigest: upgradedActive.compiledDigest,
              ...planningPublication,
              policy: artifacts.policy,
            }, signal);
            await ensureDisclosureAuthority({
              projectId: command.projectId,
              catalogRevision: catalog.revision,
              definition,
              principalId: authenticatedPrincipal.principalId,
            });
            return await readPlanningSetupStatus(command.projectId, authenticatedPrincipal);
          }
          const currentPlanningPolicy = await profileComposition.control.readPlanningPolicy(
            command.projectId,
            active.revisionId,
          );
          const planningPublication = resolveWorkroomPlanningPolicyPublication(currentPlanningPolicy);
          await profileComposition.control.publishPlanningPolicy({
            version: 1,
            operationId: `${command.operationId}:policy`,
            authenticatedPrincipalId: authenticatedPrincipal.principalId,
            projectId: command.projectId,
            catalogRevision: catalog.revision,
            projectDigest: digestWorkroomProfileCatalogProject(definition),
            profileRevisionId: active.revisionId,
            profileDigest: active.compiledDigest,
            ...planningPublication,
            policy: artifacts.policy,
          }, signal);
          await ensureDisclosureAuthority({
            projectId: command.projectId,
            catalogRevision: catalog.revision,
            definition,
            principalId: authenticatedPrincipal.principalId,
          });
          return await readPlanningSetupStatus(command.projectId, authenticatedPrincipal);
        }
        const publication = await profileComposition.control.publishPack({
          version: 1,
          operationId: `${command.operationId}:pack`,
          authenticatedPrincipalId: authenticatedPrincipal.principalId,
          pack: artifacts.packInput,
        }, signal);
        const overlay = createWorkroomProfileOverlay({
          version: 1,
          projectId: command.projectId,
          revisionId: artifacts.overlay.revisionId,
          charterRevisionId: artifacts.overlay.charterRevisionId,
          packs: [publication.pack],
          enabledTools: artifacts.overlay.enabledTools,
          enabledSkills: artifacts.overlay.enabledSkills,
          enabledAgents: artifacts.overlay.enabledAgents,
          enabledWorkflows: artifacts.overlay.enabledWorkflows,
          enabledAcceptancePolicies: artifacts.overlay.enabledAcceptancePolicies,
        });
        const profile = await profileComposition.control.publishProfile({
          version: 1,
          operationId: `${command.operationId}:profile`,
          authenticatedPrincipalId: authenticatedPrincipal.principalId,
          projectId: command.projectId,
          expectedRegistryRevision: profiles.registryRevision,
          overlay,
          source: {
            kind: 'sponsor_decision',
            sourceId: `console-bootstrap:${command.operationId}`,
          },
          activate: true,
        }, signal);
        const active = profile.active!;
        const currentPlanningPolicy = await profileComposition.control.readPlanningPolicy(
          command.projectId,
          active.revisionId,
        );
        const planningPublication = resolveWorkroomPlanningPolicyPublication(currentPlanningPolicy);
        await profileComposition.control.publishPlanningPolicy({
          version: 1,
          operationId: `${command.operationId}:policy`,
          authenticatedPrincipalId: authenticatedPrincipal.principalId,
          projectId: command.projectId,
          catalogRevision: catalog.revision,
          projectDigest: digestWorkroomProfileCatalogProject(definition),
          profileRevisionId: active.revisionId,
          profileDigest: active.compiledDigest,
          ...planningPublication,
          policy: artifacts.policy,
        }, signal);
        await ensureDisclosureAuthority({
          projectId: command.projectId,
          catalogRevision: catalog.revision,
          definition,
          principalId: authenticatedPrincipal.principalId,
        });
      } finally {
        lease.release();
      }
      return await readPlanningSetupStatus(command.projectId, authenticatedPrincipal);
    };
    workroomProfileConsoleControl.current = Object.freeze({
      getPlanningStatus: readPlanningSetupStatus,
      bootstrapPlanning,
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
      journal: workroomJournal,
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
    installLocalWorkroomPortfolioAuthorities({
      generation,
      resources,
      catalog: workroomCatalog,
      profiles: projectProfiles,
      portfolioJournal: resources.use(portfolioJournalRepositoryToken),
    });
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
      runState: Object.freeze({
        read: (projectId: string, runId: string) => workroomKernel.read(projectId, runId),
        pinTaskAcceptance: (projectId: string, runId: string, taskKey: string) =>
          workroomKernel.pinTaskAcceptance(projectId, runId, taskKey),
      }),
      fallbackResourceRequirements: LOCAL_WORKROOM_RESOURCE_REQUIREMENTS,
    });
    resources.provide(workroomAssignmentAuthorityGrantRepositoryToken, assignmentAuthorityGrants);
    const durableAssignmentGrants = createDurableWorkroomAssignmentAuthorityGrantProvider({
      repository: assignmentAuthorityGrants,
      generation,
    });
    resources.provide(
      workroomAssignmentAuthorityGrantToken,
      createLocalWorkroomAssignmentGrantProvider({
        generation,
        projectRoot: options.projectRoot,
        repository: assignmentAuthorityGrants,
        durable: durableAssignmentGrants,
        journal: workroomJournal,
        catalog: workroomCatalog,
        profiles: projectProfiles,
        runState: Object.freeze({
          read: (projectId: string, runId: string) => workroomKernel.read(projectId, runId),
        }),
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
      outbound: createWorkroomProjectionOutboundMessageServicePort(
        resources.use(outboundMessageToken),
        rootPluginId(),
      ),
      workerId: `workroom-projection:${randomUUID()}`,
      leaseMs: 30_000,
      maxRunsPerTick: 64,
      maxDeliveriesPerTick: 32,
      governance: governedOutbound.projection,
      renewWorkroomBinding: async (projectId, catalog, operationSignal) => {
        operationSignal.throwIfAborted();
        const definition = catalog.definitions[projectId];
        if (!definition) return;
        const conversation = resolveCatalogWorkroomProjectionConversation(
          definition,
          options.im.listEndpoints(),
        );
        if (!conversation) return;
        await ensureCatalogWorkroomProjectionBinding({
          repository: projectionRepository,
          catalog,
          projectId,
          conversation,
          interactionBindingRevision: 1,
          endpoints: options.im.listEndpoints(),
        });
      },
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
        host: composedRuntime.host,
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
            ...structuredTaskReportPrompt(),
            'Do not use chat Subagent lifecycle or emit Task status commands.',
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
              config: composedRuntime.host.config,
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
      const standardLocalExecutor = new LocalAssignmentExecutor(localModel, capabilityProjection);
      const localAssignments = new WorkroomLocalAssignmentRuntime({
        kernel: workroomKernel,
        executor: options.selfDelivery
          ? createSelfDeliveryAssignmentExecutor(options.selfDelivery, standardLocalExecutor)
          : standardLocalExecutor,
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
        const projectDigest = digestWorkroomCatalogProjectBinding(definition);
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
      onError: (error, request) => logger.error(formatCompact({
        op: 'workroom_human_ingress_application',
        projectId: request.identity.projectId,
        proposalId: request.identity.proposalId,
        attempt: request.attempt,
        error: error instanceof Error ? error.message : String(error),
      })),
    });
    let humanIngressRetryTimer: ReturnType<typeof setTimeout> | undefined;
    let humanIngressRetryAt: number | undefined;
    const scheduleHumanIngressRetry = (retryAt: number) => {
      if (signal.aborted) return;
      if (humanIngressRetryAt !== undefined && humanIngressRetryAt <= retryAt) return;
      if (humanIngressRetryTimer) clearTimeout(humanIngressRetryTimer);
      humanIngressRetryAt = retryAt;
      humanIngressRetryTimer = setTimeout(() => {
        humanIngressRetryTimer = undefined;
        humanIngressRetryAt = undefined;
        if (signal.aborted) return;
        void recoverHumanIngress().catch(error => {
          if (signal.aborted) return;
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
    const projectionReplyTargets = new WeakMap<Message, Message['message']>();
    const projectionMentionTargets = new WeakMap<Message, Readonly<{
      agentDefinitionId: string;
      candidates: readonly NonNullable<Message['message']>[];
    }>>();
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
              ...(projectionReplyTargets.get(message)
                ? { replyTo: projectionReplyTargets.get(message)! }
                : message.replyTo
                  ? { replyTo: { conversation: message.conversation, id: message.replyTo.id } }
                : {}),
              ...(projectionMentionTargets.get(message)
                ? { mention: projectionMentionTargets.get(message)! }
                : {}),
              intent,
            }),
      onWorkroomResolved: async (message, decision) => {
        const catalog = await workroomCatalog.read();
        await ensureCatalogWorkroomProjectionBinding({
          repository: projectionRepository,
          catalog,
          projectId: decision.projectId,
          conversation: message.conversation,
          interactionBindingRevision: decision.bindingRevision,
          endpoints: options.im.listEndpoints(),
        });
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
        const replyEntry = resolveIndexedProjectionReply(message, projectionState.messageIndex);
        // Cross-Endpoint replies carry the inbound Endpoint in Message.replyTo,
        // while the durable projection index is keyed by the speaking Bot's
        // original Endpoint. Preserve that canonical ref for target resolution.
        if (replyEntry) projectionReplyTargets.set(message, replyEntry.message);
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
        const sourceDecision = classifyWorkroomIngressSource(definition, {
          adapter,
          endpoint,
          senderId: String(message.sender?.id ?? ''),
          space: identity.space,
          mentioned: message.mentioned === true || message.metadata.mentioned === true,
          // Generic message metadata is not identity authority. Adapter-owned
          // self filtering and exact configured numeric Bot principals remain
          // the trusted echo suppression paths.
          ...(replyEntry ? {
            replySpeakerAgent: replyEntry.speaker.agentDefinitionId,
            replySpeakerRole: replyEntry.speaker.role,
          } : {}),
        });
        if (sourceDecision !== 'accept') {
          return Object.freeze({ status: 'ignored' as const, reason: sourceDecision });
        }
        if (!replyEntry && identity.space === 'workroom' && identity.role !== 'orchestrator'
          && (message.mentioned === true || message.metadata.mentioned === true)) {
          const candidates = Object.values(projectionState.messageIndex)
            .filter(entry => entry.target.projectId === identity.projectId
              && entry.target.agentDefinitionId === identity.agent
              && entry.target.taskKey != null
              && entry.target.assignmentId != null)
            .map(entry => entry.message);
          projectionMentionTargets.set(message, Object.freeze({
            agentDefinitionId: identity.agent,
            candidates: Object.freeze(candidates),
          }));
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
          // Every human message enters the Orchestrator-owned Project Inbox.
          // identity.agent may be the member Bot Endpoint that received it.
          agentDefinitionId: configured.agent,
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
      shouldRouteBeforeDispatch: (message: Message) =>
        workroomHumanIngress.hasAgentTurn(message)
        && resolveRuntimeAgentTrigger(message, service.getTriggerConfig(), true) != null,
      route: async (
        message: Message,
        lease: import('@zhin.js/plugin-runtime').SnapshotLease,
        requester: PluginId,
        conversationSequence: number | undefined,
      ) => {
      const snapshot = lease.value;
      const trigger = service.getTriggerConfig();
      const workroomAgentTurn = workroomHumanIngress.takeAgentTurn(message);
      const matched = resolveRuntimeAgentTrigger(message, trigger, workroomAgentTurn != null);

      const ownerId = resolveOwnerForRuntimeMessage(message, options.resolveEndpointOwner);
      const endpointTrusted = resolveTrustedForRuntimeMessage(message, options.resolveEndpointTrusted);
      const senderRoles = resolveRuntimeSenderRoles(message, ownerId, endpointTrusted, trigger);
      const turnAccess = createRuntimeTurnAccess(message, senderRoles);
      const sessionKey = workroomAgentTurn
        ? workroomOrchestratorSessionKey(workroomAgentTurn)
        : runtimeImSessionKey(turnAccess);
      const workroomReplyConversation = workroomAgentTurn
        ? resolveWorkroomOrchestratorConversation(
            (await projectionRepository.read()).bindings,
            workroomAgentTurn,
          )
        : undefined;
      if (workroomAgentTurn && !workroomReplyConversation) {
        throw new Error(`Workroom ${workroomAgentTurn.projectId} has no current Orchestrator projection binding`);
      }

      // Runtime message.adapter is a CapabilityId (\0-separated); strip it and
      // use Endpoint liveName so the OutboundHost resolve() succeeds.
      const effectiveAdapter = capabilityLocalName(String(message.conversation.endpoint.id));
      const effectiveEndpoint = adapterLiveEndpointId(message);
      const reply = async (
        content: SendContent,
      ): Promise<Awaited<ReturnType<Message['$reply']>>> => {
        const receipt = workroomReplyConversation
          ? await options.im.sendWithSnapshotLease(lease, {
              conversation: workroomReplyConversation,
              requester: rootPluginId(),
              content,
            })
          : await message.$reply(content);
        logger.debug(formatCompact({
          op: 'replychain_message_reply',
          status: receipt.status,
          code: receipt.failure?.code,
          messageId: receipt.message?.id,
        }));
        return receipt;
      };

      // Agent 管理命令（/models /tree /reset…）— 在 AI trigger 前拦截
      const managementReply = workroomAgentTurn
        ? null
        : await handleRuntimeManagementCommand({
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

      const approveReply = !workroomAgentTurn && /^\/approve(?:\s|$)/iu.test(message.content.trim())
        ? zhinAgent.ownerApprovals.handleCommand(
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

      if (!workroomAgentTurn && isClearCommand(matched.content)) {
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
        const capabilities = restrictWorkroomAgentCapabilities(await readCapabilities(
          ingress,
          snapshot,
          requester,
          message,
          senderRoles,
          () => capabilityActive,
        ), workroomAgentTurn != null);
        const routed = routeSpecialistAgent(
          inbound.text,
          capabilities,
          workroomAgentTurn?.agentDefinitionId,
          binding.name,
        );
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
              sessionKey,
              ...(workroomAgentTurn ? {
                trustedMetadata: Object.freeze({
                  workroom: Object.freeze({
                    projectId: workroomAgentTurn.projectId,
                    proposalId: workroomAgentTurn.proposalId,
                    space: workroomAgentTurn.space,
                    disposition: 'discussion',
                    orchestratorAgentDefinitionId: workroomAgentTurn.agentDefinitionId,
                  }),
                }),
              } : {}),
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
              ...(conversationSequence === undefined || workroomAgentTurn ? {} : {
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
              observeAgentTurnTrace(traceRuntime, request),
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

function digestInstallerValue(value: unknown): string {
  return `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
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

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, Math.max(0, max - 1))}…`;
}
