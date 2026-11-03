import { createRootPrivateToken } from '@zhin.js/plugin-runtime';
import type { TurnRequest } from '../turn/turn-ingress.js';
import type { ModelExecutionScope, ModelTurnAcquireInput } from './types.js';

/** Actual authenticated operation lease and identity determine model access. */
export interface TurnModelPort {
  createPerception?(scope: ModelExecutionScope, request: TurnRequest): import('../media/perception.js').MediaPerceptionPort | undefined;
  acquire(input: ModelTurnAcquireInput): Promise<ModelExecutionScope>;
}
export const turnModelPortToken = createRootPrivateToken<TurnModelPort>(
  'zhin.agent.turn-models',
  'Operation-bound inference selection and resource ownership',
);
