/**
 * @zhin.js/ai - OpenAI Provider
 * 支持 OpenAI API 及兼容接口（DeepSeek、Moonshot 等）
 */

import { BaseProvider } from './base.js';
import type {
  ProviderConfig,
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatCompletionChunk,
} from '../types.js';

export interface OpenAIConfig extends ProviderConfig {
  organization?: string;
}

export class OpenAIProvider extends BaseProvider {
  name = 'openai';
  models = [
    'gpt-4o',
    'gpt-4o-mini',
    'gpt-4-turbo',
    'gpt-4',
    'gpt-3.5-turbo',
    'o1',
    'o1-mini',
    'o1-preview',
    'o3-mini',
  ];
  contextWindow: number;
  capabilities = { vision: true, streaming: true, toolCalling: true, thinking: false };

  private baseUrl: string;

  constructor(config: OpenAIConfig = {}) {
    super(config);
    this.contextWindow = config.contextWindow ?? 128000;
    this.baseUrl = config.baseUrl || 'https://api.openai.com/v1';
    
    if (config.organization) {
      this.config.headers = {
        ...this.config.headers,
        'OpenAI-Organization': config.organization,
      };
    }
  }

  async chat(request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    return this.fetch<ChatCompletionResponse>(
      `${this.baseUrl}/chat/completions`,
      {
        method: 'POST',
        json: {
          ...request,
          stream: false,
        },
      }
    );
  }

  async *chatStream(request: ChatCompletionRequest): AsyncIterable<ChatCompletionChunk> {
    const stream = this.fetchStream(
      `${this.baseUrl}/chat/completions`,
      {
        method: 'POST',
        json: {
          ...request,
          stream: true,
          stream_options: { include_usage: true },
        },
      }
    );

    for await (const data of stream) {
      try {
        const chunk = JSON.parse(data) as ChatCompletionChunk;
        yield chunk;
      } catch {
        // 忽略解析错误的行
      }
    }
  }

  async listModels(): Promise<string[]> {
    interface ModelList {
      data: { id: string }[];
    }
    
    try {
      const response = await this.fetch<ModelList>(`${this.baseUrl}/models`);
      return response.data
        .map((m) => m.id)
        .filter((id) => id.includes('gpt') || id.includes('o1') || id.includes('o3'));
    } catch {
      return this.models;
    }
  }
}

/**
 * DeepSeek Provider（基于 OpenAI 兼容接口）
 */
export class DeepSeekProvider extends OpenAIProvider {
  name = 'deepseek';
  models = [
    'deepseek-chat',
    'deepseek-coder',
    'deepseek-reasoner',
  ];

  constructor(config: ProviderConfig = {}) {
    super({
      ...config,
      baseUrl: config.baseUrl || 'https://api.deepseek.com/v1',
    });
  }

  async listModels(): Promise<string[]> {
    return this.models;
  }
}

/**
 * Moonshot Provider（基于 OpenAI 兼容接口）
 */
export class MoonshotProvider extends OpenAIProvider {
  name = 'moonshot';
  models = [
    'moonshot-v1-8k',
    'moonshot-v1-32k',
    'moonshot-v1-128k',
  ];

  constructor(config: ProviderConfig = {}) {
    super({
      ...config,
      baseUrl: config.baseUrl || 'https://api.moonshot.cn/v1',
    });
  }

  async listModels(): Promise<string[]> {
    return this.models;
  }
}

/**
 * 智谱 AI Provider（基于 OpenAI 兼容接口）
 */
export class ZhipuProvider extends OpenAIProvider {
  name = 'zhipu';
  models = [
    'glm-4-plus',
    'glm-4',
    'glm-4-air',
    'glm-4-flash',
    'glm-4v-plus',
  ];

  constructor(config: ProviderConfig = {}) {
    super({
      ...config,
      baseUrl: config.baseUrl || 'https://open.bigmodel.cn/api/paas/v4',
    });
  }

  async listModels(): Promise<string[]> {
    return this.models;
  }
}
