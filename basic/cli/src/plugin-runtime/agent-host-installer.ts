import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { formatCompact, getLogger } from '@zhin.js/logger';
import {
  ingressRouteToken,
  type ImRuntime,
  type Message,
  type SendContent,
} from '@zhin.js/core/runtime';
import type { RootResourceInstaller } from '@zhin.js/runtime';
import { rootPluginId, type DisposeStack, type PluginId, type RuntimeSnapshot, type SnapshotReader } from '@zhin.js/plugin-runtime';
import {
  AgentResourceHub,
  handleRuntimeManagementCommand,
  publishOutboundElements,
  type AssistantConfig,
  type ApprovalPort,
  type AudioTranscriptionPort,
  type TurnRequest,
  FileJournalStore,
  resolveWorkroomBotIdentity,
  workroomProjectionBindingKey,
  FileHumanIngressProposalRepository,
  FileHumanIngressApplicationRepository,
  HumanIngressApplicationService,
  type HumanIngressOrchestratorProposalPort,
  type WorkroomPlanGateAuthorityPort,
  ConversationEventHumanIngressSourceReader,
  ProductionHumanIngressOrchestratorPort,
  createPlanGateHumanIngressControlPort,
  FileInteractionSpaceBindingRepository,
  InteractionSpaceRouter,
  ProjectKnowledgeRegistry,
} from '@zhin.js/agent';
import {
  agentHostToken,
  CapabilityIngress,
  turnJournalStoreToken,
  agentTurnEngineToken,
  createFullAgentTurnEngine,
  AgentRuntime,
  type AgentCapabilities,
  type WorkroomRunControlCommand,
  type TurnIntentResolver,
  createGenerationHumanIngressPlanningPort,
  type WorkroomDynamicPlanningPolicyPort,
  type WorkroomPlanningDisclosurePort,
  workroomHumanIngressPlanningToken,
  createProjectionHumanIngressTargetResolver,
  workroomProjectionCatalogBindingDigest,
  digestWorkroomCatalogProjectBinding,
  createWorkroomDataLifecycleHumanIngressControlPort,
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
  createPortfolioSponsorHumanIngressControlPort,
  portfolioSponsorCommandToken,
  type WorkroomEffectClockPort,
  type WorkroomEffectBlockerPolicyPort,
  type WorkroomDataLifecycleConsoleControlPort,
  createSelfDeliveryProjectForHost,
  workroomDeliveryProviderToken,
  selfDeliveryProjectToken,
  type SelfDeliveryHostConfiguration,
} from '@zhin.js/agent/runtime';
import type { LocalWorkroomDataGovernanceAuthority } from './local-workroom-data-governance.js';
import { WorkroomExecutionCoordinator } from './workroom-execution-coordinator.js';

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
import { observeAgentTurnTrace } from './agent-runtime-factory.js';
import {
  resolveAgentHostMcpServers,
  resolveAssistantConfigDocument,
  type AgentHostAIConfig as AIConfig,
  type WorkroomStorageMode,
} from './agent-host-config.js';
import {
  completedOutput,
  flattenOutputElements,
  isClearCommand,
  preprocessInboundTurn,
  resolveStableSenderId,
  stringMetadata,
} from './agent-turn-content.js';
import {
  publishAgentToolFeatures,
  type HostAgentTool,
} from './agent-tool-feature-publisher.js';
import { WorkroomPersistenceCoordinator } from './workroom-persistence-coordinator.js';
import { WorkroomRuntimeFoundation } from './workroom-runtime-foundation.js';
import { AgentRuntimeFoundation } from './agent-runtime-foundation.js';
import { WorkroomDataGovernanceCoordinator } from './workroom-data-governance-coordinator.js';
import { WorkroomProfileCoordinator } from './workroom-profile-coordinator.js';
import { WorkroomPlanningCoordinator } from './workroom-planning-coordinator.js';
import { WorkroomAcceptanceCoordinator } from './workroom-acceptance-coordinator.js';

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
  readonly extraTools?: readonly HostAgentTool[];
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
    const agentFoundation = await AgentRuntimeFoundation.create({
      config: aiConfig,
      assistantConfig,
      im: options.im,
      projectRoot: options.projectRoot,
      processRuntime: options.runtime,
      approvalPort: options.approvalPort,
      audioTranscriber: options.audioTranscriber,
      resources,
      lifecycle,
    });
    const {
      service,
      agent: zhinAgent,
      composition: composedRuntime,
      knowledgeIndex,
      semanticMemory,
      traceRuntime,
      schedule,
      scheduleTools,
      homeTools,
      assistantEnabled,
      sessionTreeRuntime,
    } = agentFoundation;
    const listGenerationBindings = () => agentFoundation.listBindings();
    const workroomFoundation = new WorkroomRuntimeFoundation({
      generation,
      signal,
      resources,
      planGateAuthority: options.workroomPlanGateAuthority,
      planningDisclosure: options.workroomPlanningDisclosurePort,
      dynamicPlanningPolicy: options.workroomDynamicPlanningPolicyPort,
    });
    const {
      journal: workroomJournal,
      catalog: workroomCatalog,
      kernel: workroomKernel,
      runtime: workroomRuntime,
      consoleProjectionAuthority,
    } = workroomFoundation;
    const rememberedSandboxApprovals = new Map<string, Set<string>>();
    let recoverHumanIngress = async (): Promise<void> => {};
    const persistence = new WorkroomPersistenceCoordinator({
      projectRoot: options.projectRoot,
      config: aiConfig,
      fixedStorageMode: options.workroomStorageMode,
      resources,
      handoff,
      service,
      agent: zhinAgent,
      semanticMemory,
      journal: workroomJournal,
      journalPayloads: workroomFoundation.journalPayloads.payloads,
      catalog: workroomCatalog,
      listAgentNames: () => listGenerationBindings().map(binding => binding.name),
      resolveConfiguredEndpointKeys: options.resolveConfiguredEndpointKeys,
      recoverHumanIngress: () => recoverHumanIngress(),
    });
    const dataGovernanceCoordinator = await WorkroomDataGovernanceCoordinator.create({
      projectRoot: options.projectRoot,
      generation,
      signal,
      resources,
      usesDatabase: persistence.usesDatabase,
      foundation: workroomFoundation,
      localAuthority: options.workroomLocalDataGovernance,
    });
    if (dataGovernanceCoordinator.storage) {
      persistence.bindDataGovernanceStorage(dataGovernanceCoordinator.storage);
    }
    await persistence.prepare();
    dataGovernanceCoordinator.registerHandoff(handoff);
    const {
      assignmentAuthorityGrants,
      projectKnowledgeJournal,
      overlayPackPromotions,
      portfolioControlOutbox,
      stateRoot: workroomStateRoot,
    } = persistence;
    const {
      runtime: dataGovernanceRuntime,
      lifecycle: dataLifecycle,
      localAuthority: localDataGovernance,
      governedOutbound,
    } = dataGovernanceCoordinator;

    const ingress = new CapabilityIngress();
    const bootstrapText = await loadBootstrap(options.projectRoot);

    // Register before any await so a cancelled generation cannot leak Agent
    // Resources. DisposeStack continues through later cleanup when one
    // Resource fails.
    publishAgentToolFeatures({
      addFeature,
      projectRoot: options.projectRoot,
      service,
      mcpServers: mcpEntries,
      hostTools: options.extraTools,
      runtimeTools: [...scheduleTools, ...homeTools],
      knowledgeIndex,
      semanticMemory: semanticMemory ?? undefined,
    });

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

    const presetCount = await agentFoundation.seedPresets();

    const binding = service.getBindingRegistry().requireZhinBinding();
    dataLifecycleConsoleControl.current = dataLifecycle?.console;
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
    const profileCoordinator = new WorkroomProfileCoordinator({
      projectRoot: options.projectRoot,
      stateRoot: workroomStateRoot,
      generation,
      signal,
      resources,
      snapshots: options.snapshots,
      journal: workroomJournal,
      catalog: workroomCatalog,
      trustedPackPublishers: options.workroomTrustedPackPublishers,
      listBindings: listGenerationBindings,
    });
    const {
      composition: profileComposition,
      profiles: projectProfiles,
      runPinWriter: profileRunPinWriter,
      acceptanceSource: acceptanceProfileSource,
    } = profileCoordinator;
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
    const planningCoordinator = new WorkroomPlanningCoordinator({
      config: aiConfig,
      generation,
      signal,
      snapshots: profileCoordinator.snapshots,
      service,
      runtime: workroomFoundation,
      profiles: profileCoordinator,
      governance: dataGovernanceCoordinator,
      workroomTrustedPackPublishers: options.workroomTrustedPackPublishers,
      listBindings: listGenerationBindings,
    });
    workroomProfileConsoleControl.current = planningCoordinator.consoleControl;
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
    const acceptanceCoordinator = new WorkroomAcceptanceCoordinator({
      projectRoot: options.projectRoot,
      stateRoot: workroomStateRoot,
      generation,
      signal,
      resources,
      lifecycle,
      handoff,
      runtime: workroomFoundation,
      profiles: profileCoordinator,
      governance: dataGovernanceCoordinator,
      effect: effectComposition,
      ephemeralAssignmentContext,
    });
    const workroomReports = acceptanceCoordinator.reports;
    effectSponsorConsoleControl.current = acceptanceCoordinator.effectSponsorControl;
    const executionCoordinator = new WorkroomExecutionCoordinator({
      projectRoot: options.projectRoot,
      generation,
      signal,
      resources,
      lifecycle,
      handoff,
      snapshots: profileCoordinator.snapshots,
      im: options.im,
      selfDelivery: options.selfDelivery,
      ingress,
      agent: agentFoundation,
      runtime: workroomFoundation,
      profiles: profileCoordinator,
      governance: dataGovernanceCoordinator,
      persistence,
      acceptance: acceptanceCoordinator,
    });
    const {
      projectionRepository,
      projectionReplyResolver,
      portfolioSponsorControl,
    } = executionCoordinator;
    portfolioSponsorConsoleControl.current = portfolioSponsorControl;
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
    if (!persistence.pendingActivation) await recoverHumanIngress();
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
      + ` | persistence: ${persistence.pendingActivation ? 'pending_activate' : 'file'}`,
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
