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
        'Provider instance name from ai.providers; SDK must support generateImage: openai, google, openai-compatible (e.g. Zhipu), Cloudflare (accountId)',
    },
    prompt: {
      type: 'string',
      description:
        'Image description. Default to photorealistic: describe subject and scene, include photorealistic/realistic photography unless user wants anime/illustration. Avoid vague "cute" prompts that skew anime.',
    },
    model: {
      type: 'string',
      description:
        'Optional; defaults: Zhipu cogview-3-flash, OpenAI gpt-image-2, Gemini gemini-2.5-flash-image, Cloudflare flux-1-schnell',
    },
    size: {
      type: 'string',
      description: 'Optional; OpenAI/Zhipu size, e.g. 1024x1024',
    },
    quality: {
      type: 'string',
      description: 'Optional; OpenAI GPT Image: low | medium | high | auto',
    },
    aspect_ratio: {
      type: 'string',
      description: 'Optional; Gemini Nano Banana aspect ratio, e.g. 1:1, 16:9',
    },
    image_size: {
      type: 'string',
      description: 'Optional; Gemini output resolution: 1K, 2K, 4K, etc.',
    },
    watermark_enabled: {
      type: 'boolean',
      description:
        'Optional; Zhipu CogView/GLM-Image watermark. false=disable (requires disclaimer on Zhipu platform); default from zhin.config imageGeneration.watermarkEnabled',
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
    'Text-to-image generation. SDKs: openai-compatible + Zhipu (cogview-3-flash), Cloudflare (flux, accountId), openai (gpt-image-2), google (gemini-2.5-flash-image). Unless user wants anime, use photorealistic/realistic photography in prompt.';
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
