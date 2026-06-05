/**
 * Text-to-image generation types and helpers (provider-agnostic).
 */

export const ZHIPU_DEFAULT_IMAGE_MODEL = 'cogview-3-flash';
export const CLOUDFLARE_DEFAULT_IMAGE_MODEL = '@cf/black-forest-labs/flux-1-schnell';
/** OpenAI Images API：gpt-image-2 / gpt-image-1.5 / gpt-image-1 等 */
export const OPENAI_DEFAULT_IMAGE_MODEL = 'gpt-image-2';
/** Gemini Nano Banana（generateContent + IMAGE modality） */
export const GOOGLE_DEFAULT_IMAGE_MODEL = 'gemini-2.5-flash-image';

/**
 * 文生图默认项（`ai.imageGeneration` 或 `ai.providers.<alias>.imageGeneration`）。
 * 智谱：免费文生图为 `cogview-3-flash`（Flash 系列）；`cogview-4` 等为按次付费。
 * `watermarkEnabled: false` 须在开放平台签署去水印声明后才会生效。
 */
export interface ImageGenerationDefaults {
  /** 智谱 API `watermark_enabled`；默认 true */
  watermarkEnabled?: boolean;
  defaultModel?: string;
  /** 智谱：如 1024x1024、1280x1280 */
  defaultSize?: string;
  /** Cloudflare Flux：推理步数，默认 4 */
  numSteps?: number;
  /** OpenAI GPT Image：low | medium | high | auto */
  quality?: string;
  /** Gemini：如 1:1、16:9 */
  aspectRatio?: string;
  /** Gemini：如 1K、2K、4K */
  imageSize?: string;
  /**
   * 追加到 agent/用户 prompt 末尾的风格约束（如写实摄影）。
   * 需要动漫风时不要配置，或在工具 prompt 里写明即可。
   */
  promptSuffix?: string;
}

export interface ImageGenerateRequest {
  prompt: string;
  model?: string;
  /** zhipu: e.g. 1024x1024 */
  size?: string;
  /** cloudflare flux: default 4 */
  numSteps?: number;
  /**
   * 智谱文生图水印（`watermark_enabled`）。
   * 未传时使用 provider / ai 配置；仍默认 true。
   */
  watermarkEnabled?: boolean;
  /** OpenAI GPT Image */
  quality?: string;
  /** Gemini Nano Banana */
  aspectRatio?: string;
  imageSize?: string;
}

export interface ImageGenerateResult {
  mimeType: string;
  base64: string;
  model: string;
  revisedPrompt?: string;
}

export interface ImageGenerationCapable {
  generateImage(request: ImageGenerateRequest): Promise<ImageGenerateResult>;
}

export function hasGenerateImage(
  provider: unknown,
): provider is ImageGenerationCapable {
  return (
    provider != null
    && typeof provider === 'object'
    && typeof (provider as ImageGenerationCapable).generateImage === 'function'
  );
}

const MAX_IMAGE_FETCH_BYTES = 26_214_400;

export async function fetchImageUrlAsBase64(url: string): Promise<{ base64: string; mimeType: string } | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_IMAGE_FETCH_BYTES) return null;
    const mime = res.headers.get('content-type')?.split(';')[0]?.trim() || 'image/png';
    return { base64: buf.toString('base64'), mimeType: mime };
  } catch {
    return null;
  }
}

export function parseDataUrlBase64(dataUrl: string): { base64: string; mimeType: string } | null {
  const m = dataUrl.match(/^data:([^;,]+);base64,(.+)$/s);
  if (!m) return null;
  return { mimeType: m[1], base64: m[2] };
}

/** OpenAI 兼容 `/images/generations` 单条结果 */
export interface OpenAIImagesGenerationItem {
  url?: string;
  b64_json?: string;
  revised_prompt?: string;
}

/** 解析 OpenAI / 智谱等 Images API 响应中的首图 */
export async function resolveOpenAIImagesGenerationItem(
  item: OpenAIImagesGenerationItem | undefined,
  model: string,
  errorLabel = 'Image generation',
): Promise<ImageGenerateResult> {
  if (!item) {
    throw new Error(`${errorLabel} returned no data`);
  }

  let base64: string | undefined;
  let mimeType = 'image/png';

  if (item.b64_json) {
    base64 = item.b64_json;
  } else if (item.url) {
    const fetched = await fetchImageUrlAsBase64(item.url);
    if (!fetched) {
      throw new Error(`Failed to fetch generated image from URL: ${item.url}`);
    }
    base64 = fetched.base64;
    mimeType = fetched.mimeType;
  }

  if (!base64) {
    throw new Error(`${errorLabel} returned neither b64_json nor url`);
  }

  return {
    mimeType,
    base64,
    model,
    revisedPrompt: item.revised_prompt,
  };
}
