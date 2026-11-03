import type { InferenceClient } from '@zhin.js/ai/provider';
import {
  defineAgentTool,
  toolFeatureId,
  type AgentToolDefinition,
  type ToolInputJsonObjectSchema,
  type ToolInputJsonSchema,
  type ToolExecutionContext,
} from '@zhin.js/tool';
import type { ImageAssetPublisher } from '../media/image-assets.js';
import { decodeBase64 } from '../media/media-normalize.js';
import { DEFAULT_MULTIMODAL_CONFIG } from '../media/media-types.js';

export interface NativeImageToolOptions {
  /** Resolve only the current operation's authorized client. No global provider registry. */
  readonly resolveInference: () => InferenceClient;
  readonly imageAssets?: ImageAssetPublisher;
}

export interface NativeImageToolFeature {
  readonly feature: typeof toolFeatureId;
  readonly name: 'generate_image';
  readonly definition: Readonly<AgentToolDefinition<Record<string, unknown>, string>>;
}

/** Generation-owned declaration; execution and image defaults belong to the selected Profile. */
export function createNativeImageToolFeature(options: NativeImageToolOptions): NativeImageToolFeature {
  return Object.freeze({
    feature: toolFeatureId,
    name: 'generate_image',
    definition: defineAgentTool<Record<string, unknown>, string>({
      description: 'Generate an image using the configured image purpose or an available image Profile.',
      inputSchema: objectSchema({
        profile_id: { type: 'string', description: 'Optional available image Profile ID; omit to use the image purpose' },
        prompt: { type: 'string', description: 'Concrete image description' },
        size: { type: 'string' },
        quality: { type: 'string' },
        aspect_ratio: { type: 'string' },
        image_size: { type: 'string' },
        num_steps: { type: 'number' },
        watermark_enabled: { type: 'boolean' },
      }, ['prompt']),
      requiresApproval: 'never',
      execute: (input, context) => generateImage({ input, context, options }),
    }),
  });
}

async function generateImage(args: Readonly<{
  input: Record<string, unknown>; context: ToolExecutionContext; options: NativeImageToolOptions;
}>): Promise<string> {
  const { input, context, options } = args;
  const imageAssets = options.imageAssets;
  const prompt = requiredString(input.prompt, 'prompt');
  context.signal.throwIfAborted();
  const client = options.resolveInference();
  const id = optionalString(input.profile_id);
  const profile = id ? (await client.list({ kind: 'image' })).find(profile => profile.reference.id === id)?.reference : undefined;
  if (id && !profile) throw new Error('Image Profile is unavailable in this operation');
  const result = await client.generateImage({ ...(profile ? { profile } : {}), signal: context.signal, request: {
    prompt, size: optionalString(input.size), numSteps: optionalNumber(input.num_steps),
    watermarkEnabled: optionalBoolean(input.watermark_enabled), quality: optionalString(input.quality),
    aspectRatio: optionalString(input.aspect_ratio), imageSize: optionalString(input.image_size),
  } });
  context.signal.throwIfAborted();
  const bytes = imageAssets ? decodeBase64(result.base64, DEFAULT_MULTIMODAL_CONFIG.maxFileBytes) : undefined;
  if (imageAssets && !bytes) throw new Error('Generated image is invalid or exceeds 25 MiB; do not regenerate automatically');
  const image = imageAssets
    ? await imageAssets.publish(bytes!, context.signal).catch(error => {
      context.signal.throwIfAborted();
      throw new Error('Image generation completed, but upload failed. Do not regenerate automatically; report the upload failure.', { cause: error });
    })
    : { image: result.base64, mime: result.mimeType };
  return JSON.stringify({
    ...image,
    model: result.model,
    ...(id ? { profile_id: id } : {}),
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
