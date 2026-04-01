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
    if (config.models?.length) this.models = config.models;

    if (config.organization) {
      this.config.headers = {
        ...this.config.headers,
        'OpenAI-Organization': config.organization,
      };
    }
  }

  async chat(request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    const body = OpenAIProvider.sanitizeRequest(request);
    try {
      return await this.fetch<ChatCompletionResponse>(
        `${this.baseUrl}/chat/completions`,
        { method: 'POST', json: { ...body, stream: false } },
      );
    } catch (err) {
      const stripped = OpenAIProvider.stripUnsupportedParam(err, body);
      if (!stripped) throw err;
      return this.fetch<ChatCompletionResponse>(
        `${this.baseUrl}/chat/completions`,
        { method: 'POST', json: { ...stripped, stream: false } },
      );
    }
  }

  async *chatStream(request: ChatCompletionRequest): AsyncIterable<ChatCompletionChunk> {
    const body = OpenAIProvider.sanitizeRequest(request);
    let finalBody = body;
    // Pre-flight: for streaming we can't easily retry, so do a quick non-stream
    // probe if needed. Instead, just send and if it fails, retry without the param.
    try {
      const stream = this.fetchStream(
        `${this.baseUrl}/chat/completions`,
        {
          method: 'POST',
          json: { ...finalBody, stream: true, stream_options: { include_usage: true } },
        },
      );
      for await (const data of stream) {
        try {
          yield JSON.parse(data) as ChatCompletionChunk;
        } catch { /* ignore parse errors */ }
      }
      return;
    } catch (err) {
      const stripped = OpenAIProvider.stripUnsupportedParam(err, finalBody);
      if (!stripped) throw err;
      finalBody = stripped;
    }
    // Retry stream without the unsupported param
    const stream = this.fetchStream(
      `${this.baseUrl}/chat/completions`,
      {
        method: 'POST',
        json: { ...finalBody, stream: true, stream_options: { include_usage: true } },
      },
    );
    for await (const data of stream) {
      try {
        yield JSON.parse(data) as ChatCompletionChunk;
      } catch { /* ignore parse errors */ }
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

  /**
   * Normalize message roles to standard OpenAI-compatible values.
   * Converts internal roles (tool_call → assistant, tool_result → tool)
   * so that strict APIs like GLM don't reject the request.
   */
  private static normalizeMessages(messages: ChatCompletionRequest['messages']) {
    return messages.map(msg => {
      if (msg.role === 'tool_call') return { ...msg, role: 'assistant' as const };
      if (msg.role === 'tool_result') return { ...msg, role: 'tool' as const };
      return msg;
    });
  }

  /**
   * Build a clean request body with only standard OpenAI-compatible parameters.
   * Drops non-standard fields (think, etc.) and optional fields that are undefined,
   * so strict APIs won't reject unknown parameters.
   */
  private static sanitizeRequest(request: ChatCompletionRequest) {
    const clean: Record<string, unknown> = {
      model: request.model,
      messages: OpenAIProvider.normalizeMessages(request.messages),
    };
    if (request.tools) clean.tools = request.tools;
    if (request.tool_choice) clean.tool_choice = request.tool_choice;
    if (request.temperature !== undefined) clean.temperature = request.temperature;
    if (request.top_p !== undefined) clean.top_p = request.top_p;
    if (request.max_tokens !== undefined) clean.max_tokens = request.max_tokens;
    if (request.stop !== undefined) clean.stop = request.stop;
    if (request.presence_penalty !== undefined) clean.presence_penalty = request.presence_penalty;
    if (request.frequency_penalty !== undefined) clean.frequency_penalty = request.frequency_penalty;
    if (request.user) clean.user = request.user;
    return clean;
  }

  /**
   * If a 400 error mentions "Unsupported parameter: '<name>'", remove that
   * parameter from the request body and return the cleaned body for retry.
   * Returns null if the error is not about an unsupported parameter.
   */
  private static stripUnsupportedParam(
    err: unknown,
    body: Record<string, unknown>,
  ): Record<string, unknown> | null {
    const msg = err instanceof Error ? err.message : String(err);
    const match = msg.match(/Unsupported parameter[:\s]*'(\w+)'/i);
    if (!match) return null;
    const param = match[1];
    if (!(param in body)) return null;
    const { [param]: _, ...rest } = body;
    return rest;
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
    if (config.models?.length) this.models = config.models;
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
    if (config.models?.length) this.models = config.models;
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
    if (config.models?.length) this.models = config.models;
  }

  async listModels(): Promise<string[]> {
    return this.models;
  }
}
