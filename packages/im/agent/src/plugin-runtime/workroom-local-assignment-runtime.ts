import { createToken } from '@zhin.js/plugin-runtime';
import {
  executeAssignment,
  type AssignmentExecutionEnvelope,
  type AssignmentExecutorPort,
} from '../workroom/assignment-executor.js';
import { AssignmentObservationIngress } from '../workroom/assignment-observation-ingress.js';
import { WorkroomSequenceConflictError } from '../workroom/journal.js';
import type {
  WorkroomKernel,
  WorkroomLocalAssignmentIssuanceReceipt,
} from '../workroom/workroom-kernel.js';

export interface WorkroomLocalAssignmentRuntimeOptions {
  readonly kernel: WorkroomKernel;
  readonly executor: AssignmentExecutorPort;
  readonly now?: () => number;
  readonly intervalMs?: number;
  readonly maxCasRetries?: number;
  readonly onError?: (error: unknown) => void;
}

export interface WorkroomLocalAssignmentDrainResult {
  readonly started: number;
  readonly recovered: number;
}

export const workroomLocalAssignmentRuntimeToken = createToken<WorkroomLocalAssignmentRuntime>(
  'zhin.agent.workroom-local-assignment-runtime',
  'Generation-owned local Assignment execution and Journal recovery worker',
);

/**
 * Durable Journal consumer for local execution. `leased` is safe to start;
 * `running` is never replayed after restart and can only expire outcome_unknown.
 */
export class WorkroomLocalAssignmentRuntime {
  readonly #ingress: AssignmentObservationIngress;
  readonly #now: () => number;
  readonly #intervalMs: number;
  readonly #maxCasRetries: number;
  readonly #active = new Map<string, Readonly<{
    controller: AbortController;
    promise: Promise<void>;
  }>>();
  #timer?: ReturnType<typeof setTimeout>;
  #draining?: Promise<WorkroomLocalAssignmentDrainResult>;
  #stopped = false;

  constructor(readonly options: WorkroomLocalAssignmentRuntimeOptions) {
    this.#ingress = new AssignmentObservationIngress({ kernel: options.kernel });
    this.#now = options.now ?? Date.now;
    this.#intervalMs = positive(options.intervalMs ?? 1_000, 'intervalMs');
    this.#maxCasRetries = positive(options.maxCasRetries ?? 4, 'maxCasRetries');
  }

  start(): void {
    if (this.#stopped) throw new Error('Workroom Local Assignment Runtime is stopped');
    if (!this.#timer) this.#schedule(0);
  }

  async drain(): Promise<WorkroomLocalAssignmentDrainResult> {
    if (this.#stopped) throw new Error('Workroom Local Assignment Runtime is stopped');
    if (this.#draining) return await this.#draining;
    const pending = this.#drain();
    this.#draining = pending;
    try {
      return await pending;
    } finally {
      if (this.#draining === pending) this.#draining = undefined;
    }
  }

  /** Public exact-Envelope seam used by tests and the durable worker. */
  async execute(envelope: AssignmentExecutionEnvelope): Promise<void> {
    if (this.#stopped) throw new Error('Workroom Local Assignment Runtime is stopped');
    const existing = this.#active.get(envelope.assignmentId);
    if (existing) return await existing.promise;
    const controller = new AbortController();
    const promise = (async () => {
      await this.#assertLeased(envelope);
      await this.#execute(envelope, controller.signal);
    })();
    this.#active.set(envelope.assignmentId, Object.freeze({ controller, promise }));
    try {
      await promise;
    } finally {
      if (this.#active.get(envelope.assignmentId)?.promise === promise) {
        this.#active.delete(envelope.assignmentId);
      }
    }
  }

  /** Non-blocking wake used only after the issuance fact is durable. */
  dispatch(envelope: AssignmentExecutionEnvelope): void {
    void this.execute(envelope).catch(error => this.options.onError?.(error));
  }

  async dispose(): Promise<void> {
    this.#stopped = true;
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = undefined;
    await this.#draining;
    const active = [...this.#active.values()];
    for (const { controller } of active) {
      controller.abort(new Error('Workroom Local Assignment generation disposed'));
    }
    await Promise.allSettled(active.map(({ promise }) => promise));
  }

  async #drain(): Promise<WorkroomLocalAssignmentDrainResult> {
    let started = 0;
    let recovered = 0;
    const issuances = await this.options.kernel.listLocalAssignmentIssuances();
    for (const issuance of issuances) {
      const state = await this.options.kernel.read(
        issuance.envelope.projectId,
        issuance.envelope.runId,
      );
      const assignment = state.assignments[issuance.envelope.assignmentId];
      if (!assignment || assignment.envelopeDigest !== issuance.envelope.digest) {
        throw new Error('Persisted Local Assignment issuance does not match its Kernel claim');
      }
      if (assignment.status === 'leased') {
        started += 1;
        this.dispatch(issuance.envelope);
        continue;
      }
      if (assignment.status === 'cancel_requested') {
        this.#active.get(assignment.id)?.controller.abort(
          new Error('Workroom Local Assignment cancellation requested by Kernel'),
        );
      }
      if ((assignment.status === 'running' || assignment.status === 'cancel_requested')
        && assignment.leaseExpiresAt <= this.#now()) {
        const clock = Math.max(this.#now(), state.now + 1);
        await this.options.kernel.execute(state.projectId, state.runId, {
          type: 'advance_clock',
          now: clock,
        });
        recovered += 1;
      }
    }
    return Object.freeze({ started, recovered });
  }

  async #execute(envelope: AssignmentExecutionEnvelope, signal: AbortSignal): Promise<void> {
    await this.options.kernel.execute(envelope.projectId, envelope.runId, {
      type: 'start_assignment',
      assignmentId: envelope.assignmentId,
    });
    const observations = this.#ingress.bind(envelope);
    for await (const observation of executeAssignment(this.options.executor, envelope, signal)) {
      signal.throwIfAborted();
      let committed = false;
      for (let attempt = 0; attempt < this.#maxCasRetries; attempt += 1) {
        const state = await this.options.kernel.read(envelope.projectId, envelope.runId);
        const assignment = state.assignments[envelope.assignmentId];
        if (!assignment
          || assignment.envelopeDigest !== envelope.digest
          || assignment.fence !== envelope.fence
          || assignment.taskRevision !== envelope.taskRevision) {
          throw new Error('Local Assignment observation Envelope is stale or targets another authority scope');
        }
        try {
          await observations.apply(observation, state.sequence);
          committed = true;
          break;
        } catch (error) {
          if (!(error instanceof WorkroomSequenceConflictError)) throw error;
        }
      }
      if (!committed) {
        throw new Error('Local Assignment observation exceeded Kernel CAS retry budget');
      }
    }
  }

  async #assertLeased(envelope: AssignmentExecutionEnvelope): Promise<void> {
    const state = await this.options.kernel.read(envelope.projectId, envelope.runId);
    const task = state.tasks[envelope.taskKey];
    const assignment = state.assignments[envelope.assignmentId];
    if (!task
      || !assignment
      || assignment.status !== 'leased'
      || task.currentAssignmentId !== assignment.id
      || task.revision !== envelope.taskRevision
      || assignment.taskRevision !== envelope.taskRevision
      || assignment.revision !== envelope.assignmentRevision
      || assignment.attempt !== envelope.attempt
      || assignment.fence !== envelope.fence
      || assignment.envelopeDigest !== envelope.digest
      || assignment.owner !== envelope.principalId
      || assignment.role !== envelope.role) {
      throw new Error('Local Assignment Envelope is stale or targets another authority scope');
    }
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

function positive(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    throw new Error(`Workroom Local Assignment Runtime ${label} must be a positive safe integer`);
  }
  return Number(value);
}

export type { WorkroomLocalAssignmentIssuanceReceipt };
