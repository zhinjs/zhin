import type { ProviderFixtureConfig } from '../helpers/provider-fixture-config.js';
import { profileModel } from '../helpers/profile-runtime.js';
/**
 * Explicit input capabilities, including familiar model names. Request bodies come
 * from the shared provider harness (`h.capture`).
 */
import { describe, expect, it, vi } from 'vitest';
import { driverFixture, callContext } from '../providers/fixtures.js';
import { openAiProvider, anthropicProvider } from '../../src/providers/api-key.js';
import { createUserMessage } from '../../src/llm/types/agent-message.js';

import { createProviderHarness } from '../helpers/provider-harness/index.js';

const PNG_1X1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

async function requestBody({ sdk, ...config }: ProviderFixtureConfig, modelId: string) {
  const h = createProviderHarness({ sdk, model: modelId, config: { ...config, input: ['text', 'image'] } });
  const { body } = await h.capture({
    system: 's',
    messages: [createUserMessage('图里是什么？', [{ type: 'image', data: { media: { kind: 'base64', value: PNG_1X1, mime_type: 'image/png' } } }])],
  });
  return body;
}

describe('explicit model input capabilities', () => {
  it.each(['gpt-5.5', 'gpt-5.4-mini', 'gpt-4.1', 'gpt-4.1-nano', 'gpt-4o', 'o3', 'o4-mini', 'gpt-3.5-turbo', 'o3-mini', 'o1-mini', 'gpt-image-1', 'claude-fable-5', 'claude-opus-4-8', 'claude-sonnet-4-6', 'claude-haiku-4-5-20251001'])('does not grant %s image capability from its name', async id => {
    const definition = id.startsWith('claude-') ? anthropicProvider : openAiProvider;
    const fixture = driverFixture({ definition, model: { id, kinds: ['language'], protocol: id.startsWith('claude-') ? 'anthropic-messages' : 'openai-chat' }, fetch: vi.fn() });
    const client = await fixture.runtime.openOperation({ context: callContext });
    try { expect((await client.list({ kind: 'language' }))[0].definition.input).toBeUndefined(); expect(fixture.authorize).not.toHaveBeenCalled(); } finally { await client.close(); }
  });

  it('keeps explicitly supplied modalities', () => {
    expect(profileModel('p', { sdk: 'openai', input: ['text'] }, 'gpt-5').input).toEqual(['text']);
    expect(profileModel('p', { sdk: 'anthropic', input: ['text', 'image', 'file'] }, 'claude-sonnet-4-6').input).toEqual(['text', 'image', 'file']);
  });

  it('openai: the image goes out as an image_url part, not a placeholder', async () => {
    const body = await requestBody({ sdk: 'openai', apiKey: 'k' }, 'gpt-5.4-mini');
    const content = body.messages.find((m: { role: string }) => m.role === 'user').content;
    expect(content).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'image_url', image_url: expect.objectContaining({ url: expect.stringContaining('data:image/png;base64,') }) }),
    ]));
    expect(JSON.stringify(content)).not.toContain('Media unavailable');
  });

  it('anthropic: the image goes out as an image block', async () => {
    const body = await requestBody({ sdk: 'anthropic', apiKey: 'k' }, 'claude-sonnet-4-6');
    const content = body.messages[0].content;
    expect(content).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'image', source: expect.objectContaining({ type: 'base64', media_type: 'image/png', data: PNG_1X1 }) }),
    ]));
  });
});
