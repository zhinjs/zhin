/**
 * Text-to-image generation types (provider-agnostic).
 */

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
