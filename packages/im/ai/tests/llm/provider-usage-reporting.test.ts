import { describe, expect, it } from 'vitest';
import { anthropicMessages, createProviderHarness, openaiChat } from '../helpers/provider-harness/index.js';

describe('provider usage availability (#957)', () => {
  it('distinguishes absent usage from an explicit zero', async () => {
    const h = createProviderHarness({ sdk: 'openai-compatible' })
      .reply(openaiChat.reply({ text: 'ok' }))
      .reply(openaiChat.reply({ text: 'ok', usage: { prompt: 0, completion: 0, cached: 0 }, streamUsage: 'always' }));
    const missing = await h.complete({ user: 'hello' });
    expect(missing.usage.reported).toMatchObject({ input: false, output: false, cacheRead: false, cacheWrite: false });
    const zero = await h.complete({ user: 'hello' });
    expect(zero.usage.reported).toMatchObject({ input: true, output: true, cacheRead: true, cacheWrite: false });
  });

  it('keeps Anthropic cache writes separately from total input', async () => {
    const h = createProviderHarness({ sdk: 'anthropic' })
      .reply(anthropicMessages.reply({ text: 'ok', usage: { input: 100, output: 10, cacheRead: 600, cacheWrite: 300 } }));
    const reply = await h.complete({ user: 'hello' });
    expect(reply.usage).toMatchObject({ input: 1000, output: 10, cacheRead: 600, cacheWrite: 300,
      reported: { input: true, output: true, cacheRead: true, cacheWrite: true } });
  });
});
