/**
 * Cloudflare Workers AI image generation (legacy HTTP — ADR 0018 Phase 1 exception).
 * Chat uses AI SDK openai-compatible; images use /ai/run/{model}.
 */

import type { ProviderInstanceConfig } from '../llm/types/model.js';
import { CLOUDFLARE_DEFAULT_IMAGE_MODEL, type ImageGenerateRequest, type ImageGenerateResult } from '../image-generation.js';

export async function generateCloudflareImage(
  config: ProviderInstanceConfig,
  request: ImageGenerateRequest,
  defaults: { defaultModel?: string; numSteps?: number } = {},
): Promise<ImageGenerateResult> {
  const accountId = config.accountId?.trim();
  if (!accountId) {
    throw new Error('Cloudflare image generation requires accountId');
  }
  const apiKey = config.apiKey?.trim();
  if (!apiKey) {
    throw new Error('Cloudflare image generation requires apiKey');
  }

  const model = request.model ?? defaults.defaultModel ?? CLOUDFLARE_DEFAULT_IMAGE_MODEL;
  const numSteps = request.numSteps ?? defaults.numSteps ?? 4;
  const runUrl = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${model}`;

  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    ...config.headers,
  };

  const res = await fetch(runUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify({ prompt: request.prompt, num_steps: numSteps }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Cloudflare image generation failed (${res.status}): ${body.slice(0, 200)}`);
  }

  const json = await res.json() as {
    success?: boolean;
    result?: { image?: string };
    errors?: Array<{ message?: string }>;
  };

  const b64 = json.result?.image;
  if (!b64 || typeof b64 !== 'string') {
    const errMsg = json.errors?.[0]?.message ?? 'no image in result';
    throw new Error(`Cloudflare image generation failed: ${errMsg}`);
  }

  return {
    mimeType: 'image/png',
    base64: b64,
    model,
  };
}
