/**
 * Test helper — wire mock AIProvider.chat into ai-sdk ApiRegistry (ADR 0018).
 */
import type { AIProvider } from '@zhin.js/ai';
import {
  registerApiProvider,
  registerProviderInstance,
  createOpenAiCompletionsStreamFn,
  setLiveModelsResolver,
} from '@zhin.js/ai';

export function wireMockProviderToLlmApi(provider: AIProvider): void {
  registerProviderInstance(
    provider.name,
    { sdk: 'openai', apiKey: 'test-key' },
    [...provider.models],
  );
  setLiveModelsResolver((alias) => (
    alias === provider.name ? [...provider.models] : []
  ));
  const streamFn = createOpenAiCompletionsStreamFn(() => (
    (alias: string) => (alias === provider.name ? provider : undefined)
  ));
  registerApiProvider({ api: 'ai-sdk', stream: streamFn, streamSimple: streamFn });
}
