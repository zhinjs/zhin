import { openAiCompatibleProvider } from '../../src/providers/api-key.js';
import { driverFixture, callContext, prompt } from './fixtures.js';

// #1250 model-request-hangs-no-timeout: the SDK transport reports the provider's first byte
// (response headers) so the resilience layer can stop its first-response deadline.
it('reports response start once the provider answers, before the body is consumed', async () => {
  const order: string[] = [];
  const fixture = driverFixture({
    definition: openAiCompatibleProvider, options: { baseUrl: 'https://provider.example/v1' },
    model: { id: 'selected', kinds: ['language'], protocol: 'openai-chat' }, parameters: { maxRetries: 0 },
    fetch: async () => {
      order.push('fetch');
      return Response.json({ id: 'c', created: 1, model: 'selected',
        choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: 'pong' } }] });
    },
  });
  const client = await fixture.runtime.openOperation({ context: callContext });
  try {
    const message = await client.generate({ request: { context: prompt, options: { onResponseStart: () => order.push('response-start') } } });
    expect(message.content).toEqual([expect.objectContaining({ type: 'text', text: 'pong' })]);
    expect(order).toEqual(['fetch', 'response-start']);
  } finally { await client.close(); }
});

it('does not report response start for a request that never answers', async () => {
  const started = vi.fn();
  const controller = new AbortController();
  const fixture = driverFixture({
    definition: openAiCompatibleProvider, options: { baseUrl: 'https://provider.example/v1' },
    model: { id: 'selected', kinds: ['language'], protocol: 'openai-chat' }, parameters: { maxRetries: 0 },
    fetch: (input, init) => new Promise((_, reject) => {
      const signal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
      signal?.addEventListener('abort', () => reject(signal.reason));
      queueMicrotask(() => controller.abort(new Error('caller stopped')));
    }),
  });
  const client = await fixture.runtime.openOperation({ context: callContext });
  try {
    await expect(client.generate({ request: { context: prompt, options: { onResponseStart: started } }, signal: controller.signal })).rejects.toBeDefined();
    expect(started).not.toHaveBeenCalled();
  } finally { await client.close(); }
});
