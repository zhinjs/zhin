import type { InferenceClient } from '@zhin.js/ai/provider';
import { getAgentTurnConfiguration } from '@zhin.js/agent/turn';

/** Invocation-local access only. A missing operation never falls back to a process client. */
export function currentAgentInference(): InferenceClient {
  const scope = getAgentTurnConfiguration()?.models;
  if (!scope) throw new Error('AI inference is unavailable outside an admitted operation');
  return scope.inference;
}
