/**
 * @zhin.js/ai - Providers Index
 * 导出所有 Provider
 */

export { BaseProvider } from './base.js';
export { OpenAIProvider, MoonshotProvider, ZhipuProvider } from './openai.js';
export { DeepSeekProvider, DEEPSEEK_MODELS } from './deepseek.js';
export { AnthropicProvider } from './anthropic.js';
export { OllamaProvider } from './ollama.js';
export { CloudflareProvider } from './cloudflare.js';
export { GoogleProvider } from './google.js';

export type { OpenAIConfig } from './openai.js';
export type { DeepSeekConfig } from './deepseek.js';
export type { AnthropicConfig } from './anthropic.js';
export type { OllamaConfig } from './ollama.js';
export type { CloudflareConfig } from './cloudflare.js';
export type { GoogleConfig } from './google.js';

export {
  ZHIPU_DEFAULT_IMAGE_MODEL,
  CLOUDFLARE_DEFAULT_IMAGE_MODEL,
  OPENAI_DEFAULT_IMAGE_MODEL,
  GOOGLE_DEFAULT_IMAGE_MODEL,
  hasGenerateImage,
  fetchImageUrlAsBase64,
} from '../image-generation.js';
export type {
  ImageGenerateRequest,
  ImageGenerateResult,
  ImageGenerationCapable,
} from '../image-generation.js';
