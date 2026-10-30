import { createRootPrivateToken } from '@zhin.js/plugin-runtime';
import type { TurnRequest } from '../turn/turn-ingress.js';
import type { ResolvedAgentBinding } from '../config/types.js';
import type { ModelExecutionScope } from './types.js';

/** Host resolves authenticated ownership and leases one immutable invocation scope. */
export interface TurnModelPort {
  createPerception?(scope: ModelExecutionScope, request: TurnRequest): import('../media/perception.js').MediaPerceptionPort | undefined;
  acquire(request: TurnRequest, binding: ResolvedAgentBinding): Promise<ModelExecutionScope>;
}

export const turnModelPortToken = createRootPrivateToken<TurnModelPort>(
  'zhin.agent.turn-models',
  'Generation-owned model selection and invocation leases',
);
