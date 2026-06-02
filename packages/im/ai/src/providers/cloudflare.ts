/**
 * @zhin.js/ai - Cloudflare Workers AI Provider
 * @see https://developers.cloudflare.com/workers-ai/configuration/open-ai-compatibility/
 */

import { OpenAIProvider } from './openai.js';
import type { ProviderConfig } from '../types.js';

export interface CloudflareConfig extends ProviderConfig {
  /** Cloudflare Account ID（必填） */
  accountId: string;
}

/**
 * Cloudflare Workers AI（OpenAI 兼容格式）
 *
 * base_url: `https://api.cloudflare.com/client/v4/accounts/{accountId}/ai/v1`
 *
 * 模型格式形如 `@cf/meta/llama-3.1-8b-instruct`，完整列表见
 * https://developers.cloudflare.com/workers-ai/models/
 */
export class CloudflareProvider extends OpenAIProvider {
  name = 'cloudflare';
  models = [
    '@cf/zai-org/glm-4.7-flash',
    '@cf/meta/llama-4-scout-17b-16e-instruct',
    '@cf/meta/llama-3.1-8b-instruct',
    '@cf/qwen/qwen3-30b-a3b-fp8',
    '@cf/qwen/qwen2.5-coder-32b-instruct',
  ];

  constructor(config: CloudflareConfig) {
    const baseUrl =
      config.baseUrl ||
      `https://api.cloudflare.com/client/v4/accounts/${config.accountId}/ai/v1`;
    super({ ...config, baseUrl });
    if (config.models?.length) this.models = config.models;
  }

  async listModels(): Promise<string[]> {
    return this.models;
  }
}
