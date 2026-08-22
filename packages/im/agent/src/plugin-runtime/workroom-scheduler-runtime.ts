import { compareCanonicalWorkroomText } from '../workroom/canonical-value.js';
import { createToken } from '@zhin.js/plugin-runtime';
import type { WorkroomEvent, WorkroomRunState } from '../workroom/kernel-contracts.js';
import type { WorkroomJournal } from '../workroom/journal.js';
import type { WorkroomCatalog } from '../workroom/catalog.js';
import type { RemoteAssignmentDispatchCommandService } from '../workroom/remote-assignment-dispatch-command.js';
import {
  WorkroomSchedulerApplication,
  type WorkroomSchedulerKernelCommandPort,
} from '../workroom/workroom-scheduler-application.js';
export { createWorkroomSchedulerKernelCommandPort } from '../workroom/workroom-scheduler-application.js';
import {
  decideWorkroomSchedule,
  parseWorkroomDispatchTaskDecision,
  type WorkroomDispatchTaskDecision,
} from '../workroom/workroom-scheduler.js';

export interface WorkroomSchedulerDispatchSupplyPort {
  /** Side-effect-free exact readiness probe used only to recover this decision's supply blocker. */
  probe?(decision: WorkroomDispatchTaskDecision): Promise<boolean>;
  /** Idempotently consumes a durable scheduler.dispatch_requested fact. */
  deliver(decision: WorkroomDispatchTaskDecision): Promise<void>;
}

export interface RemoteWorkroomSchedulerDispatchSupplyOptions {
  readonly catalog: Pick<WorkroomCatalog, 'read'>;
  readonly runState: Readonly<{
    read(projectId: string, runId: string): Promise<WorkroomRunState>;
    pinTaskAcceptance(projectId: string, runId: string, taskKey: string): Promise<WorkroomRunState>;
  }>;
  readonly dispatch: Pick<RemoteAssignmentDispatchCommandService, 'issue'>;
  readonly route: WorkroomSchedulerAssignmentRoutePort;
}

export interface WorkroomSchedulerAssignmentRoutePort {
  resolve(input: Readonly<{
    decision: WorkroomDispatchTaskDecision;
    catalog: Awaited<ReturnType<WorkroomCatalog['read']>>;
  }>): Promise<WorkroomSchedulerAssignmentRoute | null>;
}

export type WorkroomSchedulerAssignmentRoute =
  | Readonly<{
      kind: 'local';
      agentDefinitionId: string;
      authorityRef: string;
    }>
  | Readonly<{
      kind: 'remote';
      agentDefinitionId: string;
      endpointId: string;
      authorityRef: string;
    }>;

export class WorkroomSchedulerAssignmentRouteUnavailableError extends Error {
  constructor(readonly decision: WorkroomDispatchTaskDecision, options?: ErrorOptions) {
    super(`Workroom Scheduler Assignment route is unavailable for ${decision.taskKey}`, options);
    this.name = 'WorkroomSchedulerAssignmentRouteUnavailableError';
  }
}

/** Supply owns an exact durable blocker outside the Kernel Journal. */
export class WorkroomSchedulerDurablyBlockedError extends Error {
  constructor(readonly decision: WorkroomDispatchTaskDecision, readonly blockerRef: string) {
    super(`Workroom Scheduler supply remains durably blocked for ${decision.taskKey}`);
    this.name = 'WorkroomSchedulerDurablyBlockedError';
  }
}

/** Exact, ambiguity-free Catalog + remote command adapter for Scheduler outbox facts. */
export class RemoteWorkroomSchedulerDispatchSupply
implements WorkroomSchedulerDispatchSupplyPort {
  constructor(readonly options: RemoteWorkroomSchedulerDispatchSupplyOptions) {}

  async deliver(decision: WorkroomDispatchTaskDecision): Promise<void> {
    const catalog = await this.options.catalog.read();
    const definition = catalog.definitions[decision.projectId];
    if (!definition || definition.enabled === false) {
      throw new Error(`Workroom Scheduler Project ${decision.projectId} is not enabled in Catalog`);
    }
    const route = await this.options.route.resolve({ decision, catalog });
    if (!route || route.kind !== 'remote') {
      throw new WorkroomSchedulerAssignmentRouteUnavailableError(decision);
    }
    const agentDefinitionId = requiredText(route.agentDefinitionId, 'agentDefinitionId');
    const endpointId = requiredText(route.endpointId, 'endpointId');
    requiredText(route.authorityRef, 'authorityRef');
    if (!definition.members.some(member =>
      member.role === decision.role && member.agent === agentDefinitionId)) {
      throw new Error('Workroom Scheduler Assignment route is outside the exact Catalog role binding');
    }
    let state = await this.options.runState.read(decision.projectId, decision.runId);
    let task = state.tasks[decision.taskKey];
    if (!task || task.revision !== decision.taskRevision || task.status !== 'ready') {
      throw new Error('Workroom Scheduler dispatch decision is stale for current Task state');
    }
    if (!task.acceptanceContract) {
      state = await this.options.runState.pinTaskAcceptance(
        decision.projectId,
        decision.runId,
        decision.taskKey,
      );
      task = state.tasks[decision.taskKey];
      if (!task?.acceptanceContract) {
        throw new Error('Workroom Scheduler supply failed to pin Task Acceptance Contract');
      }
    }
    await this.options.dispatch.issue({
      operationId: decision.decisionId,
      projectId: decision.projectId,
      runId: decision.runId,
      taskKey: decision.taskKey,
      agentDefinitionId,
      endpointId,
    });
  }
}

export const workroomSchedulerDispatchSupplyToken =
  createToken<WorkroomSchedulerDispatchSupplyPort>(
    'zhin.agent.workroom-scheduler-dispatch-supply',
    'Generation-owned Assignment authority/supply consuming durable Workroom Scheduler decisions',
  );

export const workroomSchedulerRuntimeToken = createToken<WorkroomSchedulerRuntime>(
  'zhin.agent.workroom-scheduler-runtime',
  'Generation-owned deterministic Workroom Scheduler recovery loop',
);

export class WorkroomSchedulerSupplyUnavailableError extends Error {
  constructor() {
    super('Workroom Scheduler Assignment authority/supply is not installed');
    this.name = 'WorkroomSchedulerSupplyUnavailableError';
  }
}

export interface WorkroomSchedulerRuntimeOptions {
  readonly journal: Pick<WorkroomJournal, 'listRunIds' | 'read'>;
  readonly commands: WorkroomSchedulerKernelCommandPort;
  readonly resolveSupply: () => WorkroomSchedulerDispatchSupplyPort | undefined;
  readonly unavailableControl?: Readonly<{
    block(decision: WorkroomDispatchTaskDecision): Promise<void>;
    recover(decision: WorkroomDispatchTaskDecision): Promise<void>;
  }>;
  readonly intervalMs?: number;
  readonly onError?: (error: unknown) => void;
}

export interface WorkroomSchedulerDrainResult {
  readonly scheduled: number;
  readonly delivered: number;
}

/** Generation-owned wake/recovery loop; all queue truth remains in Journal. */
export class WorkroomSchedulerRuntime {
  readonly #application: WorkroomSchedulerApplication;
  readonly #intervalMs: number;
  #timer?: ReturnType<typeof setTimeout>;
  #running?: Promise<WorkroomSchedulerDrainResult>;
  #stopped = false;

  constructor(readonly options: WorkroomSchedulerRuntimeOptions) {
    this.#intervalMs = positiveInteger(options.intervalMs ?? 1_000, 'intervalMs');
    this.#application = new WorkroomSchedulerApplication({
      journal: options.journal,
      commands: options.commands,
    });
  }

  start(): void {
    if (this.#stopped) throw new Error('Workroom Scheduler Runtime is stopped');
    if (this.#timer) return;
    this.#schedule(0);
  }

  async drain(): Promise<WorkroomSchedulerDrainResult> {
    if (this.#stopped) throw new Error('Workroom Scheduler Runtime is stopped');
    if (this.#running) return await this.#running;
    const running = this.#drain();
    this.#running = running;
    try {
      return await running;
    } finally {
      if (this.#running === running) this.#running = undefined;
    }
  }

  async dispose(): Promise<void> {
    this.#stopped = true;
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = undefined;
    await this.#running;
  }

  async #drain(): Promise<WorkroomSchedulerDrainResult> {
    const supply = this.options.resolveSupply();
    if (!supply) {
      if (this.options.unavailableControl) {
        for (const runId of [...await this.options.journal.listRunIds()].sort()) {
          const decision = decideWorkroomSchedule(await this.options.journal.read(runId));
          if (decision?.type === 'dispatch_task') await this.options.unavailableControl.block(decision);
        }
      }
      throw new WorkroomSchedulerSupplyUnavailableError();
    }
    const attempted = new Set<string>();
    let delivered = await this.#recoverPending(supply, attempted);
    const scheduled = (await this.#application.recover())
      .filter(result => result.status === 'committed').length;
    delivered += await this.#recoverPending(supply, attempted);
    return Object.freeze({ scheduled, delivered });
  }

  async #recoverPending(
    supply: WorkroomSchedulerDispatchSupplyPort,
    attempted: Set<string>,
  ): Promise<number> {
    let delivered = 0;
    for (const runId of [...await this.options.journal.listRunIds()].sort()) {
      const events = await this.options.journal.read(runId);
      for (const decision of pendingDispatches(events)) {
        if (attempted.has(decision.decisionId)) continue;
        attempted.add(decision.decisionId);
        try {
          if (supply.probe) {
            const ready = await supply.probe(decision);
            if (!ready) {
              await this.options.unavailableControl?.block(decision);
              continue;
            }
          }
          await supply.deliver(decision);
          await this.options.unavailableControl?.recover(decision);
        } catch (error) {
          if (error instanceof WorkroomSchedulerDurablyBlockedError) continue;
          if (error instanceof WorkroomSchedulerAssignmentRouteUnavailableError
            && this.options.unavailableControl) {
            await this.options.unavailableControl.block(decision);
            continue;
          }
          throw error;
        }
        delivered += 1;
      }
    }
    return delivered;
  }

  #schedule(delay: number): void {
    this.#timer = setTimeout(() => {
      this.#timer = undefined;
      if (this.#stopped) return;
      void this.drain()
        .catch(error => this.options.onError?.(error))
        .finally(() => {
          if (!this.#stopped) this.#schedule(this.#intervalMs);
        });
    }, delay);
    this.#timer.unref?.();
  }
}

function pendingDispatches(events: readonly WorkroomEvent[]): readonly WorkroomDispatchTaskDecision[] {
  const latestTerminal = new Map<string, number>();
  const latestClaim = new Map<string, number>();
  const latestRevision = new Map<string, number>();
  let cancelledAt = Number.POSITIVE_INFINITY;
  for (const event of events) {
    if (event.type === 'run.cancel_requested' || event.type === 'run.cancelled') {
      cancelledAt = Math.min(cancelledAt, event.sequence);
    }
    if (event.type === 'assignment.claimed') {
      latestClaim.set(
        `${String(event.payload.taskKey)}:${Number(event.payload.taskRevision)}`,
        event.sequence,
      );
    }
    if (event.type === 'task.accepted' || event.type === 'task.failed' || event.type === 'task.cancelled') {
      latestTerminal.set(String(event.payload.taskKey), event.sequence);
    }
    if (event.type === 'task.revised' || event.type === 'task.rework_requested') {
      latestRevision.set(String(event.payload.taskKey), event.sequence);
    }
  }
  return Object.freeze(events
    .filter(event => event.type === 'scheduler.dispatch_requested')
    .map(event => Object.freeze({ event, decision: parseWorkroomDispatchTaskDecision(event.payload) }))
    .filter(({ event, decision }) => event.sequence < cancelledAt
      && (latestClaim.get(`${decision.taskKey}:${decision.taskRevision}`) ?? -1) <= event.sequence
      && (latestTerminal.get(decision.taskKey) ?? -1) <= event.sequence
      && (latestRevision.get(decision.taskKey) ?? -1) <= event.sequence)
    .map(({ decision }) => decision)
    .sort((left, right) => compareCanonicalWorkroomText(left.decisionId, right.decisionId)));
}

function positiveInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    throw new Error(`Workroom Scheduler Runtime ${label} must be a positive safe integer`);
  }
  return Number(value);
}

function requiredText(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim()) {
    throw new Error(`Remote Workroom Scheduler supply ${label} is required`);
  }
  return value;
}
