import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Plugin } from 'zhin.js';
import { IcqqAdapter } from '../src/adapter.js';
import { IcqqEndpoint } from '../src/endpoint.js';
import { Actions } from '../src/protocol.js';

describe('IcqqEndpoint guild channel send', () => {
  let adapter: IcqqAdapter;
  let endpoint: IcqqEndpoint;
  const request = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    const root = new Plugin('/test/root.ts');
    const plugin = new Plugin('/plugins/adapters/icqq/index.ts', root);
    adapter = new IcqqAdapter(plugin);
    endpoint = new IcqqEndpoint(adapter, { context: 'icqq', name: '10001' });
    endpoint.$connected = true;
    endpoint.ipc = { request } as never;
    request.mockResolvedValue({ ok: true, data: { message_id: 'guild-msg-1' } });
  });

  it('channel + parent.guild 调用 guild_send_msg', async () => {
    const id = await endpoint.$sendMessage({
      context: 'icqq',
      endpoint: '10001',
      type: 'channel',
      id: '634415832',
      parent: { type: 'guild', id: '650779094005186335' },
      content: [{ type: 'text', data: { text: 'nihao' } }],
    });
    expect(id).toBe('guild-msg-1');
    expect(request).toHaveBeenCalledWith(
      Actions.GUILD_SEND_MSG,
      expect.objectContaining({
        guild_id: '650779094005186335',
        channel_id: '634415832',
        message: expect.any(String),
      }),
    );
  });

  it('channel 无 parent.guild 时抛错', async () => {
    await expect(endpoint.$sendMessage({
      context: 'icqq',
      endpoint: '10001',
      type: 'channel',
      id: '634415832',
      content: 'hi',
    })).rejects.toThrow(/parent/);
  });
});
