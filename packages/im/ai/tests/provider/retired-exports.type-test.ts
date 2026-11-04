/** Published consumers must not discover a second Provider/configuration authority. */
import type { TextCompletionPort } from '@zhin.js/ai';
// @ts-expect-error Provider instances were replaced by operation-bound inference
import type { AIProvider } from '@zhin.js/ai';
// @ts-expect-error startup configuration belongs to the Agent, not the pure AI engine
import type { AIConfig } from '@zhin.js/ai';
// @ts-expect-error connection/account/model definitions use the canonical provider resources
import type { ProviderConfig } from '@zhin.js/ai';
// @ts-expect-error removed connection instance configuration
import type { ProviderInstanceConfig } from '@zhin.js/ai';
// @ts-expect-error deleted alias registry factory must not remain in archive declarations
import { createLlmApiRuntime } from '@zhin.js/ai';
// @ts-expect-error removed SDK instance facade
import { createSdkProviderAdapter } from '@zhin.js/ai';
// @ts-expect-error removed model-name registry
import { ModelRegistry } from '@zhin.js/ai';
// @ts-expect-error removed parallel catalog subpath
import type * as RemovedCatalog from '@zhin.js/ai/model-catalog';
const completion: TextCompletionPort = { completeText: async (_system, _user, options) => {
  options?.signal?.throwIfAborted();
  return 'synthetic';
} };
void completion;

import type { ProviderResilienceConfig, ResilientCompletionOptions } from '@zhin.js/ai';
// @ts-expect-error automatic cross-model fallback was removed
const removedFallback: ProviderResilienceConfig = { fallback: true };
// @ts-expect-error a completion wrapper cannot select another Profile/model
const removedCandidates: ResilientCompletionOptions = { fallbackModels: [] };
void removedFallback; void removedCandidates;
