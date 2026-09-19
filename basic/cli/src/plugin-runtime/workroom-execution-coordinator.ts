import { join } from 'node:path';
import { formatCompact, getLogger } from '@zhin.js/logger';
import { outboundMessageToken, type ImRuntime } from '@zhin.js/core/runtime';
import {
  FilePortfolioJournalRepository,
  FileWorkroomProjectionRepository,
  type WorkroomPreemptionState,
} from '@zhin.js/agent';
import {
  GenerationOwnedPortfolioCapacityRuntime,
  JournalWorkroomPreemptionCheckpointAckReader,
  KernelPortfolioGrantAssignmentIssuance,
  PortfolioGrantAssignmentAuthority,
  WorkroomAssignmentCheckpointDelivery,
  WorkroomPortfolioCheckpointAckAdapter,
  WorkroomPortfolioAssignmentFailureAuthority,
  WorkroomPortfolioGrantAssignmentSaga,
  WorkroomPreemptionRuntime,
  WorkroomProjectionReplyResolver,
  WorkroomSchedulerRuntime,
  WorkroomSchedulerSupplyUnavailableError,
  WorkroomPortfolioSponsorRuntime,
  createCatalogGovernedWorkroomProjectionAuthority,
  createCatalogPortfolioSponsorCommandAuthority,
  createGovernedPortfolioSponsorProjectionReader,
  createWorkroomRemoteCallbackRuntime,
  createWorkroomSchedulerKernelCommandPort,
  installWorkroomPortfolioControlWorker,
  portfolioAtomicBundleAuthorityToken,
  portfolioCapacityRuntimeToken,
  portfolioClockAuthorityToken,
  portfolioControlOutboxRepositoryToken,
  portfolioJournalRepositoryToken,
  portfolioKernelCommandAuthorityToken,
  portfolioPolicyAuthorityToken,
  portfolioSponsorCommandToken,
  portfolioUsageGatewayAuthorityToken,
  workroomCheckpointDeliveryProviderToken,
  workroomPortfolioCheckpointAckAdapterToken,
  workroomPreemptionRuntimeToken,
  workroomRemoteCallbackRuntimeToken,
  workroomSchedulerCapacityRequestToken,
  workroomSchedulerDispatchSupplyToken,
  workroomSchedulerRuntimeToken,
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
import type { WorkroomPersistenceCoordinator } from './workroom-persistence-coordinator.js';
import type { WorkroomProfileCoordinator } from './workroom-profile-coordinator.js';
import { WorkroomProjectionCoordinator } from './workroom-projection-coordinator.js';
import type { WorkroomRuntimeFoundation } from './workroom-runtime-foundation.js';

const logger = getLogger('agent');

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
    const governedOutbound = options.governance.governedOutbound;
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
    const schedulerDispatch = assignmentCoordinator.dispatch;
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
    this.projectionRepository = projectionCoordinator.repository;
    this.projectionReplyResolver = projectionCoordinator.replyResolver;
  }
}
