import type { ProviderConfig } from '../types.js';
import type { ProviderInstanceConfig } from './types/model.js';
import {
  registerApiProvider,
  registerProviderInstance,
  clearApiRegistryForTests,
  setLiveModelsResolver,
  getApiProvider,
} from './api-registry.js';
import { createAiSdkStreamFn } from './bridge/ai-sdk-stream.js';
import { createLanguageModel } from './sdk-registry.js';
import { registerLanguageModel, clearLanguageModelStoreForTests } from './language-model-store.js';

export interface SdkProviderEntry {
  alias: string;
  config: ProviderInstanceConfig;
  models: string[];
}

const AI_SDK_API = 'ai-sdk' as const;
let aiSdkRegistered = false;

function ensureAiSdkProviderRegistered(): void {
  if (aiSdkRegistered) return;
  if (getApiProvider(AI_SDK_API)) {
    aiSdkRegistered = true;
    return;
  }
  aiSdkRegistered = true;
  const streamFn = createAiSdkStreamFn();
  registerApiProvider({ api: AI_SDK_API, stream: streamFn, streamSimple: streamFn });
}

function registerLanguageModelsForEntry(entry: SdkProviderEntry): void {
  const modelIds = entry.models.length > 0
    ? entry.models
    : entry.config.models ?? [];
  const ids = modelIds.length > 0 ? modelIds : ['__default__'];
  for (const modelId of ids) {
    if (modelId === '__default__') continue;
    const lm = createLanguageModel(entry.config.sdk, entry.config, modelId);
    registerLanguageModel(entry.alias, modelId, lm);
  }
}

/**
 * Register LLM transport from AI SDK LanguageModel instances (ADR 0018).
 */
export function registerLlmApiFromProviders(
  entries: SdkProviderEntry[],
  resolveModels: (alias: string) => string[],
): void {
  ensureAiSdkProviderRegistered();
  setLiveModelsResolver(resolveModels);

  for (const entry of entries) {
    registerLanguageModelsForEntry(entry);
    registerProviderInstance(entry.alias, entry.config, entry.models);
  }
}

/** Lazy-register a LanguageModel when first requested (dynamic model discovery). */
export function ensureLanguageModelRegistered(
  alias: string,
  modelId: string,
  config: ProviderInstanceConfig,
): void {
  const lm = createLanguageModel(config.sdk, config, modelId);
  registerLanguageModel(alias, modelId, lm);
}

/** @internal test helper */
export function resetLlmApiRegistryForTests(): void {
  aiSdkRegistered = false;
  clearApiRegistryForTests();
  clearLanguageModelStoreForTests();
}
