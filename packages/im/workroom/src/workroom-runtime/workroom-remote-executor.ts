import { createToken } from '@zhin.js/plugin-runtime';
import {
  assertWorkroomRemoteDispatchRetry,
  type WorkroomRemoteDispatchOutboxItem,
} from '../workroom/remote-dispatch.js';
import {
  normalizeWorkroomRemoteDispatchObservation,
  type WorkroomRemoteDispatchObservation,
  type WorkroomRemoteExecutorPort,
} from '../workroom/remote-executor.js';

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
    governedBody?: Uint8Array,
  ): Promise<WorkroomRemoteDispatchObservation> => {
    const current = resolve();
    if (!current) throw new Error('Workroom Remote Executor Port is not installed');
    return normalizeWorkroomRemoteDispatchObservation(
      await (governedBody === undefined
        ? current.dispatch(item, signal)
        : current.dispatch(item, signal, governedBody)),
    );
  };
  return Object.freeze({
    dispatch,
    async retry(persisted, retry, signal) {
      assertWorkroomRemoteDispatchRetry(persisted, retry);
      return await dispatch(retry, signal);
    },
  } satisfies GenerationWorkroomRemoteExecutorPort);
}
