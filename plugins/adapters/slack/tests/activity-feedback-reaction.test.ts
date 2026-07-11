import { describe, expect, it, vi } from 'vitest';
import { normalizeSlackReactionName } from '../src/slack-reaction.js';
import { SlackEndpoint } from '../src/endpoint.js';
import type { SlackAdapter } from '../src/adapter.js';

describe('normalizeSlackReactionName', () => {
  it('maps unicode defaults to slack names', () => {
    expect(normalizeSlackReactionName('⏳')).toBe('hourglass_flowing_sand');
    expect(normalizeSlackReactionName(':eyes:')).toBe('eyes');
    expect(normalizeSlackReactionName('eyes')).toBe('eyes');
  });
});

describe('SlackEndpoint activity feedback reactions', () => {
  it('$addReaction uses reactions.add API with tracked channel', async () => {
    const reactions = {
      add: vi.fn().mockResolvedValue({ ok: true }),
      remove: vi.fn().mockResolvedValue({ ok: true }),
    };
    const adapter = { plugin: { logger: { debug: vi.fn(), warn: vi.fn(), error: vi.fn(), info: vi.fn() } } } as unknown as SlackAdapter;
    const endpoint = new SlackEndpoint(adapter, {
      context: 'slack',
      name: 'zhin',
      token: 'xoxb-test',
      signingSecret: 'secret',
    });
    endpoint.client = { reactions } as never;
    endpoint.trackMessageChannel('1783730000.000100', 'C0AS3CLRB6U');

    const reactionId = await endpoint.$addReaction('C0AS3CLRB6U:1783730000.000100', '⏳');
    expect(reactionId).toBe('hourglass_flowing_sand');
    expect(reactions.add).toHaveBeenCalledWith({
      channel: 'C0AS3CLRB6U',
      timestamp: '1783730000.000100',
      name: 'hourglass_flowing_sand',
    });

    await endpoint.$removeReaction('C0AS3CLRB6U:1783730000.000100', reactionId!);
    expect(reactions.remove).toHaveBeenCalledWith({
      channel: 'C0AS3CLRB6U',
      timestamp: '1783730000.000100',
      name: 'hourglass_flowing_sand',
    });
  });

  it('$recallMessage resolves channel from map without throwing', async () => {
    const chat = { delete: vi.fn().mockResolvedValue({ ok: true }) };
    const adapter = { plugin: { logger: { debug: vi.fn(), warn: vi.fn(), error: vi.fn(), info: vi.fn() } } } as unknown as SlackAdapter;
    const endpoint = new SlackEndpoint(adapter, {
      context: 'slack',
      name: 'zhin',
      token: 'xoxb-test',
      signingSecret: 'secret',
    });
    endpoint.client = { chat } as never;
    endpoint.trackMessageChannel('1783730000.000200', 'C0AS3CLRB6U');

    await endpoint.$recallMessage('C0AS3CLRB6U:1783730000.000200');
    expect(chat.delete).toHaveBeenCalledWith({ channel: 'C0AS3CLRB6U', ts: '1783730000.000200' });
  });

  it('$recallMessage ignores message_not_found', async () => {
    const chat = {
      delete: vi.fn().mockRejectedValue({
        data: { error: 'message_not_found' },
      }),
    };
    const adapter = { plugin: { logger: { debug: vi.fn(), warn: vi.fn(), error: vi.fn(), info: vi.fn() } } } as unknown as SlackAdapter;
    const endpoint = new SlackEndpoint(adapter, {
      context: 'slack',
      name: 'zhin',
      token: 'xoxb-test',
      signingSecret: 'secret',
    });
    endpoint.client = { chat } as never;

    await expect(endpoint.$recallMessage('D0BGBM1S1J9:1783730000.000300')).resolves.toBeUndefined();
  });
});
