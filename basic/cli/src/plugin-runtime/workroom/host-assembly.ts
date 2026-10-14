import type {
  HumanIngressOrchestratorProposalPort,
  WorkroomDynamicPlanningPolicyPort,
  WorkroomPlanGateAuthorityPort,
  WorkroomPlanningDisclosurePort,
  SelfDeliveryHostConfiguration,
} from '@zhin.js/workroom';
import type { CapabilityIngress } from '@zhin.js/agent/runtime';
import type { RootResourceInstaller } from '@zhin.js/runtime';
import type { SnapshotReader } from '@zhin.js/plugin-runtime';
import type { ImRuntime } from '@zhin.js/core/runtime';
import type { AgentHostAIConfig, WorkroomStorageMode } from '../agent/config.js';
import type { AgentRuntimeFoundation } from '../agent/runtime-foundation.js';
import { WorkroomHostCoordinator } from './host-coordinator.js';
import type { LocalWorkroomDataGovernanceAuthority } from './local-data-governance.js';
import { WorkroomHostPublication } from './publication.js';
import { WorkroomRuntimeFoundation } from './runtime-foundation.js';

type RootResourceContext = Parameters<RootResourceInstaller>[0];

export interface WorkroomHostAssemblyBeginOptions {
  readonly generation: number;
  readonly signal: AbortSignal;
  readonly resources: RootResourceContext['resources'];
  readonly planGateAuthority?: WorkroomPlanGateAuthorityPort;
  readonly planningDisclosure?: WorkroomPlanningDisclosurePort;
  readonly dynamicPlanningPolicy?: WorkroomDynamicPlanningPolicyPort;
}

export interface WorkroomHostAssemblyComposeOptions {
  readonly projectRoot: string;
  readonly lifecycle: RootResourceContext['lifecycle'];
  readonly handoff: RootResourceContext['handoff'];
  readonly snapshots?: SnapshotReader;
  readonly config: AgentHostAIConfig;
  readonly storageMode: WorkroomStorageMode;
  readonly im: ImRuntime;
  readonly selfDelivery?: SelfDeliveryHostConfiguration;
  readonly agent: AgentRuntimeFoundation;
  readonly ingress: CapabilityIngress;
  readonly resolveConfiguredEndpointKeys?: () => Promise<ReadonlySet<string>>;
  readonly humanIngressPort?: HumanIngressOrchestratorProposalPort;
  readonly trustedPackPublishers?: readonly string[];
  readonly localDataGovernance?: LocalWorkroomDataGovernanceAuthority;
}

/**
 * Two-phase Workroom assembly. `begin` registers generation Resources
 * synchronously (before any await); `compose` performs the asynchronous
 * persistence preparation and returns the coordinator.
 */
export class WorkroomHostAssembly {
  private constructor(
    private readonly state: WorkroomHostAssemblyBeginOptions,
    readonly foundation: WorkroomRuntimeFoundation,
    readonly publication: WorkroomHostPublication,
  ) {}

  static begin(options: WorkroomHostAssemblyBeginOptions): WorkroomHostAssembly {
    const foundation = new WorkroomRuntimeFoundation({
      generation: options.generation,
      signal: options.signal,
      resources: options.resources,
      planGateAuthority: options.planGateAuthority,
      planningDisclosure: options.planningDisclosure,
      dynamicPlanningPolicy: options.dynamicPlanningPolicy,
    });
    const publication = new WorkroomHostPublication({
      signal: options.signal,
      resources: options.resources,
      foundation,
    });
    return new WorkroomHostAssembly(options, foundation, publication);
  }

  compose(options: WorkroomHostAssemblyComposeOptions): Promise<WorkroomHostCoordinator> {
    return WorkroomHostCoordinator.create({
      projectRoot: options.projectRoot,
      generation: this.state.generation,
      signal: this.state.signal,
      resources: this.state.resources,
      lifecycle: options.lifecycle,
      handoff: options.handoff,
      snapshots: options.snapshots,
      config: options.config,
      storageMode: options.storageMode,
      im: options.im,
      selfDelivery: options.selfDelivery,
      agent: options.agent,
      ingress: options.ingress,
      foundation: this.foundation,
      publication: this.publication,
      resolveConfiguredEndpointKeys: options.resolveConfiguredEndpointKeys,
      humanIngressPort: options.humanIngressPort,
      trustedPackPublishers: options.trustedPackPublishers,
      localDataGovernance: options.localDataGovernance,
    });
  }
}
