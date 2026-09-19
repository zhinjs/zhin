import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { formatCompact, getLogger } from '@zhin.js/logger';
import {
  ingressRouteToken,
  type ImRuntime,
} from '@zhin.js/core/runtime';
import type { RootResourceInstaller } from '@zhin.js/runtime';
import { rootPluginId, type DisposeStack, type SnapshotReader } from '@zhin.js/plugin-runtime';
import {
  AgentResourceHub,
  type AssistantConfig,
  type ApprovalPort,
  type AudioTranscriptionPort,
  type TurnRequest,
  FileJournalStore,
  type HumanIngressOrchestratorProposalPort,
  type WorkroomPlanGateAuthorityPort,
} from '@zhin.js/agent';
import {
  agentHostToken,
  CapabilityIngress,
  turnJournalStoreToken,
  agentTurnEngineToken,
  createFullAgentTurnEngine,
  AgentRuntime,
  type WorkroomRunControlCommand,
  type TurnIntentResolver,
  type WorkroomDynamicPlanningPolicyPort,
  type WorkroomPlanningDisclosurePort,
  type AgentHostWorkroomProfileControlPort,
  type AgentHostWorkroomKnowledgeControlPort,
  type AgentHostEffectSponsorControlPort,
  type AgentHostPortfolioSponsorControlPort,
  installWorkroomEffectResources,
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
import { WorkroomHumanIngressCoordinator } from './workroom-human-ingress-coordinator.js';
import { WorkroomKnowledgeCoordinator } from './workroom-knowledge-coordinator.js';
import { AgentTurnIngressRoute } from './agent-turn-ingress-route.js';

export { AgentRuntime, AgentTurnCoordinator } from '@zhin.js/agent/runtime';

import {
  createRuntimeApprovalPort,
} from './agent-turn-request.js';
import { observeAgentTurnTrace } from './agent-runtime-factory.js';
import {
  resolveAgentHostMcpServers,
  type AgentHostAIConfig as AIConfig,
  type WorkroomStorageMode,
} from './agent-host-config.js';
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
      overlayPackPromotions,
      portfolioControlOutbox,
      stateRoot: workroomStateRoot,
    } = persistence;
    const {
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
    const knowledgeCoordinator = new WorkroomKnowledgeCoordinator({
      stateRoot: workroomStateRoot,
      generation,
      signal,
      resources,
      lifecycle,
      runtime: workroomFoundation,
      profiles: profileCoordinator,
      governance: dataGovernanceCoordinator,
      persistence,
    });
    const ephemeralAssignmentContext = knowledgeCoordinator.ephemeralAssignmentContext;
    workroomKnowledgeConsoleControl.current = knowledgeCoordinator.consoleControl;
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
    const { portfolioSponsorControl } = executionCoordinator;
    portfolioSponsorConsoleControl.current = portfolioSponsorControl;
    const humanIngressCoordinator = await WorkroomHumanIngressCoordinator.create({
      signal,
      resources,
      lifecycle,
      im: options.im,
      port: options.workroomHumanIngressPort,
      runtime: workroomFoundation,
      profiles: profileCoordinator,
      persistence,
      execution: executionCoordinator,
      dataLifecycleControl: dataLifecycleConsoleControl,
    });
    recoverHumanIngress = () => humanIngressCoordinator.recover();

    resources.provide(ingressRouteToken, new AgentTurnIngressRoute({
      projectRoot: options.projectRoot,
      runtime: options.runtime,
      im: options.im,
      transcribeUrl: options.transcribeUrl,
      approvalPort: options.approvalPort,
      resolveTurnIntent: options.resolveTurnIntent,
      resolveEndpointOwner: options.resolveEndpointOwner,
      resolveEndpointTrusted: options.resolveEndpointTrusted,
      ingress,
      agent: agentFoundation,
      execution: executionCoordinator,
      humanIngress: humanIngressCoordinator,
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

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, Math.max(0, max - 1))}…`;
}
