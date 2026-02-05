/**
 * @zhin.js/ai - Base Provider
 * AI Provider 抽象基类
 */

import type {
  AIProvider,
  ProviderConfig,
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatCompletionChunk,
} from '../types.js';

/**
 * Provider 基类
 * 提供通用的 HTTP 请求和流式解析能力
 */
export abstract class BaseProvider implements AIProvider {
  abstract name: string;
  abstract models: string[];
  
  protected config: ProviderConfig;
  protected abortControllers: Map<string, AbortController> = new Map();

  constructor(config: ProviderConfig = {}) {
    this.config = {
      timeout: 60000,
      maxRetries: 3,
      ...config,
    };
  }

  abstract chat(request: ChatCompletionRequest): Promise<ChatCompletionResponse>;
  abstract chatStream(request: ChatCompletionRequest): AsyncIterable<ChatCompletionChunk>;

  /**
   * 发送 HTTP 请求
   */
  protected async fetch<T>(
    url: string,
    options: RequestInit & { json?: any } = {}
  ): Promise<T> {
    const { json, ...fetchOptions } = options;
    
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...this.config.headers,
      ...(options.headers as Record<string, string>),
    };

    if (this.config.apiKey) {
      headers['Authorization'] = `Bearer ${this.config.apiKey}`;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);

    try {
      const response = await fetch(url, {
        ...fetchOptions,
        headers,
        body: json ? JSON.stringify(json) : fetchOptions.body,
        signal: controller.signal,
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`API Error (${response.status}): ${error}`);
      }

      return response.json() as Promise<T>;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * 发送流式请求
   */
  protected async *fetchStream(
    url: string,
    options: RequestInit & { json?: any } = {}
  ): AsyncIterable<string> {
    const { json, ...fetchOptions } = options;
    
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
      ...this.config.headers,
      ...(options.headers as Record<string, string>),
    };

    if (this.config.apiKey) {
      headers['Authorization'] = `Bearer ${this.config.apiKey}`;
    }

    const controller = new AbortController();
    const requestId = Math.random().toString(36).slice(2);
    this.abortControllers.set(requestId, controller);

    try {
      const response = await fetch(url, {
        ...fetchOptions,
        headers,
        body: json ? JSON.stringify(json) : fetchOptions.body,
        signal: controller.signal,
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`API Error (${response.status}): ${error}`);
      }

      if (!response.body) {
        throw new Error('Response body is empty');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.startsWith('data: ')) {
            const data = trimmed.slice(6);
            if (data !== '[DONE]') {
              yield data;
            }
          }
        }
      }
    } finally {
      this.abortControllers.delete(requestId);
    }
  }

  /**
   * 取消所有进行中的请求
   */
  cancelAll(): void {
    for (const controller of this.abortControllers.values()) {
      controller.abort();
    }
    this.abortControllers.clear();
  }

  /**
   * 健康检查
   */
  async healthCheck(): Promise<boolean> {
    try {
      await this.listModels?.();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 列出可用模型（子类可覆盖）
   */
  async listModels(): Promise<string[]> {
    return this.models;
  }
}
