import { describe, expect, it, vi } from 'vitest';
import type { AIProvider, ImageGenerateRequest } from '@zhin.js/ai';
import type { ToolExecutionContext } from '@zhin.js/tool';
import { createNativeImageToolFeature } from '../../src/plugin-runtime/native-image-tool.js';

const context = Object.freeze({
  signal: new AbortController().signal,
  traceId: 'trace',
  turnId: 'turn',
  sessionKey: 'session',
  origin: Object.freeze({ kind: 'http' as const, sessionId: 'session' }),
  principal: Object.freeze({ subjectId: 'owner', roles: Object.freeze(['master']) }),
  policy: Object.freeze({ permissions: Object.freeze(['master']), unattended: false, network: Object.freeze({ enabled: false }) }),
}) as unknown as ToolExecutionContext;

describe('native image ToolFeature', () => {
  it('resolves the configured provider at execution time and applies host defaults', async () => {
    const generateImage = vi.fn(async (_request: ImageGenerateRequest) => ({
      base64: 'aW1hZ2U=',
      mimeType: 'image/png',
      model: 'image-model',
      revisedPrompt: 'revised',
    }));
    const resolveProvider = vi.fn(() => ({ generateImage }) as unknown as AIProvider);
    const feature = createNativeImageToolFeature(resolveProvider, () => ({
      defaultModel: 'image-model',
      defaultSize: '1024x1024',
      promptSuffix: 'photorealistic',
    }));

    const output = await feature.definition.execute({
      provider_alias: 'images',
      prompt: 'a cat',
    }, context);

    expect(resolveProvider).toHaveBeenCalledWith('images');
    expect(generateImage).toHaveBeenCalledWith(expect.objectContaining({
      prompt: 'a cat photorealistic',
      model: 'image-model',
      size: '1024x1024',
    }));
    expect(JSON.parse(output)).toEqual({
      image: 'aW1hZ2U=',
      mime: 'image/png',
      model: 'image-model',
      provider: 'images',
      revised_prompt: 'revised',
    });
  });

  it('rejects providers without image generation instead of publishing a false success', async () => {
    const feature = createNativeImageToolFeature(() => ({}) as AIProvider);

    await expect(feature.definition.execute({
      provider_alias: 'text-only',
      prompt: 'a cat',
    }, context)).rejects.toThrow('does not support image generation');
  });
});
