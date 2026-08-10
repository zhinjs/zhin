/**
 * Test helper — wire mock AIProvider.chat into ai-sdk ApiRegistry (ADR 0018).
 */
import {
  registerApiProvider,
  registerProviderInstance,
  createOpenAiCompletionsStreamFn,
  setLiveModelsResolver,
  SdkProviderAdapter,
  type ChatCompletionsMockProvider,
} from '@zhin.js/ai';

export function wireMockProviderToLlmApi(provider: ChatCompletionsMockProvider): void {
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

/**
 * 生产路径 `sdkEntryFromProvider` 只接受 SdkProviderAdapter（无静默兜底）；
 * 测试 mock 必须落在真实实例上，chat 以 own property 挂接供断言。
 */
export function createMockSdkProvider(
  chat: ChatCompletionsMockProvider['chat'],
  models: readonly string[] = ['mock-model'],
  name = 'mock',
): SdkProviderAdapter & ChatCompletionsMockProvider {
  const adapter = new SdkProviderAdapter(
    name,
    'openai',
    { sdk: 'openai', apiKey: 'test-key' },
    [...models],
  );
  return Object.assign(adapter, { chat });
}
