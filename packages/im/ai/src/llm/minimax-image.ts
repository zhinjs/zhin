/**
 * MiniMax image generation (direct REST — no AI SDK image model).
 * API: POST https://api.minimaxi.com/v1/image_generation
 * Models: image-01, image-01-live
 */

import type { ProviderInstanceConfig } from './types/model.js';
import {
  MINIMAX_DEFAULT_IMAGE_MODEL,
  type ImageGenerateRequest,
  type ImageGenerateResult,
  fetchImageUrlAsBase64,
} from '../image-generation.js';
import { resolveProxyFetch } from './proxy-fetch.js';

const MINIMAX_IMAGE_API = 'https://api.minimaxi.com/v1/image_generation';

interface MiniMaxImageResponse {
  id?: string;
  data?: {
    image_urls?: string[];
    image_base64?: string[];
  };
  metadata?: { success_count?: number; failed_count?: number };
  base_resp?: { status_code?: number; status_msg?: string };
}

export async function generateMiniMaxImage(
  config: ProviderInstanceConfig,
  request: ImageGenerateRequest,
  defaults: { defaultModel?: string; aspectRatio?: string; promptSuffix?: string } = {},
): Promise<ImageGenerateResult> {
  const apiKey = config.apiKey?.trim();
  if (!apiKey) {
    throw new Error('MiniMax image generation requires apiKey');
  }

  const model = request.model ?? defaults.defaultModel ?? MINIMAX_DEFAULT_IMAGE_MODEL;
  const prompt = request.prompt;
  if (!prompt?.trim()) {
    throw new Error('MiniMax image generation requires prompt');
  }

  const body: Record<string, unknown> = {
    model,
    prompt: prompt.slice(0, 1500),
    response_format: 'base64',
  };

  const aspectRatio = request.aspectRatio ?? defaults.aspectRatio;
  if (aspectRatio) body.aspect_ratio = aspectRatio;

  if (request.size) {
    const m = /^(\d+)x(\d+)$/.exec(request.size);
    if (m && model === 'image-01') {
      body.width = Number(m[1]);
      body.height = Number(m[2]);
    }
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    ...config.headers,
  };

  // config.baseUrl is the LM endpoint (Anthropic-compatible); image API is always at api.minimaxi.com
  const url = MINIMAX_IMAGE_API;

  const proxyFetch = resolveProxyFetch();
  const res = await (proxyFetch ?? fetch)(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`MiniMax image generation failed (${res.status}): ${text.slice(0, 300)}`);
  }

  const json = await res.json() as MiniMaxImageResponse;

  if (json.base_resp?.status_code && json.base_resp.status_code !== 0) {
    throw new Error(
      `MiniMax image generation error ${json.base_resp.status_code}: ${json.base_resp.status_msg ?? 'unknown'}`,
    );
  }

  const b64List = json.data?.image_base64;
  if (b64List && b64List.length > 0 && b64List[0]) {
    return { mimeType: 'image/png', base64: b64List[0], model };
  }

  const urlList = json.data?.image_urls;
  if (urlList && urlList.length > 0 && urlList[0]) {
    const fetched = await fetchImageUrlAsBase64(urlList[0]);
    if (!fetched) {
      throw new Error(`Failed to fetch MiniMax generated image from URL`);
    }
    return { mimeType: fetched.mimeType, base64: fetched.base64, model };
  }

  throw new Error('MiniMax image generation returned no image data');
}
