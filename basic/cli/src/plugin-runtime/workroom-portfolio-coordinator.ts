import { join } from 'node:path';
import { FilePortfolioJournalRepository } from '@zhin.js/agent';
import {
  GenerationOwnedPortfolioCapacityRuntime,
  WorkroomPortfolioAssignmentFailureAuthority,
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
  type PortfolioAtomicBundleAuthorityPort,
  type PortfolioClockAuthorityPort,
  type PortfolioKernelCommandAuthorityPort,
  type PortfolioSponsorProjection,
  type PortfolioUsageGatewayAuthorityPort,
} from '@zhin.js/agent/runtime';
import type { RootResourceInstaller } from '@zhin.js/runtime';
import { installLocalWorkroomPortfolioAuthorities } from './local-workroom-portfolio.js';
import type { WorkroomPersistenceCoordinator } from './workroom-persistence-coordinator.js';
import type { WorkroomProfileCoordinator } from './workroom-profile-coordinator.js';
import type { WorkroomRuntimeFoundation } from './workroom-runtime-foundation.js';

type RootResources = Parameters<RootResourceInstaller>[0]['resources'];

export interface WorkroomPortfolioProjectionSource {
  listPortfolioIds(): Promise<readonly string[]>;
  read(portfolioId: string): Promise<PortfolioSponsorProjection>;
}

export interface WorkroomPortfolioCoordinatorOptions {
  readonly generation: number;
  readonly resources: RootResources;
  readonly runtime: WorkroomRuntimeFoundation;
  readonly profiles: WorkroomProfileCoordinator;
  readonly persistence: WorkroomPersistenceCoordinator;
}

/** Owns durable Portfolio state, Sponsor authority, governance, and capacity admission. */
export class WorkroomPortfolioCoordinator {
  readonly sponsorControl: AgentHostPortfolioSponsorControlPort;
  readonly projectionSource: WorkroomPortfolioProjectionSource;
  readonly capacity: GenerationOwnedPortfolioCapacityRuntime;

  constructor(options: WorkroomPortfolioCoordinatorOptions) {
    const { generation, resources } = options;
    if (resources.has(portfolioCapacityRuntimeToken)
      && resources.use(portfolioCapacityRuntimeToken).options.generation !== generation) {
      throw new Error('Workroom Portfolio Capacity runtime generation is stale');
    }
    const workroomStateRoot = options.persistence.stateRoot;
    const portfolioControlOutbox = options.persistence.portfolioControlOutbox;
    const workroomJournal = options.runtime.journal;
    const workroomCatalog = options.runtime.catalog;
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
    const sponsorControl = Object.freeze({
      read: projectionReader.read,
      execute: portfolioSponsor.execute.bind(portfolioSponsor),
    });
    const projectionSource: WorkroomPortfolioProjectionSource = Object.freeze({
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
    this.sponsorControl = sponsorControl;
    this.projectionSource = projectionSource;
    this.capacity = portfolioCapacity;
  }
}
