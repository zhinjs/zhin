import { isSdkId } from '@zhin.js/ai';
import { DEFAULT_ZHIN_AGENT_NAME } from './types.js';
import type { NormalizedAiRoutingConfig } from './normalize-ai-config.js';

export function validateAiRoutingConfig(cfg: NormalizedAiRoutingConfig): string[] {
  const errors: string[] = [];

  for (const [alias, prov] of Object.entries(cfg.providers)) {
    if (!prov.sdk?.trim()) {
      errors.push(`ai.providers.${alias}: sdk is required`);
    } else if (!isSdkId(prov.sdk.trim())) {
      errors.push(
        `ai.providers.${alias}: invalid sdk "${prov.sdk}" (openai | anthropic | google | deepseek | ollama | openai-compatible)`,
      );
    }
    if (prov.sdk === 'openai-compatible' && !prov.baseUrl?.trim() && !prov.accountId?.trim()) {
      errors.push(`ai.providers.${alias}: openai-compatible requires baseUrl or accountId`);
    }
    if (prov.sdk === 'ollama' && !prov.host?.trim() && !prov.baseUrl?.trim()) {
      errors.push(`ai.providers.${alias}: ollama requires host or baseUrl`);
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
