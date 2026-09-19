import { join } from 'node:path';
import type {
  HumanIngressOrchestratorProposalPort,
} from '@zhin.js/agent';
import {
  CapabilityIngress,
  createSelfDeliveryProjectForHost,
  selfDeliveryProjectToken,
  workroomDeliveryProviderToken,
  type SelfDeliveryHostConfiguration,
} from '@zhin.js/agent/runtime';
import type { ImRuntime } from '@zhin.js/core/runtime';
import type { SnapshotReader } from '@zhin.js/plugin-runtime';
import type { RootResourceInstaller } from '@zhin.js/runtime';
import type { AgentHostAIConfig, WorkroomStorageMode } from '../agent-host-config.js';
import type { AgentHostPublicationCoordinator } from '../agent-host-publication-coordinator.js';
import type { AgentRuntimeFoundation } from '../agent-runtime-foundation.js';
import {
  resolveWorkroomOrchestratorConversation,
  type AgentWorkroomPort,
  type WorkroomTurnContinuation,
} from '../agent-workroom-port.js';
import type { LocalWorkroomDataGovernanceAuthority } from './local-data-governance.js';
import { WorkroomAcceptanceCoordinator } from './acceptance-coordinator.js';
import { WorkroomDataGovernanceCoordinator } from './data-governance-coordinator.js';
import { WorkroomEffectCoordinator } from './effect-coordinator.js';
import { WorkroomExecutionCoordinator } from './execution-coordinator.js';
import { WorkroomHumanIngressCoordinator } from './human-ingress-coordinator.js';
import { WorkroomKnowledgeCoordinator } from './knowledge-coordinator.js';
import { WorkroomPersistenceCoordinator } from './persistence-coordinator.js';
import { WorkroomPlanningCoordinator } from './planning-coordinator.js';
import { WorkroomProfileCoordinator } from './profile-coordinator.js';
import type { WorkroomRuntimeFoundation } from './runtime-foundation.js';

type RootResourceContext = Parameters<RootResourceInstaller>[0];

export interface WorkroomHostCoordinatorOptions {
  readonly projectRoot: string;
  readonly generation: number;
  readonly signal: AbortSignal;
  readonly resources: RootResourceContext['resources'];
  readonly lifecycle: RootResourceContext['lifecycle'];
  readonly handoff: RootResourceContext['handoff'];
  readonly snapshots?: SnapshotReader;
  readonly config: AgentHostAIConfig;
  readonly storageMode: WorkroomStorageMode;
  readonly im: ImRuntime;
  readonly selfDelivery?: SelfDeliveryHostConfiguration;
  readonly resolveConfiguredEndpointKeys?: () => Promise<ReadonlySet<string>>;
  readonly humanIngressPort?: HumanIngressOrchestratorProposalPort;
  readonly trustedPackPublishers?: readonly string[];
  readonly localDataGovernance?: LocalWorkroomDataGovernanceAuthority;
  readonly foundation: WorkroomRuntimeFoundation;
  readonly agent: AgentRuntimeFoundation;
  readonly publication: AgentHostPublicationCoordinator;
}

/** Composes one complete Workroom candidate behind a narrow Agent Host seam. */
export class WorkroomHostCoordinator implements AgentWorkroomPort {
  readonly ingress: CapabilityIngress;
  readonly persistence: WorkroomPersistenceCoordinator;
  readonly presetCount: number;
  readonly #execution: WorkroomExecutionCoordinator;
  readonly #humanIngress: WorkroomHumanIngressCoordinator;

  private constructor(state: Readonly<{
    ingress: CapabilityIngress;
    persistence: WorkroomPersistenceCoordinator;
    execution: WorkroomExecutionCoordinator;
    humanIngress: WorkroomHumanIngressCoordinator;
    presetCount: number;
  }>) {
    this.ingress = state.ingress;
    this.persistence = state.persistence;
    this.#execution = state.execution;
    this.#humanIngress = state.humanIngress;
    this.presetCount = state.presetCount;
  }

  static async create(options: WorkroomHostCoordinatorOptions): Promise<WorkroomHostCoordinator> {
    const { generation, signal, resources, lifecycle, handoff, foundation, agent } = options;
    signal.throwIfAborted();
    let recoverHumanIngress = async (): Promise<void> => {};
    const persistence = new WorkroomPersistenceCoordinator({
      projectRoot: options.projectRoot,
      config: options.config,
      fixedStorageMode: options.storageMode,
      resources,
      handoff,
      service: agent.service,
      agent: agent.agent,
      semanticMemory: agent.semanticMemory,
      journal: foundation.journal,
      journalPayloads: foundation.journalPayloads.payloads,
      catalog: foundation.catalog,
      listAgentNames: () => agent.listBindings().map(binding => binding.name),
      resolveConfiguredEndpointKeys: options.resolveConfiguredEndpointKeys,
      recoverHumanIngress: () => recoverHumanIngress(),
    });
    const governance = await WorkroomDataGovernanceCoordinator.create({
      projectRoot: options.projectRoot,
      generation,
      signal,
      resources,
      usesDatabase: persistence.usesDatabase,
      foundation,
      localAuthority: options.localDataGovernance,
    });
    if (governance.storage) persistence.bindDataGovernanceStorage(governance.storage);
    await persistence.prepare();
    governance.registerHandoff(handoff);
    options.publication.bindDataLifecycle(governance.lifecycle?.console);
    const presetCount = await agent.seedPresets();

    const effect = new WorkroomEffectCoordinator({
      projectRoot: options.projectRoot,
      generation,
      signal,
      resources,
      lifecycle,
      handoff,
      runtime: foundation,
    });
    const profiles = new WorkroomProfileCoordinator({
      projectRoot: options.projectRoot,
      stateRoot: persistence.stateRoot,
      generation,
      signal,
      resources,
      snapshots: options.snapshots,
      journal: foundation.journal,
      catalog: foundation.catalog,
      trustedPackPublishers: options.trustedPackPublishers,
      listBindings: () => agent.listBindings(),
    });
    if (options.selfDelivery) {
      if (options.selfDelivery.deliveryProvider) {
        if (resources.has(workroomDeliveryProviderToken)) {
          throw new Error('Self-delivery Delivery provider conflicts with existing Host provider');
        }
        resources.provide(workroomDeliveryProviderToken, options.selfDelivery.deliveryProvider);
      }
      resources.provide(selfDeliveryProjectToken, createSelfDeliveryProjectForHost({
        directory: join(persistence.stateRoot, 'self-delivery-issues'),
        configuration: options.selfDelivery,
        kernel: foundation.kernel,
        catalog: foundation.catalog,
        profiles: profiles.profiles,
        pins: profiles.runPinWriter,
        signal,
      }));
    }
    const planning = new WorkroomPlanningCoordinator({
      config: options.config,
      generation,
      signal,
      snapshots: profiles.snapshots,
      service: agent.service,
      runtime: foundation,
      profiles,
      governance,
      workroomTrustedPackPublishers: options.trustedPackPublishers,
      listBindings: () => agent.listBindings(),
    });
    options.publication.bindWorkroomProfiles(planning.consoleControl);
    const knowledge = new WorkroomKnowledgeCoordinator({
      stateRoot: persistence.stateRoot,
      generation,
      signal,
      resources,
      lifecycle,
      runtime: foundation,
      profiles,
      governance,
      persistence,
    });
    options.publication.bindWorkroomKnowledge(knowledge.consoleControl);
    const acceptance = new WorkroomAcceptanceCoordinator({
      projectRoot: options.projectRoot,
      stateRoot: persistence.stateRoot,
      generation,
      signal,
      resources,
      lifecycle,
      handoff,
      runtime: foundation,
      profiles,
      governance,
      effect: effect.composition,
      ephemeralAssignmentContext: knowledge.ephemeralAssignmentContext,
    });
    options.publication.bindEffectSponsor(acceptance.effectSponsorControl);
    const ingress = new CapabilityIngress();
    const execution = new WorkroomExecutionCoordinator({
      projectRoot: options.projectRoot,
      generation,
      signal,
      resources,
      lifecycle,
      handoff,
      snapshots: profiles.snapshots,
      im: options.im,
      selfDelivery: options.selfDelivery,
      ingress,
      agent,
      runtime: foundation,
      profiles,
      governance,
      persistence,
      acceptance,
    });
    options.publication.bindPortfolioSponsor(execution.portfolioSponsorControl);
    const humanIngress = await WorkroomHumanIngressCoordinator.create({
      signal,
      resources,
      lifecycle,
      im: options.im,
      port: options.humanIngressPort,
      runtime: foundation,
      profiles,
      persistence,
      execution,
      resolveDataLifecycleControl: () => options.publication.resolveDataLifecycle(),
    });
    recoverHumanIngress = () => humanIngress.recover();
    return new WorkroomHostCoordinator({
      ingress,
      persistence,
      execution,
      humanIngress,
      presetCount,
    });
  }

  preRoute(message: Parameters<AgentWorkroomPort['preRoute']>[0], conversationSequence: number | undefined): Promise<boolean> {
    return this.#humanIngress.preRoute(message, conversationSequence);
  }

  hasAgentTurn(message: Parameters<AgentWorkroomPort['hasAgentTurn']>[0]): boolean {
    return this.#humanIngress.hasAgentTurn(message);
  }

  takeAgentTurn(message: Parameters<AgentWorkroomPort['takeAgentTurn']>[0]): WorkroomTurnContinuation | undefined {
    return this.#humanIngress.takeAgentTurn(message);
  }

  async resolveOrchestratorConversation(
    continuation: WorkroomTurnContinuation,
  ): Promise<Awaited<ReturnType<AgentWorkroomPort['resolveOrchestratorConversation']>>> {
    return resolveWorkroomOrchestratorConversation(
      (await this.#execution.projectionRepository.read()).bindings,
      continuation,
    );
  }
}
