import { outboundMessageToken, type ImRuntime } from '@zhin.js/core/runtime';
import {
  FileWorkroomProjectionRepository,
} from '@zhin.js/agent';
import {
  WorkroomProjectionReplyResolver,
  type AgentHostPortfolioSponsorControlPort,
  type CapabilityIngress,
  type SelfDeliveryHostConfiguration,
} from '@zhin.js/agent/runtime';
import type { SnapshotReader } from '@zhin.js/plugin-runtime';
import type { RootResourceInstaller } from '@zhin.js/runtime';
import type { AgentRuntimeFoundation } from './agent-runtime-foundation.js';
import { WorkroomAssignmentCoordinator } from './workroom-assignment-coordinator.js';
import type { WorkroomAcceptanceCoordinator } from './workroom-acceptance-coordinator.js';
import type { WorkroomDataGovernanceCoordinator } from './workroom-data-governance-coordinator.js';
import { WorkroomExecutionControlCoordinator } from './workroom-execution-control-coordinator.js';
import type { WorkroomPersistenceCoordinator } from './workroom-persistence-coordinator.js';
import { WorkroomPortfolioCoordinator } from './workroom-portfolio-coordinator.js';
import type { WorkroomProfileCoordinator } from './workroom-profile-coordinator.js';
import { WorkroomProjectionCoordinator } from './workroom-projection-coordinator.js';
import type { WorkroomRuntimeFoundation } from './workroom-runtime-foundation.js';

type RootResourceContext = Parameters<RootResourceInstaller>[0];

export interface WorkroomExecutionCoordinatorOptions {
  readonly projectRoot: string;
  readonly generation: number;
  readonly signal: AbortSignal;
  readonly resources: RootResourceContext['resources'];
  readonly lifecycle: RootResourceContext['lifecycle'];
  readonly handoff: RootResourceContext['handoff'];
  readonly snapshots: SnapshotReader;
  readonly im: ImRuntime;
  readonly selfDelivery?: SelfDeliveryHostConfiguration;
  readonly ingress: CapabilityIngress;
  readonly agent: AgentRuntimeFoundation;
  readonly runtime: WorkroomRuntimeFoundation;
  readonly profiles: WorkroomProfileCoordinator;
  readonly governance: WorkroomDataGovernanceCoordinator;
  readonly persistence: WorkroomPersistenceCoordinator;
  readonly acceptance: WorkroomAcceptanceCoordinator;
}

/** Owns Portfolio, projection, assignment, scheduler, preemption, and remote callback runtimes. */
export class WorkroomExecutionCoordinator {
  readonly projectionRepository: FileWorkroomProjectionRepository;
  readonly projectionReplyResolver: WorkroomProjectionReplyResolver;
  readonly portfolioSponsorControl: AgentHostPortfolioSponsorControlPort;

  constructor(options: WorkroomExecutionCoordinatorOptions) {
    const { generation, signal, resources, lifecycle, handoff, ingress } = options;
    if (!resources.has(outboundMessageToken)) {
      throw new Error('Workroom Execution requires the generation-owned Outbound Message Port');
    }
    const workroomStateRoot = options.persistence.stateRoot;
    const portfolioCoordinator = new WorkroomPortfolioCoordinator({
      generation,
      resources,
      runtime: options.runtime,
      profiles: options.profiles,
      persistence: options.persistence,
    });
    const assignmentCoordinator = new WorkroomAssignmentCoordinator({
      projectRoot: options.projectRoot,
      generation,
      signal,
      resources,
      lifecycle,
      handoff,
      snapshots: options.snapshots,
      selfDelivery: options.selfDelivery,
      ingress,
      agent: options.agent,
      runtime: options.runtime,
      profiles: options.profiles,
      persistence: options.persistence,
      acceptance: options.acceptance,
    });
    const projectionCoordinator = new WorkroomProjectionCoordinator({
      stateRoot: workroomStateRoot,
      resources,
      lifecycle,
      handoff,
      im: options.im,
      runtime: options.runtime,
      governance: options.governance,
      portfolioSponsor: portfolioCoordinator.projectionSource,
    });
    new WorkroomExecutionControlCoordinator({
      generation,
      signal,
      resources,
      lifecycle,
      handoff,
      stateRoot: workroomStateRoot,
      runtime: options.runtime,
      governance: options.governance,
      portfolioCapacity: portfolioCoordinator.capacity,
      dispatch: assignmentCoordinator.dispatch,
    });
    this.portfolioSponsorControl = portfolioCoordinator.sponsorControl;
    this.projectionRepository = projectionCoordinator.repository;
    this.projectionReplyResolver = projectionCoordinator.replyResolver;
  }
}
