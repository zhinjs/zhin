/** Self-test for tests/helpers/provider-harness (the shared mocked-HTTP provider harness). */
import { describe, expect, it } from 'vitest';
import {
  anthropicMessages,
  createMockFetch,
  createProviderHarness,
  geminiGenerate,
  openaiChat,
  PROVIDER_DEFAULTS,
  PROVIDER_PROTOCOL,
} from '../../helpers/provider-harness/index.js';

describe('provider harness', () => {
  it('has defaults and a protocol for every sdk', () => {
    expect(Object.keys(PROVIDER_PROTOCOL).sort()).toEqual(Object.keys(PROVIDER_DEFAULTS).sort());
  });

  it('serves JSON to non-streamed requests (completeText) from the same protocol reply', async () => {
    const h = createProviderHarness({ sdk: 'anthropic' });
    h.reply(anthropicMessages.reply({ text: '摘要' }));
    await expect(h.adapter().completeText('sys', 'user')).resolves.toBe('摘要');
    expect(h.lastRequest().stream).toBe(false);
  });

  it('serves Gemini replies on the google sdk', async () => {
    const h = createProviderHarness({ sdk: 'google' });
    h.reply(geminiGenerate.reply({ text: '你好' }));
    const message = await h.complete('hi');
    expect(h.lastRequest().url).toContain(':streamGenerateContent');
    expect(message.content).toEqual([{ type: 'text', text: '你好' }]);
  });

  it('routes persistent responders before the queue and records every request', async () => {
    const server = createMockFetch().route((r) => r.method === 'GET', { json: { data: [{ id: 'm1' }] } });
    const res = await server.fetch('https://x.test/v1/models');
    expect(await res.json()).toEqual({ data: [{ id: 'm1' }] });
    expect(server.requestsTo('/models')).toHaveLength(1);
  });

  it('fails loudly when no response is queued', async () => {
    const h = createProviderHarness({ sdk: 'openai' });
    await expect(h.complete('hi', { maxRetries: 0 })).rejects.toThrow(/no mocked response queued/);
  });

  it('can stall a stream until the caller aborts', async () => {
    const h = createProviderHarness({ sdk: 'openai-compatible' });
    const stalled = openaiChat.reply({ text: 'partial' }).stream({ body: {} } as never);
    h.reply({ sse: (stalled.sse ?? []).slice(0, 2), hang: 'after-events' });
    const controller = new AbortController();
    setTimeout(() => controller.abort(new Error('stop')), 20);
    await expect(h.complete('hi', { signal: controller.signal, maxRetries: 0 })).rejects.toThrow('stop');
  });
});
