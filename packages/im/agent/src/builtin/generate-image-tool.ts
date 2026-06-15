/**
 * generate_image — 文生图（智谱 / Cloudflare / OpenAI GPT Image / Google Nano Banana）
 */
import type { Tool, ToolParametersSchema, ToolResult } from '@zhin.js/core';
import { hasGenerateImage, type AIProvider, type ImageGenerationDefaults } from '@zhin.js/ai';
import { BuiltinBaseTool } from './builtin-base-tool.js';

export const GENERATE_IMAGE_PARAMETERS: ToolParametersSchema = {
  type: 'object',
  properties: {
    provider_alias: {
      type: 'string',
      description:
        'ai.providers 中的实例名；sdk 须支持 generateImage：openai、google、openai-compatible（智谱等）、Cloudflare（accountId）',
    },
    prompt: {
      type: 'string',
      description:
        '图像描述。默认偏写实：写明主体与场景，并含 photorealistic/写实摄影/真实照片 等（除非用户要动漫插画）。避免仅写「可爱的」导致偏二次元。',
    },
    model: {
      type: 'string',
      description:
        '可选；默认：智谱 cogview-3-flash、OpenAI gpt-image-2、Gemini gemini-2.5-flash-image、Cloudflare flux-1-schnell',
    },
    size: {
      type: 'string',
      description: '可选；OpenAI/智谱尺寸，如 1024x1024',
    },
    quality: {
      type: 'string',
      description: '可选；OpenAI GPT Image：low | medium | high | auto',
    },
    aspect_ratio: {
      type: 'string',
      description: '可选；Gemini Nano Banana 宽高比，如 1:1、16:9',
    },
    image_size: {
      type: 'string',
      description: '可选；Gemini 输出分辨率：1K、2K、4K 等',
    },
    watermark_enabled: {
      type: 'boolean',
      description:
        '可选；智谱 CogView/GLM-Image 水印。false=去水印（须在智谱开放平台签署免责声明）；默认取 zhin.config 的 imageGeneration.watermarkEnabled',
    },
  },
  required: ['provider_alias', 'prompt'],
};

export type GetProviderFn = (alias: string) => AIProvider;
export type ResolveImageGenerationDefaultsFn = (providerAlias: string) => ImageGenerationDefaults;

function resolveWatermarkEnabled(
  args: Record<string, unknown>,
  defaults: ImageGenerationDefaults,
): boolean | undefined {
  if (typeof args.watermark_enabled === 'boolean') return args.watermark_enabled;
  if (typeof args.watermarkEnabled === 'boolean') return args.watermarkEnabled;
  return defaults.watermarkEnabled;
}

export class GenerateImageBuiltinTool extends BuiltinBaseTool {
  readonly name = 'generate_image';
  readonly description =
    'Text-to-image (文生图/画图). SDKs: openai-compatible + 智谱 (cogview-3-flash), Cloudflare (flux, accountId), openai (gpt-image-2), google (gemini-2.5-flash-image). Unless user wants anime, use 写实摄影/photorealistic in prompt.';
  readonly parameters = GENERATE_IMAGE_PARAMETERS;
  readonly kind = 'media';

  constructor(
    private readonly getProvider: GetProviderFn,
    private readonly resolveDefaults: ResolveImageGenerationDefaultsFn = () => ({}),
  ) {
    super();
    this.tags.push('media', 'image');
    this.keywords.push(
      'draw', 'generate', 'image', 'picture', 'paint', '画', '画图', '生图', '绘图', '图片生成',
      '文生图', '橘猫', 'cogview', 'flux', 'dall', 'gpt-image', 'gemini', 'nanobanana', 'illustration',
    );
  }

  async run(args: Record<string, unknown>): Promise<ToolResult> {
    const alias = args.provider_alias;
    const prompt = args.prompt;
    if (typeof alias !== 'string' || !alias.trim()) {
      return 'Error: provider_alias is required';
    }
    if (typeof prompt !== 'string' || !prompt.trim()) {
      return 'Error: prompt is required';
    }

    let provider: AIProvider;
    try {
      provider = this.getProvider(alias.trim());
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return `Error: unknown provider alias "${alias}": ${msg}`;
    }

    if (!hasGenerateImage(provider)) {
      return `Error: provider "${alias}" does not support image generation (sdk: openai, google, openai-compatible, or Cloudflare with accountId)`;
    }

    const defaults = this.resolveDefaults(alias.trim());
    const model = typeof args.model === 'string' && args.model.trim()
      ? args.model.trim()
      : defaults.defaultModel;
    const size = typeof args.size === 'string' && args.size.trim()
      ? args.size.trim()
      : defaults.defaultSize;
    const numSteps = typeof args.num_steps === 'number'
      ? args.num_steps
      : typeof args.numSteps === 'number'
        ? args.numSteps
        : defaults.numSteps;
    const watermarkEnabled = resolveWatermarkEnabled(args, defaults);
    const quality = typeof args.quality === 'string' && args.quality.trim()
      ? args.quality.trim()
      : defaults.quality;
    const aspectRatio = typeof args.aspect_ratio === 'string' && args.aspect_ratio.trim()
      ? args.aspect_ratio.trim()
      : typeof args.aspectRatio === 'string' && args.aspectRatio.trim()
        ? args.aspectRatio.trim()
        : defaults.aspectRatio;
    const imageSize = typeof args.image_size === 'string' && args.image_size.trim()
      ? args.image_size.trim()
      : typeof args.imageSize === 'string' && args.imageSize.trim()
        ? args.imageSize.trim()
        : defaults.imageSize;
    const suffix = defaults.promptSuffix?.trim();
    const finalPrompt = suffix ? `${prompt.trim()} ${suffix}`.trim() : prompt.trim();

    try {
      const result = await provider.generateImage({
        prompt: finalPrompt,
        model,
        size,
        numSteps,
        watermarkEnabled,
        quality,
        aspectRatio,
        imageSize,
      });
      return JSON.stringify({
        image: result.base64,
        mime: result.mimeType,
        model: result.model,
        provider: alias.trim(),
        revised_prompt: result.revisedPrompt,
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return `Error: image generation failed: ${msg}`;
    }
  }
}

export function createGenerateImageTool(
  getProvider: GetProviderFn,
  resolveDefaults?: ResolveImageGenerationDefaultsFn,
): Tool {
  return new GenerateImageBuiltinTool(getProvider, resolveDefaults).toTool() as Tool;
}
