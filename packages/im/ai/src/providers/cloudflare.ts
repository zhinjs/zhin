/**
 * @zhin.js/ai - Cloudflare Workers AI Provider
 * @see https://developers.cloudflare.com/workers-ai/configuration/open-ai-compatibility/
 */

import { OpenAIProvider } from './openai.js';
import type { ProviderConfig } from '../types.js';
import {
  CLOUDFLARE_DEFAULT_IMAGE_MODEL,
  type ImageGenerationDefaults,
  type ImageGenerateRequest,
  type ImageGenerateResult,
} from '../image-generation.js';

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
  readonly accountId: string;
  models = [
    '@cf/zai-org/glm-4.7-flash',
    '@cf/meta/llama-4-scout-17b-16e-instruct',
    '@cf/meta/llama-3.1-8b-instruct',
    '@cf/qwen/qwen3-30b-a3b-fp8',
    '@cf/qwen/qwen2.5-coder-32b-instruct',
  ];

  constructor(config: CloudflareConfig) {
    const accountId = config.accountId;
    const baseUrl =
      config.baseUrl ||
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/v1`;
    super({ ...config, baseUrl });
    this.accountId = accountId;
    if (config.models?.length) this.models = config.models;
  }

  async listModels(): Promise<string[]> {
    return this.models;
  }

  /** Workers AI 文生图（/ai/run/{model}，非 OpenAI chat 路径） */
  async generateImage(request: ImageGenerateRequest): Promise<ImageGenerateResult> {
    const model = request.model
      ?? this.imageGenerationDefaults.defaultModel
      ?? CLOUDFLARE_DEFAULT_IMAGE_MODEL;
    const numSteps = request.numSteps
      ?? this.imageGenerationDefaults.numSteps
      ?? 4;
    const runUrl =
      `https://api.cloudflare.com/client/v4/accounts/${this.accountId}/ai/run/${model}`;

    const res = await this.fetch<{
      success?: boolean;
      result?: { image?: string };
      errors?: Array<{ message?: string }>;
    }>(runUrl, {
      method: 'POST',
      json: { prompt: request.prompt, num_steps: numSteps },
    });

    const b64 = res.result?.image;
    if (!b64 || typeof b64 !== 'string') {
      const errMsg = res.errors?.[0]?.message ?? 'no image in result';
      throw new Error(`Cloudflare image generation failed: ${errMsg}`);
    }

    return {
      mimeType: 'image/png',
      base64: b64,
      model,
    };
  }
}
