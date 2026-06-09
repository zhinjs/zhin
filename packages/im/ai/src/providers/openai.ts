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
  ChatMessage,
  ContentPart,
} from '../types.js';
import {
  OPENAI_DEFAULT_IMAGE_MODEL,
  resolveOpenAIImagesGenerationItem,
  ZHIPU_DEFAULT_IMAGE_MODEL,
  type ImageGenerationDefaults,
  type ImageGenerateRequest,
  type ImageGenerateResult,
  type OpenAIImagesGenerationItem,
} from '../image-generation.js';
import { formatCompact, Logger } from '@zhin.js/logger';
import { formatRedactedJson } from '../llm/redact-request-body.js';
import { parseOpenAIChatCompletionBody } from './openai-sse.js';

const llmRequestLogger = new Logger(null, 'LLM');

export interface OpenAIConfig extends ProviderConfig {
  organization?: string;
}

export class OpenAIProvider extends BaseProvider {
  name = 'openai';
  protected readonly imageGenerationDefaults: ImageGenerationDefaults;
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

  protected baseUrl: string;

  constructor(config: OpenAIConfig = {}) {
    super(config);
    this.contextWindow = config.contextWindow ?? 128000;
    this.baseUrl = config.baseUrl || 'https://api.openai.com/v1';
    if (config.models?.length) this.models = config.models;
    this.imageGenerationDefaults = config.imageGeneration ?? {};

    if (config.organization) {
      this.config.headers = {
        ...this.config.headers,
        'OpenAI-Organization': config.organization,
      };
    }
  }

  async chat(request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    const body = this.buildRequestBody(request);
    llmRequestLogger.debug(formatCompact({
      op: 'request_body',
      provider: this.name,
      model: request.model,
      url: `${this.baseUrl}/chat/completions`,
      body: formatRedactedJson(body),
    }));
    const url = `${this.baseUrl}/chat/completions`;
    const post = async (payload: Record<string, unknown>) => {
      const text = await this.fetchText(url, { method: 'POST', json: { ...payload, stream: false } });
      return parseOpenAIChatCompletionBody(text);
    };
    try {
      return await post(body);
    } catch (err) {
      const stripped = OpenAIProvider.stripUnsupportedParam(err, body);
      if (!stripped) throw err;
      return post(stripped);
    }
  }

  async *chatStream(request: ChatCompletionRequest): AsyncIterable<ChatCompletionChunk> {
    const body = this.buildRequestBody(request);
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

  /** OpenAI Images API（gpt-image-2 / gpt-image-1.5 / gpt-image-1 等） */
  async generateImage(request: ImageGenerateRequest): Promise<ImageGenerateResult> {
    const model = request.model
      ?? this.imageGenerationDefaults.defaultModel
      ?? OPENAI_DEFAULT_IMAGE_MODEL;
    const size = request.size ?? this.imageGenerationDefaults.defaultSize;
    const quality = request.quality ?? this.imageGenerationDefaults.quality;
    const body: Record<string, unknown> = {
      model,
      prompt: request.prompt,
    };
    if (size) body.size = size;
    if (quality) body.quality = quality;

    const res = await this.fetch<{ data?: OpenAIImagesGenerationItem[] }>(
      `${this.baseUrl}/images/generations`,
      { method: 'POST', json: body },
    );

    return resolveOpenAIImagesGenerationItem(res.data?.[0], model, 'OpenAI image generation');
  }

  async listModels(): Promise<string[]> {
    interface ModelList {
      data: { id: string }[];
    }
    
    try {
      const response = await this.fetch<ModelList>(`${this.baseUrl}/models`);
      return response.data.map((m) => m.id);
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

  /** 无 vision 能力的 API（如 DeepSeek）仅接受纯文本 content */
  static flattenMultimodalContent(content: string | ContentPart[]): string {
    if (typeof content === 'string') return content;
    return content
      .map((part) => {
        if (part.type === 'text') return part.text;
        if (part.type === 'image_url') return '[图片]';
        if (part.type === 'audio') return '[音频]';
        if (part.type === 'video_url') return '[视频]';
        if (part.type === 'face') return part.face.text ? `[表情: ${part.face.text}]` : '[表情]';
        return '';
      })
      .filter(Boolean)
      .join('\n');
  }

  static stripVisionFromMessages(messages: ChatMessage[]): ChatMessage[] {
    return messages.map((msg) => {
      if (typeof msg.content === 'string') return msg;
      if (!Array.isArray(msg.content)) return msg;
      const hasNonText = msg.content.some((p) => p.type !== 'text');
      if (!hasNonText) {
        return { ...msg, content: OpenAIProvider.flattenMultimodalContent(msg.content) };
      }
      return { ...msg, content: OpenAIProvider.flattenMultimodalContent(msg.content) };
    });
  }

  /**
   * Build a clean request body with only standard OpenAI-compatible parameters.
   * Drops non-standard fields (think, etc.) and optional fields that are undefined,
   * so strict APIs won't reject unknown parameters.
   */
  protected buildRequestBody(request: ChatCompletionRequest): Record<string, unknown> {
    let messages = OpenAIProvider.normalizeMessages(request.messages);
    if (this.capabilities?.vision === false) {
      messages = OpenAIProvider.stripVisionFromMessages(messages);
    }
    const clean: Record<string, unknown> = {
      model: request.model,
      messages,
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
    'glm-4.7',
    'glm-4.7-flash',
    'glm-4-flash',
    'glm-4.5-air',
    'glm-4.1v-thinking',
    'glm-4.6v',
  ];

  constructor(config: ProviderConfig = {}) {
    super({
      ...config,
      baseUrl: config.baseUrl || 'https://open.bigmodel.cn/api/paas/v4',
    });
    if (config.models?.length) this.models = config.models;
  }

  /** 智谱文生图（OpenAI 兼容 /images/generations） */
  async generateImage(request: ImageGenerateRequest): Promise<ImageGenerateResult> {
    const model = request.model
      ?? this.imageGenerationDefaults.defaultModel
      ?? ZHIPU_DEFAULT_IMAGE_MODEL;
    const size = request.size ?? this.imageGenerationDefaults.defaultSize;
    const watermarkEnabled = request.watermarkEnabled
      ?? this.imageGenerationDefaults.watermarkEnabled
      ?? true;
    const body: Record<string, unknown> = {
      model,
      prompt: request.prompt,
      watermark_enabled: watermarkEnabled,
    };
    if (size) body.size = size;

    const res = await this.fetch<{ data?: OpenAIImagesGenerationItem[] }>(
      `${this.baseUrl}/images/generations`,
      { method: 'POST', json: body },
    );

    return resolveOpenAIImagesGenerationItem(res.data?.[0], model, 'Zhipu image generation');
  }
}
