import type { WorkroomRemoteDispatchOutboxItem } from './remote-dispatch.js';

/** Transport observation only; it cannot mutate or declare terminal Workroom state. */
export interface WorkroomRemoteDispatchObservation {
  readonly outcome: 'delivered' | 'outcome_unknown' | 'failed';
  readonly receiptId: string;
  readonly remoteTaskId?: string;
  readonly remoteContextId?: string;
  readonly reason?: string;
}

/** Transport port owned by the Workroom domain and implemented by Host adapters. */
export interface WorkroomRemoteExecutorPort {
  dispatch(
    item: WorkroomRemoteDispatchOutboxItem,
    signal: AbortSignal,
    governedBody?: Uint8Array,
  ): Promise<WorkroomRemoteDispatchObservation>;
}

export function normalizeWorkroomRemoteDispatchObservation(
  value: WorkroomRemoteDispatchObservation,
): WorkroomRemoteDispatchObservation {
  if (!['delivered', 'outcome_unknown', 'failed'].includes(value?.outcome)
    || typeof value?.receiptId !== 'string'
    || !value.receiptId.trim()
    || !isOptionalNonEmptyString(value.remoteTaskId)
    || !isOptionalNonEmptyString(value.remoteContextId)
    || !isOptionalNonEmptyString(value.reason)) {
    throw new Error('Workroom Remote Executor returned an invalid transport observation');
  }
  return Object.freeze({
    outcome: value.outcome,
    receiptId: value.receiptId,
    ...(value.remoteTaskId === undefined ? {} : { remoteTaskId: value.remoteTaskId }),
    ...(value.remoteContextId === undefined ? {} : { remoteContextId: value.remoteContextId }),
    ...(value.reason === undefined ? {} : { reason: value.reason }),
  });
}

function isOptionalNonEmptyString(value: unknown): value is string | undefined {
  return value === undefined || (typeof value === 'string' && value.trim().length > 0);
}
