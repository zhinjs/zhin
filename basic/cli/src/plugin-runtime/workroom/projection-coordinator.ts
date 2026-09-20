import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { FileWorkroomProjectionRepository } from '@zhin.js/agent';
import {
  WorkroomProjectionReplyResolver,
  WorkroomProjectionRuntime,
  WorkroomProjectionScheduler,
  createWorkroomProjectionOutboundMessageServicePort,
  type PortfolioSponsorProjection,
} from '@zhin.js/agent/runtime';
import { outboundMessageToken, type ImRuntime } from '@zhin.js/core/runtime';
import { formatCompact, getLogger } from '@zhin.js/logger';
import { rootPluginId } from '@zhin.js/plugin-runtime';
import type { RootResourceInstaller } from '@zhin.js/runtime';
import type { WorkroomDataGovernanceCoordinator } from './data-governance-coordinator.js';
import {
  ensureCatalogWorkroomProjectionBinding,
  resolveCatalogSponsorProjectionConversation,
  resolveCatalogWorkroomProjectionConversation,
} from './projection.js';
import type { WorkroomRuntimeFoundation } from './runtime-foundation.js';

const logger = getLogger('agent');
type RootResourceContext = Parameters<RootResourceInstaller>[0];

export interface WorkroomProjectionCoordinatorOptions {
  readonly stateRoot: string;
  readonly resources: RootResourceContext['resources'];
  readonly lifecycle: RootResourceContext['lifecycle'];
  readonly handoff: RootResourceContext['handoff'];
  readonly im: ImRuntime;
  readonly runtime: WorkroomRuntimeFoundation;
  readonly governance: WorkroomDataGovernanceCoordinator;
  readonly portfolioSponsor?: Readonly<{
    listPortfolioIds(): Promise<readonly string[]>;
    read(portfolioId: string): Promise<PortfolioSponsorProjection>;
  }>;
}

/** Owns durable Workroom projection state, outbound delivery, binding renewal, and scheduling. */
export class WorkroomProjectionCoordinator {
  readonly repository: FileWorkroomProjectionRepository;
  readonly replyResolver: WorkroomProjectionReplyResolver;

  constructor(options: WorkroomProjectionCoordinatorOptions) {
    const { resources, lifecycle, handoff } = options;
    if (!resources.has(outboundMessageToken)) {
      throw new Error('Workroom Projection requires the generation-owned Outbound Message Port');
    }
    const workroomCatalog = options.runtime.catalog;
    const workroomJournal = options.runtime.journal;
    const workroomKernel = options.runtime.kernel;
    const governedOutbound = options.governance.governedOutbound;
    const dataLifecycle = options.governance.lifecycle;
    const projectionRepository = new FileWorkroomProjectionRepository(
      join(options.stateRoot, 'workroom-projections'),
    );
    const projectionReplyResolver = new WorkroomProjectionReplyResolver({
      repository: projectionRepository,
      runState: Object.freeze({
        read: async (projectId: string, runId: string) =>
          await workroomKernel.read(projectId, runId),
      }),
    });
    const projectionRuntime = new WorkroomProjectionRuntime({
      catalog: workroomCatalog,
      journal: workroomJournal,
      repository: projectionRepository,
      outbound: createWorkroomProjectionOutboundMessageServicePort(
        resources.use(outboundMessageToken),
        rootPluginId(),
      ),
      workerId: `workroom-projection:${randomUUID()}`,
      leaseMs: 30_000,
      maxRunsPerTick: 64,
      maxDeliveriesPerTick: 32,
      governance: governedOutbound.projection,
      renewWorkroomBinding: async (projectId, catalog, operationSignal) => {
        operationSignal.throwIfAborted();
        const definition = catalog.definitions[projectId];
        if (!definition) return;
        const conversation = resolveCatalogWorkroomProjectionConversation(
          definition,
          options.im.endpoints.list(),
        );
        if (!conversation) return;
        await ensureCatalogWorkroomProjectionBinding({
          repository: projectionRepository,
          catalog,
          projectId,
          conversation,
          interactionBindingRevision: 1,
          endpoints: options.im.endpoints.list(),
        });
      },
      resolveSponsorConversation: (_projectId, definition) =>
        resolveCatalogSponsorProjectionConversation(definition, options.im.endpoints.list()),
      ...(dataLifecycle ? { lifecycleOverdue: dataLifecycle.overdue } : {}),
      ...(options.portfolioSponsor
        ? { portfolioSponsor: options.portfolioSponsor }
        : {}),
    });
    const projectionScheduler = new WorkroomProjectionScheduler({
      runtime: projectionRuntime,
      intervalMs: 1_000,
      onError: error => logger.error(formatCompact({
        op: 'workroom_projection_tick',
        error: error instanceof Error ? error.message : String(error),
      })),
    });
    lifecycle.add(() => projectionScheduler.dispose());
    handoff.add({
      activateNext: signal => {
        signal.throwIfAborted();
        projectionScheduler.start();
      },
    });
    this.repository = projectionRepository;
    this.replyResolver = projectionReplyResolver;
  }
}
