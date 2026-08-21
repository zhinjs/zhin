import type {
  CapacityRequest,
  PortfolioActor,
  PortfolioPolicySnapshot,
  ProjectPortfolioPolicy,
} from './portfolio-admission.ts';

export const portfolioKernel: PortfolioActor = { id: 'kernel:portfolio', role: 'portfolio_kernel' };
export const sponsor: PortfolioActor = { id: 'human:sponsor', role: 'sponsor' };
export const usageGateway: PortfolioActor = { id: 'gateway:billing', role: 'usage_gateway' };

export function scheduler(projectId: string): PortfolioActor {
  return { id: `scheduler:${projectId}`, role: 'workroom_scheduler', projectId };
}

export function workroomKernel(projectId: string): PortfolioActor {
  return { id: `kernel:${projectId}`, role: 'workroom_kernel', projectId };
}

export function projectPolicy(
  projectId: string,
  lane: ProjectPortfolioPolicy['lane'] = 'normal',
  weight = 1,
  overrides: Partial<ProjectPortfolioPolicy> = {},
): ProjectPortfolioPolicy {
  return {
    projectId,
    revision: 1,
    lane,
    weight,
    hardBudgetMicros: 100_000,
    maxConcurrentGrants: 2,
    maxOutstandingRequests: 32,
    starvationAfterTicks: 6,
    status: 'active',
    allowedPools: ['model:premium', 'executor:sandbox'],
    ...overrides,
  };
}

export function fixturePolicy(
  projects: readonly ProjectPortfolioPolicy[] = [
    projectPolicy('project:software', 'normal', 2),
    projectPolicy('project:content', 'normal', 1),
    projectPolicy('project:support', 'urgent', 1),
  ],
): PortfolioPolicySnapshot {
  return {
    revision: 1,
    globalBudgetMicros: 1_000_000,
    offerTtlTicks: 2,
    leaseTtlTicks: 5,
    reclaimDeadlineTicks: 2,
    pools: {
      'model:premium': {
        id: 'model:premium',
        capacityUnits: 1,
        maxUnitsPerRequest: 1,
        rateUnitsPerWindow: 100,
        rateWindowTicks: 100,
        pricePerBudgetUnitMicros: 10,
      },
      'executor:sandbox': {
        id: 'executor:sandbox',
        capacityUnits: 2,
        maxUnitsPerRequest: 1,
        rateUnitsPerWindow: 100,
        rateWindowTicks: 100,
        pricePerBudgetUnitMicros: 1,
      },
    },
    projects: Object.fromEntries(projects.map((project) => [project.projectId, project])),
  };
}

export function request(
  id: string,
  projectId: string,
  localOrder: number,
  options: Partial<Pick<CapacityRequest, 'preemptibility' | 'deadline'>> & {
    modelBudgetUnits?: number;
    includeExecutor?: boolean;
  } = {},
) {
  const demands = [
    { poolId: 'model:premium', capacityUnits: 1, rateUnits: 1, budgetUnits: options.modelBudgetUnits ?? 1 },
  ];
  if (options.includeExecutor ?? true) {
    demands.push({ poolId: 'executor:sandbox', capacityUnits: 1, rateUnits: 1, budgetUnits: 1 });
  }
  return {
    id,
    projectId,
    workRef: {
      runId: `run:${projectId}`,
      schedulerSequence: localOrder,
      localOrder,
      profileDigest: `sha256:profile:${projectId}`,
    },
    demands,
    preemptibility: options.preemptibility ?? 'checkpointable',
    ...(options.deadline === undefined ? {} : { deadline: options.deadline }),
  } as const;
}
