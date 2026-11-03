import { describe, expect, it, vi } from 'vitest';
import type { AIProvider, ImageGenerateRequest } from '@zhin.js/ai';
import type { ToolExecutionContext } from '@zhin.js/tool';
import { ModelLeaseError } from '@zhin.js/ai/model-catalog';
import { getLogger } from '@zhin.js/logger';
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
  it.each([true, false])('logs a safe cleanup cause without exposing arbitrary exception text (typed=%s)', async typed => {
    const warning = vi.spyOn(getLogger('agent'), 'warn').mockImplementation(() => undefined);
    const release = async () => { throw typed ? new ModelLeaseError('resource-dispose-failed') : new Error('synthetic-private-release-detail'); };
    const feature = createNativeImageToolFeature(() => { throw new Error('unexpected legacy lookup'); }, undefined, undefined,
      async () => ({ provider: { generateImage: async () => ({ base64: 'aW1hZ2U=', mimeType: 'image/png', model: 'image' }) } as unknown as AIProvider,
        defaults: {}, release }));
    try {
      await expect(feature.definition.execute({ provider_alias: 'images', prompt: 'a tree' }, context)).resolves.toContain('aW1hZ2U=');
      const log = warning.mock.calls.flat().join(' ');
      expect(log).toContain(`cause: ${typed ? 'resource-dispose-failed' : 'unclassified'}`);
      expect(log).not.toContain('synthetic-private-release-detail');
    } finally { warning.mockRestore(); }
  });
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

  it.each(['success', 'generation-failed', 'cancelled', 'upload-failed', 'release-failed'] as const)('holds its provider lease through generation and publication, then releases on %s', async outcome => {
    const controller = new AbortController();
    const release = vi.fn(async () => { if (outcome === 'release-failed') throw new Error('synthetic cleanup failure'); });
    const publish = vi.fn(async () => {
      expect(release).not.toHaveBeenCalled();
      if (outcome === 'upload-failed') throw new Error('synthetic upload failure');
      return { image: 'published', mime: 'image/png' };
    });
    const generateImage = vi.fn(async (request: ImageGenerateRequest) => {
      expect(release).not.toHaveBeenCalled();
      expect(request.model).toBe('explicit-model');
      if (outcome === 'generation-failed') throw new Error('synthetic generation failure');
      if (outcome === 'cancelled') controller.abort();
      return { base64: 'aW1hZ2U=', mimeType: 'image/png', model: 'explicit-model' };
    });
    const legacyLookup = vi.fn(() => { throw new Error('stale provider lookup'); });
    const acquire = vi.fn(async () => ({ provider: { generateImage } as unknown as AIProvider, defaults: { defaultModel: 'ignored-default' }, release }));
    const feature = createNativeImageToolFeature(legacyLookup, legacyLookup, { publish } as never, acquire);
    const result = feature.definition.execute({ provider_alias: 'images', prompt: 'a tree', model: 'explicit-model' },
      { ...context, signal: controller.signal });
    if (outcome === 'success' || outcome === 'release-failed') await expect(result).resolves.toContain('published');
    else await expect(result).rejects.toThrow();
    expect(acquire).toHaveBeenCalledWith('images', controller.signal);
    expect(release).toHaveBeenCalledTimes(1);
    expect(legacyLookup).not.toHaveBeenCalled();
    expect(publish).toHaveBeenCalledTimes(outcome === 'success' || outcome === 'upload-failed' || outcome === 'release-failed' ? 1 : 0);
  });
});
