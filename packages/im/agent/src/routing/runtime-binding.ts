import type { ResolvedAgentBinding } from '../config/types.js';
import type { ModelExecutionBundle } from '../model-runtime/types.js';
/** Role identity and the independently resolved operation model. */
export interface TurnRuntimeBinding {
  binding: ResolvedAgentBinding;
  execution: ModelExecutionBundle;
}
