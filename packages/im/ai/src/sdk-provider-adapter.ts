/**
 * SdkProviderAdapter — AIProvider-shaped runtime handle over AI SDK transport (ADR 0018).
 */

import type {
  AIProvider,
  ChatCompletionChunk,
  ChatCompletionRequest,
  ChatCompletionResponse,
  ProviderConfig,
} from './types.js';
import type { ProviderInstanceConfig } from './llm/types/model.js';
import type { SdkId } from './llm/sdk-registry.js';
import {
  resolveSdkProviderModels,
  SDK_SUPPORTS_OPENAI_MODEL_DISCOVERY,
} from './llm/sdk-default-models.js';
import { createLanguageModel } from './llm/sdk-registry.js';
import { registerLanguageModel } from './llm/language-model-store.js';
import { generateTextViaAiSdk } from './llm/bridge/ai-sdk-stream.js';
import { generateImageViaAiSdk } from './llm/bridge/ai-sdk-image.js';
import { createContext } from './llm/types/context.js';
import { createUserMessage } from './llm/types/agent-message.js';
import { assistantText } from './llm/convert/openai-bridge.js';
import type { ImageGenerateRequest, ImageGenerateResult } from './image-generation.js';
import { getModel } from './llm/api-registry.js';
import { resolveProxyFetch } from './llm/proxy-fetch.js';

async function fetchOpenAiCompatibleModels(config: ProviderInstanceConfig): Promise<string[]> {
  let baseUrl = config.baseUrl?.trim();
  if (!baseUrl && config.host?.trim()) {
    const host = config.host.replace(/\/+$/, '');
    baseUrl = host.endsWith('/v1') ? host : `${host}/v1`;
  }
  if (!baseUrl && config.accountId) {
    baseUrl = `https://api.cloudflare.com/client/v4/accounts/${config.accountId}/ai/v1`;
  }
  if (!baseUrl) return [];

  const headers: Record<string, string> = { ...config.headers };
  if (config.apiKey) {
    headers.Authorization = config.authScheme === ''
      ? config.apiKey
      : `${config.authScheme ?? 'Bearer '}${config.apiKey}`.trim();
  }

  const proxyFetch = resolveProxyFetch();
  const res = await (proxyFetch ?? fetch)(`${baseUrl.replace(/\/+$/, '')}/models`, { headers });
  if (!res.ok) return [];
  const json = await res.json() as { data?: Array<{ id?: string }> };
  return (json.data ?? []).map((m) => m.id).filter((id): id is string => !!id?.trim());
}

export class SdkProviderAdapter implements AIProvider {
  name: string;
  models: string[];
  contextWindow?: number;
  imageGenerationDefaults: ProviderInstanceConfig['imageGeneration'];

  constructor(
    alias: string,
    readonly sdk: SdkId,
    readonly config: ProviderInstanceConfig,
    initialModels: string[] = [],
  ) {
    this.name = alias;
    this.models = initialModels.length > 0
      ? [...initialModels]
      : resolveSdkProviderModels(sdk, config);
    this.contextWindow = config.contextWindow;
    this.imageGenerationDefaults = config.imageGeneration;
  }

  private ensureLanguageModel(modelId: string): void {
    const lm = createLanguageModel(this.sdk, this.config, modelId);
    registerLanguageModel(this.name, modelId, lm);
  }

  async chat(request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    this.ensureLanguageModel(request.model);
    const model = getModel(this.name, request.model);
    const messages = request.messages
      .filter((m) => m.role !== 'system')
      .map((m) => {
        if (m.role === 'user') {
          const content = typeof m.content === 'string'
            ? m.content
            : JSON.stringify(m.content);
          return createUserMessage(content);
        }
        return createUserMessage(JSON.stringify(m));
      });
    const system = request.messages.find((m) => m.role === 'system');
    const systemPrompt = system && typeof system.content === 'string' ? system.content : '';
    const ctx = createContext(systemPrompt, messages);
    const assistant = await generateTextViaAiSdk(
      createLanguageModel(this.sdk, this.config, request.model),
      model,
      ctx,
      { temperature: request.temperature, maxTokens: request.max_tokens },
    );
    const text = assistantText(assistant);
    return {
      id: `chatcmpl-${Date.now()}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: request.model,
      choices: [{
        index: 0,
        message: { role: 'assistant', content: text },
        finish_reason: assistant.stopReason === 'toolCalls' ? 'tool_calls' : 'stop',
      }],
      usage: {
        prompt_tokens: assistant.usage.input,
        completion_tokens: assistant.usage.output,
        total_tokens: assistant.usage.totalTokens,
      },
    };
  }

  async *chatStream(_request: ChatCompletionRequest): AsyncIterable<ChatCompletionChunk> {
    const response = await this.chat(_request);
    const text = response.choices[0]?.message?.content ?? '';
    if (typeof text === 'string' && text) {
      yield {
        id: response.id,
        object: 'chat.completion.chunk',
        created: response.created,
        model: response.model,
        choices: [{ index: 0, delta: { content: text }, finish_reason: null }],
      };
    }
    yield {
      id: response.id,
      object: 'chat.completion.chunk',
      created: response.created,
      model: response.model,
      choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
    };
  }

  async listModels(): Promise<string[]> {
    if (this.models.length > 0 && !SDK_SUPPORTS_OPENAI_MODEL_DISCOVERY.has(this.sdk)) {
      return this.models;
    }
    if (SDK_SUPPORTS_OPENAI_MODEL_DISCOVERY.has(this.sdk)) {
      const discovered = await fetchOpenAiCompatibleModels(this.config);
      if (discovered.length > 0) {
        this.models = discovered;
        return this.models;
      }
    }
    if (this.models.length > 0) return this.models;
    this.models = resolveSdkProviderModels(this.sdk, this.config);
    return this.models;
  }

  async generateImage(request: ImageGenerateRequest): Promise<ImageGenerateResult> {
    return generateImageViaAiSdk(
      this.sdk,
      this.config,
      request,
      this.imageGenerationDefaults,
    );
  }
}

export function createSdkProviderAdapter(
  alias: string,
  config: ProviderInstanceConfig,
): SdkProviderAdapter | null {
  if (config.sdk === 'ollama') {
    // Ollama does not require apiKey
  } else if (config.sdk === 'openai-compatible') {
    if (!config.baseUrl?.trim() && !config.accountId?.trim()) return null;
    if (!config.apiKey?.trim() && !config.accountId?.trim()) return null;
  } else if (!config.apiKey?.trim()) {
    return null;
  }

  const models = resolveSdkProviderModels(config.sdk, config);
  return new SdkProviderAdapter(alias, config.sdk, config, models);
}

export function sdkEntryFromProvider(provider: AIProvider): import('./llm/register-api-layer.js').SdkProviderEntry {
  if (provider instanceof SdkProviderAdapter) {
    return {
      alias: provider.name,
      config: provider.config,
      models: [...provider.models],
    };
  }
  return {
    alias: provider.name,
    config: { sdk: 'openai' },
    models: [...provider.models],
  };
}

/** @deprecated transitional export */
export type { ProviderConfig };
