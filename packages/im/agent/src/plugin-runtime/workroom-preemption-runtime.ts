import { createToken } from '@zhin.js/plugin-runtime';
import type { AssignmentExecutionEnvelope } from '../workroom/assignment-executor.js';
import type { WorkroomJournal } from '../workroom/journal.js';
import {
  replayWorkroomPreemptions,
  type WorkroomPreemptionState,
} from '../workroom/workroom-preemption.js';
import type { WorkroomKernel } from '../workroom/workroom-kernel.js';

export interface WorkroomCheckpointTransportRequest {
  readonly version: 1;
  readonly transport: 'local' | 'remote';
  readonly preemption: WorkroomPreemptionState;
  readonly envelope: AssignmentExecutionEnvelope;
  readonly remoteEndpointId?: string;
}

/** A typed producer control transport. It can request a checkpoint, never acknowledge one. */
export interface WorkroomCheckpointDeliveryProviderPort {
  request(input: WorkroomCheckpointTransportRequest, signal: AbortSignal): Promise<void>;
}

export const workroomCheckpointDeliveryProviderToken =
  createToken<WorkroomCheckpointDeliveryProviderPort>(
    'zhin.agent.workroom-checkpoint-delivery-provider',
    'Generation-owned typed checkpoint request transport for current Assignment owners',
  );

export const workroomPreemptionRuntimeToken = createToken<WorkroomPreemptionRuntime>(
  'zhin.agent.workroom-preemption-runtime',
  'Generation-owned durable checkpoint request recovery worker',
);

export class WorkroomCheckpointDeliveryUnavailableError extends Error {
  constructor(
    readonly preemption: WorkroomPreemptionState,
    readonly reason: 'provider_unavailable' | 'issuance_unavailable' | 'assignment_stale' | 'lease_expired' | 'deadline_expired',
  ) {
    super(`Workroom checkpoint delivery is unavailable: ${reason}`);
    this.name = 'WorkroomCheckpointDeliveryUnavailableError';
  }
}

export interface WorkroomAssignmentCheckpointDeliveryOptions {
  readonly kernel: Pick<
    WorkroomKernel,
    'read' | 'listLocalAssignmentIssuances' | 'listRemoteAssignmentIssuances'
  >;
  readonly resolveProvider: () => WorkroomCheckpointDeliveryProviderPort | undefined;
}

/** Joins one durable preemption request to its exact persisted Local/Remote producer. */
export class WorkroomAssignmentCheckpointDelivery {
  constructor(readonly options: WorkroomAssignmentCheckpointDeliveryOptions) {}

  async request(preemption: WorkroomPreemptionState, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    const state = await this.options.kernel.read(preemption.projectId, preemption.runId);
    const assignment = state.assignments[preemption.assignmentId];
    const task = state.tasks[preemption.victimTaskKey];
    if (!assignment || !task
      || assignment.status !== 'running'
      || task.status !== 'executing'
      || task.currentAssignmentId !== assignment.id
      || assignment.owner !== preemption.owner
      || assignment.attempt !== preemption.assignmentAttempt
      || assignment.fence !== preemption.assignmentFence
      || assignment.envelopeDigest !== preemption.assignmentEnvelopeDigest) {
      throw new WorkroomCheckpointDeliveryUnavailableError(preemption, 'assignment_stale');
    }
    if (preemption.deadline <= state.now) {
      throw new WorkroomCheckpointDeliveryUnavailableError(preemption, 'deadline_expired');
    }
    if (assignment.leaseExpiresAt <= state.now) {
      throw new WorkroomCheckpointDeliveryUnavailableError(preemption, 'lease_expired');
    }
    const [local, remote] = await Promise.all([
      this.options.kernel.listLocalAssignmentIssuances(),
      this.options.kernel.listRemoteAssignmentIssuances(),
    ]);
    const localIssuance = local.find(item => item.envelope.assignmentId === assignment.id);
    const remoteIssuance = remote.find(item => item.envelope.assignmentId === assignment.id);
    if ((!localIssuance && !remoteIssuance) || (localIssuance && remoteIssuance)) {
      throw new WorkroomCheckpointDeliveryUnavailableError(preemption, 'issuance_unavailable');
    }
    const issuance = localIssuance ?? remoteIssuance!;
    if (issuance.envelope.digest !== assignment.envelopeDigest
      || issuance.envelope.principalId !== assignment.owner
      || issuance.envelope.attempt !== assignment.attempt
      || issuance.envelope.fence !== assignment.fence) {
      throw new WorkroomCheckpointDeliveryUnavailableError(preemption, 'issuance_unavailable');
    }
    const provider = this.options.resolveProvider();
    if (!provider) {
      throw new WorkroomCheckpointDeliveryUnavailableError(preemption, 'provider_unavailable');
    }
    await provider.request(Object.freeze({
      version: 1,
      transport: localIssuance ? 'local' : 'remote',
      preemption,
      envelope: issuance.envelope,
      ...(remoteIssuance
        ? { remoteEndpointId: remoteIssuance.dispatchItem.envelope.endpoint.id }
        : {}),
    }), signal);
  }
}

export interface WorkroomPreemptionUnavailableControlPort {
  block(preemption: WorkroomPreemptionState, reason: string): Promise<void>;
  recover(preemption: WorkroomPreemptionState): Promise<void>;
}

export interface WorkroomPreemptionRuntimeOptions {
  readonly journal: Pick<WorkroomJournal, 'listRunIds' | 'read'>;
  readonly delivery: WorkroomAssignmentCheckpointDelivery;
  readonly unavailableControl: WorkroomPreemptionUnavailableControlPort;
  readonly intervalMs?: number;
  readonly onError?: (error: unknown) => void;
}

export interface WorkroomPreemptionDrainResult {
  readonly delivered: number;
  readonly blocked: number;
}

/** At-least-once Journal recovery; transport success is deliberately not an ack. */
export class WorkroomPreemptionRuntime {
  readonly #intervalMs: number;
  readonly #controller = new AbortController();
  #timer?: ReturnType<typeof setTimeout>;
  #running?: Promise<WorkroomPreemptionDrainResult>;
  #stopped = false;

  constructor(readonly options: WorkroomPreemptionRuntimeOptions) {
    this.#intervalMs = positive(options.intervalMs ?? 1_000, 'intervalMs');
  }

  start(): void {
    if (this.#stopped) throw new Error('Workroom Preemption Runtime is stopped');
    if (!this.#timer) this.#schedule(0);
  }

  async drain(): Promise<WorkroomPreemptionDrainResult> {
    if (this.#stopped) throw new Error('Workroom Preemption Runtime is stopped');
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
    if (this.#stopped) return;
    this.#stopped = true;
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = undefined;
    this.#controller.abort(new DOMException('Workroom preemption generation retired', 'AbortError'));
    await this.#running?.catch(error => {
      if (!this.#controller.signal.aborted) throw error;
    });
  }

  async #drain(): Promise<WorkroomPreemptionDrainResult> {
    let delivered = 0;
    let blocked = 0;
    for (const runId of [...await this.options.journal.listRunIds()].sort()) {
      this.#controller.signal.throwIfAborted();
      const pending = replayWorkroomPreemptions(await this.options.journal.read(runId)).pending;
      if (!pending) continue;
      try {
        await this.options.delivery.request(pending, this.#controller.signal);
      } catch (error) {
        if (!(error instanceof WorkroomCheckpointDeliveryUnavailableError)) throw error;
        await this.options.unavailableControl.block(pending, error.reason);
        blocked += 1;
        continue;
      }
      await this.options.unavailableControl.recover(pending);
      delivered += 1;
    }
    return Object.freeze({ delivered, blocked });
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
    throw new Error(`Workroom Preemption Runtime ${label} must be a positive safe integer`);
  }
  return Number(value);
}
