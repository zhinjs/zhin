/**
 * @zhin.js/ai - DeepSeek Provider
 * @see https://api-docs.deepseek.com/zh-cn/
 */

import { OpenAIProvider } from './openai.js';
import type { ProviderConfig, ChatCompletionRequest } from '../types.js';

/** DeepSeek 专用配置 */
export interface DeepSeekConfig extends ProviderConfig {
  /**
   * 思考模式下的推理强度（对应 API `reasoning_effort`）。
   * @see https://api-docs.deepseek.com/zh-cn/
   */
  reasoningEffort?: 'low' | 'medium' | 'high';
  /**
   * Tool Calls strict 模式需使用 Beta 端点。
   * 为 true 且未自定义 baseUrl 时，使用 `https://api.deepseek.com/beta`。
   * @see https://api-docs.deepseek.com/zh-cn/guides/tool_calls
   */
  strictTools?: boolean;
}

/** 官方模型 ID（含将于 2026-07-24 弃用的别名） */
export const DEEPSEEK_MODELS = [
  'deepseek-v4-flash',
  'deepseek-v4-pro',
  'deepseek-chat',
  'deepseek-reasoner',
  'deepseek-coder',
] as const;

const THINKING_MODEL_HINTS = ['reasoner', 'v4-pro'] as const;

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '');
}

function resolveBaseUrl(config: DeepSeekConfig): string {
  if (config.baseUrl) return normalizeBaseUrl(config.baseUrl);
  if (config.strictTools) return 'https://api.deepseek.com/beta';
  return 'https://api.deepseek.com';
}

/**
 * DeepSeek API（OpenAI 兼容格式）
 *
 * - `base_url`: https://api.deepseek.com
 * - V4：`deepseek-v4-flash` / `deepseek-v4-pro`
 * - 兼容别名：`deepseek-chat`（V4-Flash 非思考）、`deepseek-reasoner`（V4-Flash 思考）
 */
export class DeepSeekProvider extends OpenAIProvider {
  name = 'deepseek';
  models: string[] = [...DEEPSEEK_MODELS];
  capabilities = { vision: false, streaming: true, toolCalling: true, thinking: true };

  private reasoningEffort: DeepSeekConfig['reasoningEffort'];

  constructor(config: DeepSeekConfig = {}) {
    super({
      ...config,
      baseUrl: resolveBaseUrl(config),
      contextWindow: config.contextWindow ?? 128000,
    });
    this.reasoningEffort = config.reasoningEffort ?? 'medium';
    if (config.models?.length) this.models = config.models;
    if (config.defaultModel && !this.models.includes(config.defaultModel)) {
      this.models = [config.defaultModel, ...this.models];
    }
  }

  /** @see https://api-docs.deepseek.com/zh-cn/api/list-models */
  async listModels(): Promise<string[]> {
    interface ModelList {
      data: { id: string }[];
    }
    try {
      const response = await this.fetch<ModelList>(`${this.baseUrl}/models`);
      const ids = response.data?.map(m => m.id).filter(Boolean) ?? [];
      if (ids.length) {
        this.models = ids;
        return ids;
      }
    } catch {
      /* 网络/API 不可用时回退构造时的静态列表 */
    }
    return this.models;
  }

  protected buildRequestBody(request: ChatCompletionRequest): Record<string, unknown> {
    const body = super.buildRequestBody(request);
    DeepSeekProvider.applyThinkingParams(body, request, this.reasoningEffort);
    return body;
  }

  /** 是否应开启 DeepSeek 思考模式（`thinking.type = enabled`） */
  static shouldEnableThinking(request: ChatCompletionRequest): boolean {
    if (request.think === false) return false;
    if (request.think === true) return true;
    const model = request.model.toLowerCase();
    return THINKING_MODEL_HINTS.some(hint => model.includes(hint));
  }

  private static applyThinkingParams(
    body: Record<string, unknown>,
    request: ChatCompletionRequest,
    reasoningEffort: DeepSeekConfig['reasoningEffort'],
  ): void {
    if (!DeepSeekProvider.shouldEnableThinking(request)) return;
    body.thinking = { type: 'enabled' };
    if (reasoningEffort) body.reasoning_effort = reasoningEffort;
  }
}
