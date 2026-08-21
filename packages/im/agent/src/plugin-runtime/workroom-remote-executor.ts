import { createToken } from '@zhin.js/plugin-runtime';
import {
  assertWorkroomRemoteDispatchRetry,
  type WorkroomRemoteDispatchOutboxItem,
} from '../workroom/remote-dispatch.js';

/** Transport observation only; it cannot mutate or declare terminal Workroom state. */
export interface WorkroomRemoteDispatchObservation {
  readonly outcome: 'delivered' | 'outcome_unknown' | 'failed';
  readonly receiptId: string;
  readonly remoteTaskId?: string;
  readonly remoteContextId?: string;
  readonly reason?: string;
}

export interface WorkroomRemoteExecutorPort {
  dispatch(
    item: WorkroomRemoteDispatchOutboxItem,
    signal: AbortSignal,
  ): Promise<WorkroomRemoteDispatchObservation>;
}

export interface GenerationWorkroomRemoteExecutorPort extends WorkroomRemoteExecutorPort {
  retry(
    persisted: WorkroomRemoteDispatchOutboxItem,
    retry: WorkroomRemoteDispatchOutboxItem,
    signal: AbortSignal,
  ): Promise<WorkroomRemoteDispatchObservation>;
}

export const workroomRemoteExecutorToken = createToken<WorkroomRemoteExecutorPort>(
  'zhin.agent.workroom-remote-executor',
  'Generation-owned outbound Workroom A2A Assignment transport',
);

/** Resolve on every call so an HMR generation never captures a retired transport. */
export function createGenerationWorkroomRemoteExecutorPort(
  resolve: () => WorkroomRemoteExecutorPort | undefined,
): GenerationWorkroomRemoteExecutorPort {
  const dispatch = async (
    item: WorkroomRemoteDispatchOutboxItem,
    signal: AbortSignal,
  ): Promise<WorkroomRemoteDispatchObservation> => {
    const current = resolve();
    if (!current) throw new Error('Workroom Remote Executor Port is not installed');
    return normalizeWorkroomRemoteDispatchObservation(await current.dispatch(item, signal));
  };
  return Object.freeze({
    dispatch,
    async retry(persisted, retry, signal) {
      assertWorkroomRemoteDispatchRetry(persisted, retry);
      return await dispatch(retry, signal);
    },
  } satisfies GenerationWorkroomRemoteExecutorPort);
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
