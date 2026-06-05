/**
 * @zhin.js/ai - Google Gemini Provider（Nano Banana 文生图）
 * @see https://ai.google.dev/gemini-api/docs/image-generation
 */

import { BaseProvider } from './base.js';
import type {
  ProviderConfig,
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatCompletionChunk,
} from '../types.js';
import {
  GOOGLE_DEFAULT_IMAGE_MODEL,
  type ImageGenerationDefaults,
  type ImageGenerateRequest,
  type ImageGenerateResult,
} from '../image-generation.js';

export interface GoogleConfig extends ProviderConfig {
  /** 默认 https://generativelanguage.googleapis.com/v1beta */
  baseUrl?: string;
}

interface GeminiInlineBlob {
  mimeType?: string;
  mime_type?: string;
  data?: string;
}

interface GeminiPart {
  text?: string;
  inlineData?: GeminiInlineBlob;
  inline_data?: GeminiInlineBlob;
}

interface GeminiGenerateContentResponse {
  candidates?: Array<{
    content?: { parts?: GeminiPart[] };
  }>;
}

function extractGeminiImagePart(
  res: GeminiGenerateContentResponse,
): { base64: string; mimeType: string } | null {
  for (const candidate of res.candidates ?? []) {
    for (const part of candidate.content?.parts ?? []) {
      const blob = part.inlineData ?? part.inline_data;
      const data = blob?.data;
      if (!data || typeof data !== 'string') continue;
      const mimeType = blob?.mimeType ?? blob?.mime_type ?? 'image/png';
      return { base64: data, mimeType };
    }
  }
  return null;
}

/**
 * Gemini 文生图（Nano Banana 系列）。
 * 聊天未实现：请用本 driver 仅作 `generate_image` 的 provider_alias。
 */
export class GoogleProvider extends BaseProvider {
  name = 'google';
  models = [
    'gemini-2.5-flash-image',
    'gemini-3.1-flash-image',
    'gemini-3.1-flash-image-preview',
    'gemini-3-pro-image-preview',
  ];

  private readonly geminiApiKey?: string;
  private readonly imageGenerationDefaults: ImageGenerationDefaults;
  protected baseUrl: string;

  constructor(config: GoogleConfig = {}) {
    const { apiKey, ...rest } = config;
    super({
      ...rest,
      headers: {
        ...(rest.headers ?? {}),
        ...(apiKey ? { 'x-goog-api-key': apiKey } : {}),
      },
    });
    this.geminiApiKey = apiKey;
    this.imageGenerationDefaults = config.imageGeneration ?? {};
    this.baseUrl = (config.baseUrl ?? 'https://generativelanguage.googleapis.com/v1beta').replace(/\/$/, '');
    if (config.models?.length) this.models = config.models;
  }

  async chat(_request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    throw new Error(
      'GoogleProvider does not support chat; use driver google only as generate_image provider_alias',
    );
  }

  async *chatStream(_request: ChatCompletionRequest): AsyncIterable<ChatCompletionChunk> {
    throw new Error(
      'GoogleProvider does not support chat; use driver google only as generate_image provider_alias',
    );
  }

  async listModels(): Promise<string[]> {
    return this.models;
  }

  async healthCheck(): Promise<boolean> {
    return Boolean(this.geminiApiKey);
  }

  /** Gemini generateContent + IMAGE modality（Nano Banana） */
  async generateImage(request: ImageGenerateRequest): Promise<ImageGenerateResult> {
    if (!this.geminiApiKey) {
      throw new Error('Google image generation requires apiKey');
    }

    const model = request.model
      ?? this.imageGenerationDefaults.defaultModel
      ?? GOOGLE_DEFAULT_IMAGE_MODEL;
    const aspectRatio = request.aspectRatio ?? this.imageGenerationDefaults.aspectRatio;
    const imageSize = request.imageSize ?? this.imageGenerationDefaults.imageSize;

    const generationConfig: Record<string, unknown> = {
      responseModalities: ['IMAGE'],
    };
    if (aspectRatio || imageSize) {
      generationConfig.imageConfig = {
        ...(aspectRatio ? { aspectRatio } : {}),
        ...(imageSize ? { imageSize } : {}),
      };
    }

    const url = `${this.baseUrl}/models/${encodeURIComponent(model)}:generateContent`;
    const res = await this.fetch<GeminiGenerateContentResponse>(url, {
      method: 'POST',
      json: {
        contents: [{ parts: [{ text: request.prompt }] }],
        generationConfig,
      },
    });

    const image = extractGeminiImagePart(res);
    if (!image) {
      throw new Error('Gemini image generation returned no inline image data');
    }

    return {
      mimeType: image.mimeType,
      base64: image.base64,
      model,
    };
  }
}
