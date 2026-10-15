import type {
  RemoteAssignmentDispatchWorkerInput,
} from './remote-dispatch-admission.js';
import type {
  WorkroomRemoteDispatchOutboxProjection,
  WorkroomRemoteDispatchOutboxRepository,
} from './remote-dispatch-outbox.js';

export interface RemoteAssignmentDispatchSchedulerPort {
  runOnce(
    input: RemoteAssignmentDispatchWorkerInput,
  ): Promise<WorkroomRemoteDispatchOutboxProjection>;
}

export interface RemoteAssignmentDispatchSchedulerOptions {
  readonly outbox: WorkroomRemoteDispatchOutboxRepository;
  readonly dispatch: RemoteAssignmentDispatchSchedulerPort;
  readonly ownerId: string;
  readonly clock?: Readonly<{ now(): number }>;
  readonly leaseMs?: number;
  readonly pollIntervalMs?: number;
  readonly onDispatchError?: (
    item: WorkroomRemoteDispatchOutboxProjection,
    error: unknown,
  ) => void;
}

export interface RemoteDispatchOperatorCancelReceipt {
  readonly dispatchId: string;
  readonly localDispatchAborted: boolean;
  /** A local AbortSignal is never evidence that an already-sent A2A request stopped. */
  readonly remoteStopConfirmed: false;
  readonly nextAction: 'reconcile_or_replan';
}

/**
 * Generation-owned durable Outbox pump. Discovery comes from the repository,
 * so restart does not depend on an in-memory queue or on receiving a new admit.
 */
export class RemoteAssignmentDispatchScheduler {
  readonly #outbox: WorkroomRemoteDispatchOutboxRepository;
  readonly #dispatch: RemoteAssignmentDispatchSchedulerPort;
  readonly #ownerId: string;
  readonly #clock: Readonly<{ now(): number }>;
  readonly #leaseMs: number;
  readonly #pollIntervalMs: number;
  readonly #onDispatchError: NonNullable<RemoteAssignmentDispatchSchedulerOptions['onDispatchError']>;
  readonly #active = new Map<string, AbortController>();
  #timer: ReturnType<typeof setTimeout> | undefined;
  #draining: Promise<void> | undefined;
  #stopped = false;

  constructor(options: RemoteAssignmentDispatchSchedulerOptions) {
    this.#outbox = options.outbox;
    this.#dispatch = options.dispatch;
    this.#ownerId = text(options.ownerId, 'ownerId');
    this.#clock = options.clock ?? systemClock;
    this.#leaseMs = positiveInteger(options.leaseMs ?? 10_000, 'leaseMs');
    this.#pollIntervalMs = positiveInteger(options.pollIntervalMs ?? 1_000, 'pollIntervalMs');
    this.#onDispatchError = options.onDispatchError ?? (() => {});
  }

  start(): void {
    if (this.#stopped) throw new Error('Remote Assignment Dispatch Scheduler is stopped');
    if (this.#timer || this.#draining) return;
    void this.drain().finally(() => this.#schedule());
  }

  async drain(): Promise<void> {
    if (this.#stopped) return;
    if (this.#draining) return await this.#draining;
    const operation = this.#drainOnce();
    this.#draining = operation;
    try {
      await operation;
    } finally {
      if (this.#draining === operation) this.#draining = undefined;
    }
  }

  requestOperatorCancel(dispatchId: string, reason: string): RemoteDispatchOperatorCancelReceipt {
    const id = text(dispatchId, 'dispatchId');
    const detail = text(reason, 'reason');
    const controller = this.#active.get(id);
    controller?.abort(new DOMException(detail, 'AbortError'));
    return Object.freeze({
      dispatchId: id,
      localDispatchAborted: controller !== undefined,
      remoteStopConfirmed: false,
      nextAction: 'reconcile_or_replan',
    });
  }

  async stop(): Promise<void> {
    if (this.#stopped) return;
    this.#stopped = true;
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = undefined;
    for (const controller of this.#active.values()) {
      controller.abort(new DOMException('Remote dispatch generation retired', 'AbortError'));
    }
    await this.#draining;
  }

  async #drainOnce(): Promise<void> {
    const now = timestamp(this.#clock.now(), 'clock');
    const runnable = await this.#outbox.listRunnable(now);
    for (const item of runnable) {
      if (this.#stopped || this.#active.has(item.dispatchId)) continue;
      const leaseFence = (item.lastLeaseFence ?? 0) + 1;
      const controller = new AbortController();
      this.#active.set(item.dispatchId, controller);
      try {
        await this.#dispatch.runOnce({
          dispatchId: item.dispatchId,
          expectedSequence: item.sequence,
          now,
          ownerId: this.#ownerId,
          leaseId: `remote-dispatch-lease:v1:${encodeURIComponent(this.#ownerId)}:`
            + `${encodeURIComponent(item.dispatchId)}:${leaseFence}`,
          leaseFence,
          leaseExpiresAt: now + this.#leaseMs,
          observationId: `remote-dispatch-observation:v1:`
            + `${encodeURIComponent(item.dispatchId)}:${leaseFence}`,
          signal: controller.signal,
        });
      } catch (error) {
        this.#onDispatchError(item, error);
      } finally {
        this.#active.delete(item.dispatchId);
      }
    }
  }

  #schedule(): void {
    if (this.#stopped || this.#timer) return;
    this.#timer = setTimeout(() => {
      this.#timer = undefined;
      void this.drain().finally(() => this.#schedule());
    }, this.#pollIntervalMs);
    this.#timer.unref?.();
  }
}

const systemClock = Object.freeze({ now: () => Date.now() });

function text(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Remote Assignment Dispatch Scheduler ${field} is required`);
  }
  return value.trim();
}

function positiveInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    throw new Error(`Remote Assignment Dispatch Scheduler ${field} must be a positive integer`);
  }
  return Number(value);
}

function timestamp(value: unknown, field: string): number {
  if (!Number.isFinite(value) || Number(value) < 0) {
    throw new Error(`Remote Assignment Dispatch Scheduler ${field} must be a finite timestamp`);
  }
  return Number(value);
}
