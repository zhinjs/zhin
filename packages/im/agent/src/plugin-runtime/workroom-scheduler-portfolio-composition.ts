import type { Scope } from '@zhin.js/plugin-runtime';
import type { WorkroomCatalog } from '../workroom/catalog.js';
import type { WorkroomJournal } from '../workroom/journal.js';
import type { WorkroomRunState } from '../workroom/kernel-contracts.js';
import type { ProjectProfileRegistry } from '../workroom/profile-registry.js';
import type { PortfolioResourceBundle } from '../portfolio/portfolio-journal.js';
import {
  portfolioAtomicBundleAuthorityToken,
  portfolioPolicyAuthorityToken,
  workroomSchedulerCapacityRequestToken,
  type PortfolioAtomicBundleAuthorityPort,
  type PortfolioPolicyAuthorityPort,
  type WorkroomSchedulerCapacityRequest,
} from './workroom-portfolio-capacity.js';
import {
  PinnedProfileWorkroomSchedulerPortfolioRequestAuthority,
  workroomSchedulerPortfolioScopeAuthorityToken,
  type WorkroomSchedulerPortfolioScopeAuthorityPort,
} from './workroom-scheduler-portfolio-request-authority.js';
import {
  GenerationOwnedWorkroomSchedulerAssignmentRouteRegistry,
  workroomSchedulerAssignmentRouteRegistryToken,
} from './workroom-scheduler-route-registry.js';
import {
  PortfolioFirstWorkroomSchedulerDispatchSupply,
  workroomSchedulerPortfolioRequestAuthorityToken,
  type WorkroomSchedulerPortfolioRequestAuthorityPort,
} from './workroom-scheduler-portfolio-supply.js';
import {
  workroomSchedulerDispatchSupplyToken,
} from './workroom-scheduler-runtime.js';

export interface InstallWorkroomSchedulerPortfolioDispatchResourcesOptions {
  readonly generation: number;
  readonly signal: AbortSignal;
  readonly resources: Pick<Scope, 'has' | 'provide' | 'use'>;
  readonly catalog: Pick<WorkroomCatalog, 'read'>;
  readonly profiles: Pick<ProjectProfileRegistry, 'read'>;
  readonly journal?: Pick<WorkroomJournal, 'read'>;
  readonly fallbackResourceRequirements?: PortfolioResourceBundle;
  readonly runState: Readonly<{
    read(projectId: string, runId: string): Promise<WorkroomRunState>;
    pinTaskAcceptance(projectId: string, runId: string, taskKey: string): Promise<WorkroomRunState>;
  }>;
}

export interface WorkroomSchedulerPortfolioDispatchResources {
  readonly routes: GenerationOwnedWorkroomSchedulerAssignmentRouteRegistry;
  readonly supply: PortfolioFirstWorkroomSchedulerDispatchSupply;
}

/**
 * Installs the Portfolio-first Scheduler boundary before any local/remote route
 * producer. Missing request/capacity authorities remain runtime blockers and do
 * not reject the candidate Root generation.
 */
export function installWorkroomSchedulerPortfolioDispatchResources(
  options: InstallWorkroomSchedulerPortfolioDispatchResourcesOptions,
): WorkroomSchedulerPortfolioDispatchResources {
  options.signal.throwIfAborted();
  const routes = options.resources.has(workroomSchedulerAssignmentRouteRegistryToken)
    ? options.resources.use(workroomSchedulerAssignmentRouteRegistryToken)
    : new GenerationOwnedWorkroomSchedulerAssignmentRouteRegistry({
        generation: options.generation,
        signal: options.signal,
        profiles: options.profiles,
      });
  if (routes.generation !== options.generation) {
    throw new Error('Workroom Scheduler route registry generation is stale');
  }
  if (!options.resources.has(workroomSchedulerAssignmentRouteRegistryToken)) {
    options.resources.provide(workroomSchedulerAssignmentRouteRegistryToken, routes);
  }
  if (options.journal && !options.resources.has(workroomSchedulerPortfolioRequestAuthorityToken)) {
    options.resources.provide(
      workroomSchedulerPortfolioRequestAuthorityToken,
      new PinnedProfileWorkroomSchedulerPortfolioRequestAuthority({
        generation: options.generation,
        journal: options.journal,
        profiles: options.profiles,
        scopes: Object.freeze({
          resolve: (input: Parameters<WorkroomSchedulerPortfolioScopeAuthorityPort['resolve']>[0]) =>
            options.resources.has(workroomSchedulerPortfolioScopeAuthorityToken)
              ? options.resources.use(workroomSchedulerPortfolioScopeAuthorityToken).resolve(input)
              : Promise.resolve(undefined),
        }),
        policies: Object.freeze({
          resolve: (portfolioId: Parameters<PortfolioPolicyAuthorityPort['resolve']>[0]) =>
            options.resources.has(portfolioPolicyAuthorityToken)
              ? options.resources.use(portfolioPolicyAuthorityToken).resolve(portfolioId)
              : Promise.resolve(undefined),
        }),
        bundles: Object.freeze({
          validate: (input: Parameters<PortfolioAtomicBundleAuthorityPort['validate']>[0]) =>
            options.resources.has(portfolioAtomicBundleAuthorityToken)
              ? options.resources.use(portfolioAtomicBundleAuthorityToken).validate(input)
              : Promise.resolve(undefined),
        }),
        ...(options.fallbackResourceRequirements
          ? { fallbackResourceRequirements: options.fallbackResourceRequirements }
          : {}),
      }),
    );
  }

  let supply: PortfolioFirstWorkroomSchedulerDispatchSupply;
  if (options.resources.has(workroomSchedulerDispatchSupplyToken)) {
    const existing = options.resources.use(workroomSchedulerDispatchSupplyToken);
    if (!(existing instanceof PortfolioFirstWorkroomSchedulerDispatchSupply)) {
      throw new Error('Workroom Scheduler direct Assignment supply bypasses Portfolio admission');
    }
    supply = existing;
  } else {
    supply = new PortfolioFirstWorkroomSchedulerDispatchSupply({
      generation: options.generation,
      catalog: options.catalog,
      routes,
      requests: Object.freeze({
        resolve: (input: Parameters<WorkroomSchedulerPortfolioRequestAuthorityPort['resolve']>[0]) =>
          options.resources.has(workroomSchedulerPortfolioRequestAuthorityToken)
          ? options.resources.use(workroomSchedulerPortfolioRequestAuthorityToken).resolve(input)
          : Promise.resolve(undefined),
      }),
      capacity: Object.freeze({
        request: (input: WorkroomSchedulerCapacityRequest) => {
          if (!options.resources.has(workroomSchedulerCapacityRequestToken)) {
            return Promise.reject(new Error('Portfolio Capacity Request runtime is unavailable'));
          }
          return options.resources.use(workroomSchedulerCapacityRequestToken).request(input);
        },
      }),
      runState: options.runState,
    });
    options.resources.provide(workroomSchedulerDispatchSupplyToken, supply);
  }
  return Object.freeze({ routes, supply });
}
