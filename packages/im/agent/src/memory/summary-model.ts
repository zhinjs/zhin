import type { LlmCompletionPort, Model } from '@zhin.js/ai';
import { getAgentTurnConfiguration } from '../turn/agent-turn-context.js';

export interface SummaryExecution {
  readonly model: Model;
  readonly transport: LlmCompletionPort;
}

/** Summary uses only its deployment-owned lease; unscoped embedders retain their existing model. */
export function resolveTurnSummaryExecution(legacy: SummaryExecution): SummaryExecution {
  const scope = getAgentTurnConfiguration()?.models;
  if (!scope) return legacy;
  const summary = scope.summary;
  if (!summary) throw new Error('Summary model is not configured in the turn scope');
  return Object.freeze({
    model: summary.llmRuntime.model(summary.provider.name, summary.invocation.model.model),
    transport: summary.llmRuntime,
  });
}
