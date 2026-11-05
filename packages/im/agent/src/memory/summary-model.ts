import type { LlmCompletionPort, Model } from '@zhin.js/ai';
import { getAgentTurnConfiguration } from '../turn/agent-turn-context.js';

export interface SummaryExecution {
  readonly model: Model;
  readonly transport: LlmCompletionPort;
}

/** Capture this operation synchronously; acquire its deployment summary only when called.
 * Unscoped embedders retain their existing model. */
export function createTurnSummaryExecutionResolver(legacy: SummaryExecution): () => Promise<SummaryExecution> {
  const scope = getAgentTurnConfiguration()?.models;
  return async () => {
    if (!scope) return legacy;
    if (!scope.summary) throw new Error('Summary model is not configured in the turn scope');
    const summary = await scope.summary.resolve();
    return Object.freeze({ model: summary.model, transport: summary.completion });
  };
}
