import {
  normalizeWorkroomRemoteDispatchObservation,
  type WorkroomRemoteDispatchObservation,
  type WorkroomRemoteExecutorPort,
} from '../plugin-runtime/workroom-remote-executor.js';
import type {
  WorkroomRemoteDispatchOutboxProjection,
  WorkroomRemoteDispatchOutboxRepository,
} from './remote-dispatch-outbox.js';
import type { WorkroomRemoteDispatchOutboxItem } from './remote-dispatch.js';

export interface RunWorkroomRemoteDispatchOnceInput {
  readonly repository: WorkroomRemoteDispatchOutboxRepository;
  readonly executor: WorkroomRemoteExecutorPort;
  readonly dispatchId: string;
  readonly expectedSequence: number;
  readonly now: number;
  readonly ownerId: string;
  readonly leaseId: string;
  readonly leaseFence: number;
  readonly leaseExpiresAt: number;
  readonly observationId: string;
  readonly signal: AbortSignal;
  /** Trusted worker clock used for the transport observation timestamp. */
  readonly clock?: Readonly<{ now(): number }>;
}

/** Runs at most one persisted Remote Dispatch transport attempt. */
export async function runWorkroomRemoteDispatchOnce(
  input: RunWorkroomRemoteDispatchOnceInput,
): Promise<WorkroomRemoteDispatchOutboxProjection> {
  input.signal.throwIfAborted();
  const current = await input.repository.read(input.dispatchId);
  if (!current) {
    throw new Error(`Remote Dispatch Outbox item does not exist: ${input.dispatchId}`);
  }
  if (current.sequence !== input.expectedSequence) {
    throw new Error(
      `Remote Dispatch worker sequence conflict: expected ${input.expectedSequence}, `
      + `actual ${current.sequence}`,
    );
  }
  if (current.status === 'reconcile_required' || current.status === 'delivered') return current;
  const expiredLease = current.status === 'leased'
    && current.lease !== undefined
    && input.now >= current.lease.expiresAt;
  if (current.status === 'leased' && !expiredLease) return current;
  if (current.status !== 'pending' && current.status !== 'retryable' && !expiredLease) {
    throw new Error(`Remote Dispatch worker cannot process ${current.status}`);
  }
  const leaseInput = {
    dispatchId: current.dispatchId,
    expectedSequence: current.sequence,
    now: input.now,
    ownerId: input.ownerId,
    leaseId: input.leaseId,
    leaseFence: input.leaseFence,
    leaseExpiresAt: input.leaseExpiresAt,
  };
  if (current.status === 'pending') await input.repository.claim(leaseInput);
  else await input.repository.recover(leaseInput);
  input.signal.throwIfAborted();
  let observation: WorkroomRemoteDispatchObservation;
  let abortToRethrow: unknown;
  let shouldRethrowAbort = false;
  let dispatchStarted = false;
  try {
    observation = normalizeWorkroomRemoteDispatchObservation(
      await dispatchWithAbort(
        input.executor,
        current.item,
        input.signal,
        () => { dispatchStarted = true; },
      ),
    );
  } catch (error) {
    const aborted = input.signal.aborted || isAbortError(error);
    if (aborted && !dispatchStarted) throw error;
    if (aborted) {
      abortToRethrow = error;
      shouldRethrowAbort = true;
    }
    observation = Object.freeze({
      outcome: 'outcome_unknown',
      receiptId: 'workroom-transport-exception:v1:'
        + `${encodeURIComponent(current.dispatchId)}:${encodeURIComponent(input.observationId)}`,
      reason: `transport_exception:${safeTransportErrorCategory(error)}`,
    });
  }
  await input.repository.recordTransportObservation({
    dispatchId: current.dispatchId,
    expectedSequence: current.sequence + 1,
    now: input.clock?.now() ?? input.now,
    leaseId: input.leaseId,
    leaseFence: input.leaseFence,
    observationId: input.observationId,
    observation,
  });
  const projected = await input.repository.read(current.dispatchId);
  if (!projected) throw new Error('Remote Dispatch Outbox projection disappeared after observation');
  if (shouldRethrowAbort) throw abortToRethrow;
  return projected;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function safeTransportErrorCategory(error: unknown): string {
  if (!(error instanceof Error)) return 'Unknown';
  return [
    'Error',
    'TypeError',
    'RangeError',
    'ReferenceError',
    'SyntaxError',
    'URIError',
    'EvalError',
    'AggregateError',
    'AbortError',
  ].includes(error.name) ? error.name : 'Error';
}

function dispatchWithAbort(
  executor: WorkroomRemoteExecutorPort,
  item: WorkroomRemoteDispatchOutboxItem,
  signal: AbortSignal,
  onDispatchStarted: () => void,
): Promise<WorkroomRemoteDispatchObservation> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (complete: () => void): void => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', onAbort);
      complete();
    };
    const onAbort = (): void => {
      finish(() => reject(
        signal.reason ?? new DOMException('Remote Dispatch cancelled', 'AbortError'),
      ));
    };
    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) {
      onAbort();
      return;
    }
    onDispatchStarted();
    let dispatched: Promise<WorkroomRemoteDispatchObservation>;
    try {
      dispatched = executor.dispatch(item, signal);
    } catch (error) {
      finish(() => reject(error));
      return;
    }
    void dispatched.then(
      observation => finish(() => resolve(observation)),
      error => finish(() => reject(error)),
    );
  });
}
