/**
 * S7: OpenAI and Anthropic vision models default to image input, so group images
 * reach them instead of the "[Media unavailable]" placeholder. Request bodies come
 * from the shared provider harness (`h.capture`).
 */
import { describe, expect, it } from 'vitest';
import { createLlmTransportModel, defaultModelInput } from '../../src/llm/llm-api-runtime.js';
import { createUserMessage } from '../../src/llm/types/agent-message.js';
import type { ProviderInstanceConfig } from '../../src/llm/types/model.js';
import { createProviderHarness } from '../helpers/provider-harness/index.js';

const PNG_1X1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

async function requestBody({ sdk, ...config }: ProviderInstanceConfig, modelId: string) {
  const h = createProviderHarness({ sdk, model: modelId, config });
  const { body } = await h.capture({
    system: 's',
    messages: [createUserMessage('图里是什么？', [{ type: 'image', data: { media: { kind: 'base64', value: PNG_1X1, mime_type: 'image/png' } } }])],
  });
  return body;
}

describe('default model input (S7)', () => {
  it.each(['gpt-5.5', 'gpt-5.4-mini', 'gpt-4.1', 'gpt-4.1-nano', 'gpt-4o', 'o3', 'o4-mini'])('openai %s takes images', (id) => {
    expect(defaultModelInput('openai', id)).toEqual(['text', 'image']);
  });

  it.each(['gpt-3.5-turbo', 'o3-mini', 'o1-mini', 'gpt-4o-audio-preview', 'gpt-4o-realtime-preview', 'gpt-4o-mini-tts', 'gpt-image-1', 'text-embedding-3-small', 'gpt-4o-search-preview'])('openai %s stays text-only', (id) => {
    expect(defaultModelInput('openai', id)).toEqual(['text']);
  });

  it.each(['claude-fable-5', 'claude-opus-4-8', 'claude-sonnet-4-6', 'claude-haiku-4-5-20251001', 'claude-3-5-sonnet-latest'])('anthropic %s takes images', (id) => {
    expect(defaultModelInput('anthropic', id)).toEqual(['text', 'image']);
  });

  it('other SDKs stay text-only and an explicit input wins', () => {
    expect(defaultModelInput('anthropic', 'claude-2.1')).toEqual(['text']);
    expect(defaultModelInput('deepseek', 'deepseek-chat')).toEqual(['text']);
    expect(defaultModelInput('openai-compatible', 'gpt-5')).toEqual(['text']);
    expect(defaultModelInput('minimax', 'MiniMax-M2')).toEqual(['text']);
    expect(createLlmTransportModel('p', { sdk: 'openai', input: ['text'] }, 'gpt-5').input).toEqual(['text']);
    expect(createLlmTransportModel('p', { sdk: 'anthropic', input: ['text', 'image', 'file'] }, 'claude-sonnet-4-6').input).toEqual(['text', 'image', 'file']);
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
