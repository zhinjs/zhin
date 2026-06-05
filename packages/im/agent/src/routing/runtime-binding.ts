import type { AIProvider } from '@zhin.js/core';
import type { ResolvedAgentBinding } from '../config/types.js';
import type { ZhinAgentConfig } from '../zhin-agent/config.js';

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
