import { describe, expect, it, vi } from 'vitest';
import { createInferenceRuntime, type ProviderGraph, type ProviderDefinition } from '@zhin.js/ai/provider';
import type { ToolExecutionContext } from '@zhin.js/tool';
import { createNativeImageToolFeature } from '../../src/plugin-runtime/native-image-tool.js';

const context = Object.freeze({
  signal: new AbortController().signal, traceId: 'trace', turnId: 'turn', sessionKey: 'session',
  origin: { kind: 'http', sessionId: 'session' }, principal: { subjectId: 'owner', roles: ['owner'] },
  policy: { permissions: ['owner'], unattended: false, network: { enabled: false } },
}) as unknown as ToolExecutionContext;
async function setup() {
  const generateImage = vi.fn(async () => ({ base64: 'aW1hZ2U=', mimeType: 'image/png', model: 'image-model', revisedPrompt: 'revised' }));
  const definition: ProviderDefinition<unknown, unknown> = { id: 'fixture', contractVersion: '1',
    authentication: { methods: ['none'] }, serviceSchema: { parse: value => value }, models: service => service.models,
    targets: () => ({ authentication: [], inference: [] }), createExecution: () => ({ image: { generate: generateImage } }) };
  const graph: ProviderGraph = { rootId: 'root', revision: 1, services: { service: { id: 'service', rootId: 'root', ownerId: 'host', revision: 1,
    driver: { id: 'fixture', owner: 'root/driver', contractVersion: '1' }, options: {}, models: { 'image-model': { id: 'image-model', kinds: ['image'], protocol: 'fixture' } } } },
    accounts: { account: { id: 'account', rootId: 'root', ownerId: 'host', revision: 1, serviceId: 'service', incarnation: 'first', authentication: { method: 'none' } } },
    profiles: { image: { id: 'image', rootId: 'root', ownerId: 'host', revision: 1, accountId: 'account', model: 'image-model', parameters: {} } },
    purposes: { defaults: { image: 'image' } } };
  const runtime = createInferenceRuntime({ repository: { readGraph: async () => graph },
    drivers: { acquire: async () => ({ definition, reference: graph.services.service!.driver, release() {} }) },
    credentials: () => ({ bindRequest: (input: { request: Request }) => input.request, authorize: async () => ({ headers: {}, revision: 'none' }) }), fetch: () => vi.fn() });
  const client = await runtime.openOperation({ context: { rootId: 'root', ownerId: 'host', hostOwnerId: 'host', operationId: 'turn' } });
  return { client, generateImage };
}

describe('native image ToolFeature', () => {
  it('resolves the current operation at execution and uses its configured image purpose', async () => {
    const fixture = await setup();
    try {
      const resolveInference = vi.fn(() => fixture.client);
      const feature = createNativeImageToolFeature({ resolveInference });
      const output = await feature.definition.execute({ prompt: 'a cat', size: '1024x1024' }, context);
      expect(resolveInference).toHaveBeenCalledOnce();
      expect(fixture.generateImage).toHaveBeenCalledWith(expect.objectContaining({ request: expect.objectContaining({ prompt: 'a cat', size: '1024x1024' }) }));
      expect(JSON.parse(output)).toEqual({ image: 'aW1hZ2U=', mime: 'image/png', model: 'image-model', revised_prompt: 'revised' });
    } finally { await fixture.client.close(); }
  });

  it('accepts only an available image Profile and never calls another model for an unavailable selection', async () => {
    const fixture = await setup();
    try {
      const feature = createNativeImageToolFeature({ resolveInference: () => fixture.client });
      await expect(feature.definition.execute({ profile_id: 'not-available', prompt: 'a cat' }, context)).rejects.toThrow('unavailable');
      expect(fixture.generateImage).not.toHaveBeenCalled();
      const output = await feature.definition.execute({ profile_id: 'image', prompt: 'a cat' }, context);
      expect(JSON.parse(output)).toMatchObject({ profile_id: 'image', model: 'image-model' });
      expect(fixture.generateImage).toHaveBeenCalledOnce();
    } finally { await fixture.client.close(); }
  });

  it('does not publish a known generated image after its operation was cancelled', async () => {
    const fixture = await setup(), controller = new AbortController();
    const publish = vi.fn();
    fixture.generateImage.mockImplementationOnce(async () => {
      controller.abort(new Error('synthetic operation cancelled'));
      return { base64: 'aW1hZ2U=', mimeType: 'image/png', model: 'image-model', revisedPrompt: 'revised' };
    });
    try {
      const feature = createNativeImageToolFeature({ resolveInference: () => fixture.client, imageAssets: { publish, ownsUrl: () => false } });
      await expect(feature.definition.execute({ prompt: 'a cat' }, { ...context, signal: controller.signal })).rejects.toThrow('synthetic operation cancelled');
      expect(fixture.generateImage).toHaveBeenCalledOnce();
      expect(publish).not.toHaveBeenCalled();
    } finally { await fixture.client.close(); }
  });

  it('reports an upload failure after generation without replaying the paid generation', async () => {
    const fixture = await setup();
    try {
      const publish = vi.fn(async () => { throw new Error('synthetic upload unavailable'); });
      const feature = createNativeImageToolFeature({ resolveInference: () => fixture.client, imageAssets: { publish, ownsUrl: () => false } });
      await expect(feature.definition.execute({ prompt: 'a cat' }, context)).rejects.toThrow('Do not regenerate automatically');
      expect(fixture.generateImage).toHaveBeenCalledOnce(); expect(publish).toHaveBeenCalledOnce();
    } finally { await fixture.client.close(); }
  });

  it.each(['success', 'generation-failed', 'upload-failed'] as const)(
    'keeps the caller-owned operation available through publication and after %s', async outcome => {
      const fixture = await setup();
      const publish = vi.fn(async () => {
        await expect(fixture.client.list({ kind: 'image' })).resolves.toHaveLength(1);
        if (outcome === 'upload-failed') throw new Error('synthetic upload failure');
        return { image: 'published', mime: 'image/png' };
      });
      if (outcome === 'generation-failed') fixture.generateImage.mockRejectedValueOnce(new Error('synthetic generation failure'));
      try {
        const feature = createNativeImageToolFeature({ resolveInference: () => fixture.client,
          imageAssets: { publish, ownsUrl: () => false } });
        const pending = feature.definition.execute({ prompt: 'a tree' }, context);
        if (outcome === 'success') await expect(pending).resolves.toContain('published');
        else await expect(pending).rejects.toThrow(outcome === 'generation-failed' ? 'synthetic generation failure' : 'Do not regenerate automatically');
        expect(fixture.generateImage).toHaveBeenCalledOnce();
        expect(publish).toHaveBeenCalledTimes(outcome === 'generation-failed' ? 0 : 1);
        await expect(fixture.client.list({ kind: 'image' })).resolves.toHaveLength(1);
      } finally { await fixture.client.close(); }
      await expect(fixture.client.list({ kind: 'image' })).rejects.toMatchObject({ code: 'operation-closed' });
    },
  );
});
