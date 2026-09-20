import type { ProviderInstanceConfig } from './types/model.js';
import { LlmApiRuntime } from './llm-api-runtime.js';
import { createAiSdkStreamFn } from './bridge/ai-sdk-stream.js';

export interface SdkProviderEntry {
  alias: string;
  config: ProviderInstanceConfig;
  models: string[];
  fetch: typeof globalThis.fetch;
}

/** Create one complete, owner-scoped AI SDK transport runtime. */
export function createLlmApiRuntime(
  entries: readonly SdkProviderEntry[],
  resolveModels: (alias: string) => string[],
): LlmApiRuntime {
  const runtime = new LlmApiRuntime(resolveModels);
  const stream = createAiSdkStreamFn(runtime);
  runtime.registerApiProvider({ api: 'ai-sdk', stream, streamSimple: stream });
  for (const entry of entries) {
    runtime.registerProvider(entry.alias, entry.config, entry.models, entry.fetch);
  }
  return runtime;
}
