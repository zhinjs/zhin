import { describe, expect, it } from 'vitest';
import { createProviderHarness, geminiGenerate, openaiChat, type ProviderHarness } from '../../../ai/tests/helpers/provider-harness/index.js';
import type { ModelExecutionBundle } from '../../src/model-runtime/types.js';
import { createScopedMediaPerceptionPort, createScopedPerceptionFactory } from '../../src/media/scoped-perception.js';
import { DEFAULT_PERCEPTION_SETTINGS, resolvePerceptionConfig } from '../../src/config/perception-config.js';

const payload = { kind: 'image' as const, base64: Buffer.from('synthetic image').toString('base64'), mimeType: 'image/png' };
const NO_RETRY = { maxRetries: 0, baseDelayMs: 0, maxDelayMs: 0 };
function bundle(h: ProviderHarness): ModelExecutionBundle {
  return { provider: h.adapter(), llmRuntime: h.runtime,
    invocation: {
      preset: { id: `preset:${h.alias}`, modelId: `model:${h.alias}` },
      model: { id: `model:${h.alias}`, connectionId: h.alias, model: h.modelId, capabilities: { input: h.model.input } },
      connection: { id: h.alias, ownerId: 'host', revision: 1, sdk: h.sdk },
    } };
}

describe('scoped perception against real SDK completion with mocked HTTP', () => {
  it('does not enable an old global perception chain when this scope has no perception', () => {
    const old = createProviderHarness({ sdk: 'google', alias: 'old' });
    expect(createScopedMediaPerceptionPort({ scope: { perceptionFallbacks: [bundle(old)] } })).toBeUndefined();
    expect(old.requests).toHaveLength(0);
  });

  it('ignores routing fields in a full legacy settings object and uses the acquired model', async () => {
    const h = createProviderHarness({ sdk: 'google', alias: 'leased-provider' }).reply(geminiGenerate.reply({ text: 'abcdefghijk' }));
    const settings = resolvePerceptionConfig({ provider: 'global-provider', model: 'global-model',
      fallbacks: [{ provider: 'unleased-backup', model: 'other-model' }], maxChars: 5, maxItemsPerTurn: 2, kinds: ['image', 'file'] })!;
    const port = createScopedMediaPerceptionPort({ scope: { perception: bundle(h) }, settings, resilience: NO_RETRY })!;
    expect(await port.describe(payload)).toMatchObject({ provider: 'leased-provider', model: h.modelId, text: 'abcd…' });
    expect(port.maxItemsPerTurn).toBe(2);
    expect(port.kinds).toEqual(['image', 'file']);
    expect(h.requests).toHaveLength(1);
    expect(JSON.stringify(h.requests)).not.toContain('global-model');
  });

  it('retains existing non-routing defaults for a new perception preset', () => {
    const h = createProviderHarness({ sdk: 'google' });
    const port = createScopedMediaPerceptionPort({ scope: { perception: bundle(h) } })!;
    expect(port.kinds).toEqual(DEFAULT_PERCEPTION_SETTINGS.kinds);
    expect(port.maxItemsPerTurn).toBe(DEFAULT_PERCEPTION_SETTINGS.maxItemsPerTurn);
  });

  it.each(['error', 'empty', 'text-only'] as const)('preserves an acquired cross-provider fallback after %s with usage and cache', async reason => {
    const primary = createProviderHarness({ sdk: 'google', alias: 'primary', ...(reason === 'text-only' ? { config: { input: ['text'] } } : {}) });
    if (reason === 'error') primary.reply(geminiGenerate.error(400, { message: 'unavailable' }));
    if (reason === 'empty') primary.reply(geminiGenerate.reply({ text: '', usageMetadata: { promptTokenCount: 20, candidatesTokenCount: 0, totalTokenCount: 20 } }));
    const backup = createProviderHarness({ sdk: 'openai', alias: 'backup' }).reply(openaiChat.reply({ text: 'A circle', usage: { prompt: 30, completion: 4 } }));
    const port = createScopedMediaPerceptionPort({ scope: { perception: bundle(primary), perceptionFallbacks: [bundle(backup)] }, resilience: NO_RETRY })!;
    const result = await port.describe(payload);
    expect(result).toMatchObject({ text: 'A circle', provider: 'backup', model: backup.modelId, cached: false });
    if (reason === 'empty') expect(result?.usage?.total_tokens).toBe(54);
    if (reason === 'error') expect(result!.usage!.total_tokens).toBeGreaterThan(1034);
    expect(primary.requests).toHaveLength(reason === 'text-only' ? 0 : 1);
    expect(backup.requests).toHaveLength(1);
    expect(await port.describe(payload)).toEqual({ text: 'A circle', provider: 'backup', model: backup.modelId, cached: true });
    expect(backup.requests).toHaveLength(1);
  });

  it('does not send a backup after the turn is cancelled', async () => {
    const primary = createProviderHarness({ sdk: 'google', alias: 'primary' }).reply({ hang: 'before-headers' });
    const backup = createProviderHarness({ sdk: 'openai', alias: 'backup' });
    const port = createScopedMediaPerceptionPort({ scope: { perception: bundle(primary), perceptionFallbacks: [bundle(backup)] }, resilience: NO_RETRY })!;
    const controller = new AbortController();
    const running = port.describe(payload, controller.signal);
    controller.abort(new Error('turn cancelled'));
    await expect(running).rejects.toThrow();
    expect(backup.requests).toHaveLength(0);
  });

  it('does not share cached descriptions between differently acquired scopes', async () => {
    const first = createProviderHarness({ sdk: 'google', alias: 'first' }).reply(geminiGenerate.reply({ text: 'first description' }));
    const second = createProviderHarness({ sdk: 'google', alias: 'second' }).reply(geminiGenerate.reply({ text: 'second description' }));
    const a = createScopedMediaPerceptionPort({ scope: { perception: bundle(first) }, resilience: NO_RETRY })!;
    const b = createScopedMediaPerceptionPort({ scope: { perception: bundle(second) }, resilience: NO_RETRY })!;
    expect((await a.describe(payload))?.text).toBe('first description');
    expect((await b.describe(payload))?.text).toBe('second description');
    expect(first.requests).toHaveLength(1);
    expect(second.requests).toHaveLength(1);
  });
  it('preserves cross-turn cache reuse within one personal scope without sharing another person or model revision', async () => {
    const h = createProviderHarness({ sdk: 'google' }).reply(geminiGenerate.reply({ text: 'same picture' }))
      .reply(geminiGenerate.reply({ text: 'other owner' })).reply(geminiGenerate.reply({ text: 'new revision' }));
    const factory = createScopedPerceptionFactory();
    const acquired = bundle(h);
    const options = { scope: { perception: acquired }, sessionKey: 'personal-session:v1:alice', resilience: NO_RETRY };
    expect(await factory(options)!.describe(payload)).toMatchObject({ cached: false });
    expect(await factory(options)!.describe(payload)).toMatchObject({ cached: true, text: 'same picture' });
    expect(await factory({ ...options, sessionKey: 'personal-session:v1:bob' })!.describe(payload)).toMatchObject({ cached: false, text: 'other owner' });
    const revised = { ...acquired, invocation: { ...acquired.invocation, connection: { ...acquired.invocation.connection, revision: 2 } } };
    expect(await factory({ ...options, scope: { perception: revised } })!.describe(payload)).toMatchObject({ cached: false, text: 'new revision' });
    expect(h.requests).toHaveLength(3);
  });

});
