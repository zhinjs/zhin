import type { ModelRegistry } from '@zhin.js/ai';

export interface ModelResolverConfig {
  chatModel?: string;
  visionModel?: string;
}

export function resolveModel(
  providerModels: string[],
  modelRegistry: ModelRegistry | null,
  providerName: string,
  config: ModelResolverConfig,
  task: 'chat' | 'vision' | 'tool_call' | 'summary' = 'chat',
  preferred?: string,
): string {
  return resolveModelCandidates(providerModels, modelRegistry, providerName, config, task, preferred)[0];
}

export function resolveModelCandidates(
  providerModels: string[],
  modelRegistry: ModelRegistry | null,
  providerName: string,
  config: ModelResolverConfig,
  task: 'chat' | 'vision' | 'tool_call' | 'summary' = 'chat',
  preferred?: string,
): string[] {
  const candidates: string[] = [];

  if (preferred) candidates.push(preferred);
  if (task === 'chat' && config.chatModel && !candidates.includes(config.chatModel)) {
    candidates.push(config.chatModel);
  }
  if (task === 'vision' && config.visionModel && !candidates.includes(config.visionModel)) {
    candidates.push(config.visionModel);
  }

  if (modelRegistry) {
    for (const id of modelRegistry.selectModels(providerName, task, 5)) {
      if (providerModels.length > 0 && !providerModels.includes(id)) continue;
      if (!candidates.includes(id)) candidates.push(id);
    }
  }

  for (const id of providerModels) {
    if (!candidates.includes(id)) candidates.push(id);
  }

  return candidates;
}
