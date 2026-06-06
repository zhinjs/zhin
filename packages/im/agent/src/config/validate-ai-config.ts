import { DEFAULT_ZHIN_AGENT_NAME } from './types.js';
import type { NormalizedAiRoutingConfig } from './normalize-ai-config.js';

export function validateAiRoutingConfig(cfg: NormalizedAiRoutingConfig): string[] {
  const errors: string[] = [];

  for (const [alias, prov] of Object.entries(cfg.providers)) {
    if (!prov.api?.trim()) {
      errors.push(`ai.providers.${alias}: api is required`);
    }
  }

  if (!cfg.agents[DEFAULT_ZHIN_AGENT_NAME]) {
    errors.push(`ai.agents.${DEFAULT_ZHIN_AGENT_NAME} is required`);
  }

  for (const [name, binding] of Object.entries(cfg.agents)) {
    if (!cfg.providers[binding.provider]) {
      errors.push(`ai.agents.${name}: unknown provider "${binding.provider}"`);
    }
    if (!binding.model?.trim() && name !== DEFAULT_ZHIN_AGENT_NAME) {
      errors.push(`ai.agents.${name}: model is required`);
    }
    for (const srv of binding.mcpServers ?? []) {
      if (!srv?.trim()) errors.push(`ai.agents.${name}: empty mcpServers entry`);
    }

    const hasMatch = binding.match != null && Object.keys(binding.match).length > 0;
    const hasPriority = binding.priority != null;

    if (name === DEFAULT_ZHIN_AGENT_NAME) {
      if (hasMatch || hasPriority) {
        errors.push(`ai.agents.${DEFAULT_ZHIN_AGENT_NAME}: must not set priority or match (use implicit fallback)`);
      }
      continue;
    }

    if (hasMatch && typeof binding.priority !== 'number') {
      errors.push(`ai.agents.${name}: priority is required when match is set`);
    }
    if (hasPriority && !hasMatch) {
      errors.push(`ai.agents.${name}: match is required when priority is set`);
    }
  }

  return errors;
}
