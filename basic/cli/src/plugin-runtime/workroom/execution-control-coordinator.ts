import { type WorkroomPreemptionState } from '@zhin.js/agent';
import {
  GenerationOwnedPortfolioCapacityRuntime,
  JournalWorkroomPreemptionCheckpointAckReader,
  KernelPortfolioGrantAssignmentIssuance,
  PortfolioGrantAssignmentAuthority,
  WorkroomAssignmentCheckpointDelivery,
  WorkroomPortfolioCheckpointAckAdapter,
  WorkroomPortfolioGrantAssignmentSaga,
  WorkroomPreemptionRuntime,
  WorkroomSchedulerRuntime,
  WorkroomSchedulerSupplyUnavailableError,
  createWorkroomRemoteCallbackRuntime,
  createWorkroomSchedulerKernelCommandPort,
  installWorkroomPortfolioControlWorker,
  portfolioControlOutboxRepositoryToken,
  portfolioJournalRepositoryToken,
  workroomCheckpointDeliveryProviderToken,
  workroomPortfolioCheckpointAckAdapterToken,
  workroomPreemptionRuntimeToken,
  workroomRemoteCallbackRuntimeToken,
  workroomSchedulerDispatchSupplyToken,
  workroomSchedulerRuntimeToken,
  type WorkroomSchedulerPortfolioDispatchResources,
} from '@zhin.js/agent/runtime';
import { formatCompact, getLogger } from '@zhin.js/logger';
import type { RootResourceInstaller } from '@zhin.js/runtime';
import type { WorkroomDataGovernanceCoordinator } from './data-governance-coordinator.js';
import type { WorkroomRuntimeFoundation } from './runtime-foundation.js';

const logger = getLogger('agent');
type RootResourceContext = Parameters<RootResourceInstaller>[0];

export interface WorkroomExecutionControlCoordinatorOptions {
  readonly generation: number;
  readonly signal: AbortSignal;
  readonly resources: RootResourceContext['resources'];
  readonly lifecycle: RootResourceContext['lifecycle'];
  readonly handoff: RootResourceContext['handoff'];
  readonly stateRoot: string;
  readonly runtime: WorkroomRuntimeFoundation;
  readonly governance: WorkroomDataGovernanceCoordinator;
  readonly portfolioCapacity: GenerationOwnedPortfolioCapacityRuntime;
  readonly dispatch: WorkroomSchedulerPortfolioDispatchResources;
}

/** Owns Scheduler, preemption, Portfolio control, and remote callback lifecycle. */
export class WorkroomExecutionControlCoordinator {
  constructor(options: WorkroomExecutionControlCoordinatorOptions) {
    const { generation, signal, resources, lifecycle, handoff } = options;
    if (!resources.has(portfolioJournalRepositoryToken)
      || !resources.has(portfolioControlOutboxRepositoryToken)) {
      throw new Error('Workroom Execution Control requires durable Portfolio repositories');
    }
    const workroomJournal = options.runtime.journal;
    const workroomCatalog = options.runtime.catalog;
    const workroomKernel = options.runtime.kernel;
    const schedulerDispatch = options.dispatch;
    const portfolioCapacity = options.portfolioCapacity;
    const workroomStateRoot = options.stateRoot;
    const governedOutbound = options.governance.governedOutbound;
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
  }
}
