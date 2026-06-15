/**
 * AI SDK image generation helper (internal transport).
 */

import { generateImage } from 'ai';
import type { SdkId } from '../sdk-registry.js';
import { createImageModel, sdkSupportsImageGeneration } from '../sdk-registry.js';
import type { ProviderInstanceConfig } from '../types/model.js';
import type { ImageGenerateRequest, ImageGenerateResult } from '../../image-generation.js';
import { generateCloudflareImage } from '../cloudflare-image.js';

function parseSize(size: string | undefined): `${number}x${number}` | undefined {
  if (!size?.trim()) return undefined;
  const match = /^(\d+)x(\d+)$/.exec(size.trim());
  if (!match) return undefined;
  return `${match[1]}x${match[2]}` as `${number}x${number}`;
}

function parseAspectRatio(ratio: string | undefined): `${number}:${number}` | undefined {
  if (!ratio?.trim()) return undefined;
  const match = /^(\d+):(\d+)$/.exec(ratio.trim());
  if (!match) return undefined;
  return `${match[1]}:${match[2]}` as `${number}:${number}`;
}

export async function generateImageViaAiSdk(
  sdk: SdkId,
  config: ProviderInstanceConfig,
  request: ImageGenerateRequest,
  defaults: ProviderInstanceConfig['imageGeneration'] = {},
): Promise<ImageGenerateResult> {
  if (config.accountId && !config.baseUrl?.trim()) {
    return generateCloudflareImage(config, request, defaults);
  }

  if (!sdkSupportsImageGeneration(sdk)) {
    throw new Error(`sdk "${sdk}" does not support image generation via AI SDK`);
  }

  const modelId = request.model ?? defaults.defaultModel;
  if (!modelId) {
    throw new Error('image model is required');
  }

  const imageModel = createImageModel(sdk, config, modelId);
  if (!imageModel) {
    throw new Error(`sdk "${sdk}" has no image model for "${modelId}"`);
  }

  const providerOptions: { openai?: { watermark_enabled: boolean } } = {};
  if (sdk === 'openai-compatible' && request.watermarkEnabled != null) {
    providerOptions.openai = { watermark_enabled: request.watermarkEnabled };
  }

  const result = await generateImage({
    model: imageModel,
    prompt: request.prompt,
    size: parseSize(request.size ?? defaults.defaultSize),
    aspectRatio: parseAspectRatio(request.aspectRatio ?? defaults.aspectRatio),
    providerOptions: Object.keys(providerOptions).length > 0 ? providerOptions : undefined,
    headers: config.headers,
  });

  const image = result.image;
  if (!image) {
    throw new Error('AI SDK generateImage returned no image');
  }

  const base64 = typeof image.base64 === 'string'
    ? image.base64
    : Buffer.from(await image.uint8Array).toString('base64');

  return {
    mimeType: image.mediaType ?? 'image/png',
    base64,
    model: modelId,
    revisedPrompt: result.providerMetadata
      ? undefined
      : undefined,
  };
}
