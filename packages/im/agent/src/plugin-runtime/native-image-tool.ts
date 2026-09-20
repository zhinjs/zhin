import {
  hasGenerateImage,
  type AIProvider,
  type ImageGenerationDefaults,
} from '@zhin.js/ai';
import {
  defineAgentTool,
  toolFeatureId,
  type AgentToolDefinition,
  type ToolInputJsonObjectSchema,
  type ToolInputJsonSchema,
  type ToolExecutionContext,
} from '@zhin.js/tool';

export type ImageProviderResolver = (alias: string) => AIProvider;
export type ImageGenerationDefaultsResolver = (alias: string) => ImageGenerationDefaults;

export interface NativeImageToolFeature {
  readonly feature: typeof toolFeatureId;
  readonly name: 'generate_image';
  readonly definition: Readonly<AgentToolDefinition<Record<string, unknown>, string>>;
}

/** Generation-owned image Tool. Provider lookup remains with the Host-owned AIService. */
export function createNativeImageToolFeature(
  resolveProvider: ImageProviderResolver,
  resolveDefaults: ImageGenerationDefaultsResolver = () => ({}),
): NativeImageToolFeature {
  return Object.freeze({
    feature: toolFeatureId,
    name: 'generate_image',
    definition: defineAgentTool<Record<string, unknown>, string>({
      description: 'Generate an image with a configured image-capable AI provider.',
      inputSchema: objectSchema({
        provider_alias: { type: 'string', description: 'Configured AI provider alias' },
        prompt: { type: 'string', description: 'Concrete image description' },
        model: { type: 'string' },
        size: { type: 'string' },
        quality: { type: 'string' },
        aspect_ratio: { type: 'string' },
        image_size: { type: 'string' },
        num_steps: { type: 'number' },
        watermark_enabled: { type: 'boolean' },
      }, ['provider_alias', 'prompt']),
      requiresApproval: 'never',
      execute: (input, context) => generateImage(input, context, resolveProvider, resolveDefaults),
    }),
  });
}

async function generateImage(
  input: Record<string, unknown>,
  context: ToolExecutionContext,
  resolveProvider: ImageProviderResolver,
  resolveDefaults: ImageGenerationDefaultsResolver,
): Promise<string> {
  const alias = requiredString(input.provider_alias, 'provider_alias');
  const prompt = requiredString(input.prompt, 'prompt');
  const provider = resolveProvider(alias);
  if (!hasGenerateImage(provider)) {
    throw new Error(`AI provider "${alias}" does not support image generation`);
  }

  const defaults = resolveDefaults(alias);
  const suffix = optionalString(defaults.promptSuffix);
  const finalPrompt = suffix ? `${prompt} ${suffix}` : prompt;
  context.signal.throwIfAborted();
  const result = await provider.generateImage({
    prompt: finalPrompt,
    model: optionalString(input.model) ?? defaults.defaultModel,
    size: optionalString(input.size) ?? defaults.defaultSize,
    numSteps: optionalNumber(input.num_steps) ?? defaults.numSteps,
    watermarkEnabled: optionalBoolean(input.watermark_enabled) ?? defaults.watermarkEnabled,
    quality: optionalString(input.quality) ?? defaults.quality,
    aspectRatio: optionalString(input.aspect_ratio) ?? defaults.aspectRatio,
    imageSize: optionalString(input.image_size) ?? defaults.imageSize,
  });
  context.signal.throwIfAborted();
  return JSON.stringify({
    image: result.base64,
    mime: result.mimeType,
    model: result.model,
    provider: alias,
    revised_prompt: result.revisedPrompt,
  });
}

function objectSchema(
  properties: Record<string, ToolInputJsonSchema>,
  required: readonly string[],
): ToolInputJsonObjectSchema {
  return Object.freeze({ type: 'object', properties: Object.freeze(properties), required: Object.freeze([...required]) });
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${field} must be a non-empty string`);
  return value.trim();
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function optionalBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}
