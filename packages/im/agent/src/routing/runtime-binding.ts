import type { AIProvider } from '@zhin.js/ai';
import type { ResolvedAgentBinding } from '../config/types.js';
import type { ZhinAgentConfig } from '../config/index.js';

export interface TurnRuntimeBinding {
  binding: ResolvedAgentBinding;
  provider: AIProvider;
  model: string;
}

export function bindingToModelConfig(binding: ResolvedAgentBinding): Pick<ZhinAgentConfig, 'chatModel'> {
  return {
    chatModel: binding.model,
  };
}
