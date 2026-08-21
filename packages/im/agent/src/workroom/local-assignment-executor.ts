import {
  assertAssignmentExecutionEnvelope,
  validateAssignmentExecutionObservation,
  type AssignmentCheckpointObservation,
  type AssignmentExecutionCompletedObservation,
  type AssignmentExecutionEnvelope,
  type AssignmentExecutionObservation,
  type AssignmentExecutorPort,
  type AssignmentProgressObservation,
} from './assignment-executor.js';
import {
  createWorkroomDeferredCapabilityPlan,
  type DeferredCapabilityPlan,
  type WorkroomCapabilityRealization,
  type WorkroomDeferredCapabilityPlanOptions,
} from '../plugin-runtime/deferred-capability-plan.js';
import type { WorkroomRoleCapabilitySnapshot } from './role-capability-snapshot.js';

export interface LocalModelProgressEvent {
  readonly version: 1;
  readonly type: 'progress';
  readonly eventId: string;
  readonly progress: AssignmentProgressObservation['progress'];
}

export interface LocalModelHeartbeatEvent {
  readonly version: 1;
  readonly type: 'heartbeat';
  readonly eventId: string;
}

export interface LocalModelCheckpointEvent {
  readonly version: 1;
  readonly type: 'checkpoint';
  readonly eventId: string;
  readonly checkpoint: AssignmentCheckpointObservation['checkpoint'];
}

export interface LocalModelExecutionCompletedEvent {
  readonly version: 1;
  readonly type: 'execution_completed';
  readonly eventId: string;
  readonly completion: AssignmentExecutionCompletedObservation['completion'];
}

export type LocalModelExecutionEvent =
  | LocalModelProgressEvent
  | LocalModelHeartbeatEvent
  | LocalModelCheckpointEvent
  | LocalModelExecutionCompletedEvent;

export type LocalAssignmentCapabilityProjection = Omit<
  WorkroomDeferredCapabilityPlanOptions,
  'authority'
> & Readonly<{
  /** Exact pinned Agent Definition selected by trusted Profile/Catalog routing. */
  agentDefinitionId?: string;
  capabilitySnapshot: WorkroomRoleCapabilitySnapshot;
  realization: WorkroomCapabilityRealization;
  release(): void;
}>;

/** Trusted join of the Envelope snapshot and its generation-bound executable projection. */
export interface LocalAssignmentCapabilityProjectionPort {
  resolve(
    envelope: AssignmentExecutionEnvelope,
    signal: AbortSignal,
  ): Promise<LocalAssignmentCapabilityProjection>;
}

export interface LocalModelExecutionRequest {
  readonly envelope: AssignmentExecutionEnvelope;
  readonly agentDefinitionId?: string;
  /** The only Tool/Skill surface the model adapter may expose. */
  readonly capabilityPlan: DeferredCapabilityPlan;
}

/**
 * Narrow local model boundary. Composition roots may adapt model-loop ability
 * to this port, but must not expose Subagent task identity, delivery or status.
 */
export interface LocalModelExecutionPort {
  execute(
    request: LocalModelExecutionRequest,
    signal: AbortSignal,
  ): AsyncIterable<LocalModelExecutionEvent>;
}

/** Local transport adapter for the shared Assignment Executor lifecycle. */
export class LocalAssignmentExecutor implements AssignmentExecutorPort {
  constructor(
    private readonly model: LocalModelExecutionPort,
    private readonly capabilityProjection: LocalAssignmentCapabilityProjectionPort,
  ) {}

  async *execute(
    envelope: AssignmentExecutionEnvelope,
    signal: AbortSignal,
  ): AsyncIterable<AssignmentExecutionObservation> {
    assertAssignmentExecutionEnvelope(envelope);
    signal.throwIfAborted();
    const projection = await awaitAbortable(
      () => this.capabilityProjection.resolve(envelope, signal),
      signal,
      'Local capability projection cancelled',
      late => late.release(),
    );
    let completion: AssignmentExecutionCompletedObservation;
    try {
      signal.throwIfAborted();
      const capabilityPlan = createWorkroomDeferredCapabilityPlan({
        capabilities: projection.capabilities,
        authority: Object.freeze({
          kind: 'workroom_assignment',
          envelope,
          capabilitySnapshot: projection.capabilitySnapshot,
          realization: projection.realization,
        }),
        sessionSnapshot: projection.sessionSnapshot,
        config: projection.config,
        platform: projection.platform,
        persistSnapshot: projection.persistSnapshot,
      });
      const request: LocalModelExecutionRequest = Object.freeze({
        envelope,
        capabilityPlan,
        ...(projection.agentDefinitionId === undefined
          ? {}
          : { agentDefinitionId: projection.agentDefinitionId }),
      });
      completion = yield* executeLocalModel(this.model, request, signal);
    } finally {
      projection.release();
    }
    signal.throwIfAborted();
    yield completion;
  }
}

async function* executeLocalModel(
  model: LocalModelExecutionPort,
  request: LocalModelExecutionRequest,
  signal: AbortSignal,
): AsyncGenerator<AssignmentExecutionObservation, AssignmentExecutionCompletedObservation> {
  let completion: AssignmentExecutionCompletedObservation | undefined;
  const seenEventIds = new Set<string>();
  const iterator = model.execute(request, signal)[Symbol.asyncIterator]();
  let streamEnded = false;
  try {
    while (true) {
      const next = await awaitAbortable(
        () => iterator.next(),
        signal,
        'Local model execution cancelled',
      );
      if (next.done) {
        streamEnded = true;
        break;
      }
      signal.throwIfAborted();
      if (seenEventIds.has(next.value.eventId)) {
        throw new Error(`Local model execution repeated eventId ${next.value.eventId}`);
      }
      seenEventIds.add(next.value.eventId);
      const observation = projectLocalModelEvent(request.envelope, next.value);
      if (completion) {
        throw new Error('Local model execution emitted an event after execution_completed');
      }
      if (observation.type === 'execution_completed') {
        completion = observation;
        continue;
      }
      yield observation;
    }
  } finally {
    if (!streamEnded) stopIteratorWithoutWaiting(iterator);
  }
  if (!completion) throw new Error('Local model execution ended without execution_completed');
  return completion;
}

function projectLocalModelEvent(
  envelope: AssignmentExecutionEnvelope,
  value: LocalModelExecutionEvent,
): AssignmentExecutionObservation {
  const event = requireEventRecord(value);
  if (event.version !== 1) {
    throw new Error('Local model execution event version is unsupported');
  }
  if (typeof event.eventId !== 'string'
    || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(event.eventId)) {
    throw new Error('Local model execution eventId is invalid');
  }
  const observationId = `local/${envelope.assignmentId}/${envelope.attempt}/${envelope.fence}/${event.eventId}`;
  if (event.type === 'heartbeat') {
    assertExactEventKeys(event, ['version', 'type', 'eventId']);
    return validateAssignmentExecutionObservation(envelope, {
      version: 1,
      type: event.type,
      observationId,
      envelopeDigest: envelope.digest,
    });
  }
  if (event.type === 'progress') {
    assertExactEventKeys(event, ['version', 'type', 'eventId', 'progress']);
    return validateAssignmentExecutionObservation(envelope, {
      version: 1,
      type: event.type,
      observationId,
      envelopeDigest: envelope.digest,
      progress: event.progress,
    });
  }
  if (event.type === 'checkpoint') {
    assertExactEventKeys(event, ['version', 'type', 'eventId', 'checkpoint']);
    return validateAssignmentExecutionObservation(envelope, {
      version: 1,
      type: event.type,
      observationId,
      envelopeDigest: envelope.digest,
      checkpoint: event.checkpoint,
    });
  }
  if (event.type !== 'execution_completed') {
    throw new Error('Local model execution emitted an unsupported event type');
  }
  assertExactEventKeys(event, ['version', 'type', 'eventId', 'completion']);
  return validateAssignmentExecutionObservation(envelope, {
    version: 1,
    type: event.type,
    observationId,
    envelopeDigest: envelope.digest,
    completion: event.completion,
  });
}

function requireEventRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Local model execution event must be an object');
  }
  return value as Record<string, unknown>;
}

function assertExactEventKeys(
  event: Record<string, unknown>,
  allowed: readonly string[],
): void {
  const forbidden = Object.keys(event).find((key) => !allowed.includes(key));
  if (forbidden) {
    throw new Error(`Local model execution event contains forbidden field ${forbidden}`);
  }
}

function awaitAbortable<T>(
  operation: () => PromiseLike<T>,
  signal: AbortSignal,
  cancellationMessage: string,
  onLateResolve?: (value: T) => void,
): Promise<T> {
  signal.throwIfAborted();
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = (operation: () => void): void => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', onAbort);
      operation();
    };
    const onAbort = (): void => {
      finish(() => reject(signal.reason ?? new DOMException(
        cancellationMessage,
        'AbortError',
      )));
    };
    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) {
      onAbort();
      return;
    }
    let pending: PromiseLike<T>;
    try {
      pending = operation();
    } catch (error) {
      finish(() => reject(error));
      return;
    }
    Promise.resolve(pending).then(
      (result) => {
        if (settled) {
          try {
            onLateResolve?.(result);
          } catch {
            // The caller already owns the abort outcome; late cleanup is best-effort.
          }
          return;
        }
        finish(() => resolve(result));
      },
      (error: unknown) => finish(() => reject(error)),
    );
  });
}

function stopIteratorWithoutWaiting<T>(iterator: AsyncIterator<T>): void {
  try {
    const pending = iterator.return?.();
    if (pending) void Promise.resolve(pending).catch(() => undefined);
  } catch {
    // Caller cancellation owns the public outcome; cleanup is best-effort.
  }
}
