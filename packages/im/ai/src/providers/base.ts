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
   * 构建请求头（公共逻辑）
   */
  private buildHeaders(extra?: HeadersInit): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...this.config.headers,
      ...(extra as Record<string, string>),
    };
    if (this.config.apiKey) {
      const scheme = this.config.authScheme !== undefined ? this.config.authScheme : 'Bearer ';
      headers['Authorization'] = scheme + this.config.apiKey;
    }
    return headers;
  }

  /**
   * 发起请求并返回 Response（公共逻辑）
   */
  protected async request(
    url: string,
    options: RequestInit & { json?: unknown } = {},
    controller?: AbortController,
  ): Promise<Response> {
    const { json, ...fetchOptions } = options;
    const ownController = !controller;
    const ctrl = controller ?? new AbortController();
    const timeoutId = ownController ? setTimeout(() => ctrl.abort(), this.config.timeout) : undefined;

    try {
      const response = await fetch(url, {
        ...fetchOptions,
        headers: this.buildHeaders(options.headers),
        body: json ? JSON.stringify(json) : fetchOptions.body,
        signal: ctrl.signal,
        keepalive: true,
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`API Error (${response.status}): ${error}`);
      }

      return response;
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  }

  /**
   * 发送 HTTP 请求并解析 JSON
   */
  protected async fetch<T>(
    url: string,
    options: RequestInit & { json?: unknown } = {}
  ): Promise<T> {
    const response = await this.request(url, options);
    return response.json() as Promise<T>;
  }

  /**
   * 读取响应正文（用于需自行解析 JSON / SSE 的场景）
   */
  protected async fetchText(
    url: string,
    options: RequestInit & { json?: unknown } = {},
  ): Promise<string> {
    const response = await this.request(url, options);
    return response.text();
  }

  /**
   * 发送流式请求
   */
  protected async *fetchStream(
    url: string,
    options: RequestInit & { json?: unknown } = {}
  ): AsyncIterable<string> {
    const controller = new AbortController();
    const requestId = Math.random().toString(36).slice(2);
    this.abortControllers.set(requestId, controller);

    try {
      const response = await this.request(url, { ...options, headers: { Accept: 'text/event-stream', ...(options.headers as Record<string, string>) } }, controller);

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
    if (!this.listModels) return false;
    try {
      await this.listModels();
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
