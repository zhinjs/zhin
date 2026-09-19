import { join } from 'node:path';
import { outboundMessageToken, type ImRuntime } from '@zhin.js/core/runtime';
import {
  FilePortfolioJournalRepository,
  FileWorkroomProjectionRepository,
} from '@zhin.js/agent';
import {
  GenerationOwnedPortfolioCapacityRuntime,
  WorkroomPortfolioAssignmentFailureAuthority,
  WorkroomProjectionReplyResolver,
  WorkroomPortfolioSponsorRuntime,
  createCatalogGovernedWorkroomProjectionAuthority,
  createCatalogPortfolioSponsorCommandAuthority,
  createGovernedPortfolioSponsorProjectionReader,
  portfolioAtomicBundleAuthorityToken,
  portfolioCapacityRuntimeToken,
  portfolioClockAuthorityToken,
  portfolioControlOutboxRepositoryToken,
  portfolioJournalRepositoryToken,
  portfolioKernelCommandAuthorityToken,
  portfolioPolicyAuthorityToken,
  portfolioSponsorCommandToken,
  portfolioUsageGatewayAuthorityToken,
  workroomSchedulerCapacityRequestToken,
  type AgentHostPortfolioSponsorControlPort,
  type CapabilityIngress,
  type PortfolioAtomicBundleAuthorityPort,
  type PortfolioClockAuthorityPort,
  type PortfolioKernelCommandAuthorityPort,
  type PortfolioSponsorProjection,
  type PortfolioUsageGatewayAuthorityPort,
  type SelfDeliveryHostConfiguration,
} from '@zhin.js/agent/runtime';
import type { SnapshotReader } from '@zhin.js/plugin-runtime';
import type { RootResourceInstaller } from '@zhin.js/runtime';
import {
  installLocalWorkroomPortfolioAuthorities,
} from './local-workroom-portfolio.js';
import type { AgentRuntimeFoundation } from './agent-runtime-foundation.js';
import { WorkroomAssignmentCoordinator } from './workroom-assignment-coordinator.js';
import type { WorkroomAcceptanceCoordinator } from './workroom-acceptance-coordinator.js';
import type { WorkroomDataGovernanceCoordinator } from './workroom-data-governance-coordinator.js';
import { WorkroomExecutionControlCoordinator } from './workroom-execution-control-coordinator.js';
import type { WorkroomPersistenceCoordinator } from './workroom-persistence-coordinator.js';
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
    const portfolioControlOutbox = options.persistence.portfolioControlOutbox;
    const workroomJournal = options.runtime.journal;
    const workroomCatalog = options.runtime.catalog;
    const workroomKernel = options.runtime.kernel;
    const projectProfiles = options.profiles.profiles;
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
        governance: options.runtime.governance,
      }),
    });
    this.portfolioSponsorControl = Object.freeze({
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
      portfolioSponsor: portfolioSponsorProjectionSource,
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
      portfolioCapacity,
      dispatch: assignmentCoordinator.dispatch,
    });
    this.projectionRepository = projectionCoordinator.repository;
    this.projectionReplyResolver = projectionCoordinator.replyResolver;
  }
}
