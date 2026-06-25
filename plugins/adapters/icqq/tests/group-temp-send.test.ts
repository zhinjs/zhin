import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Plugin } from 'zhin.js';
import { IcqqAdapter } from '../src/adapter.js';
import { IcqqEndpoint } from '../src/endpoint.js';
import { Actions } from '../src/protocol.js';

describe('IcqqEndpoint group temp send', () => {
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
    request.mockResolvedValue({ ok: true, data: { message_id: 'temp-msg-1' } });
  });

  it('private + parent.group 调用 send_temp_msg', async () => {
    const id = await endpoint.$sendMessage({
      context: 'icqq',
      endpoint: '10001',
      type: 'private',
      id: '99999',
      parent: { type: 'group', id: '88888' },
      content: [{ type: 'text', data: { text: '你好' } }],
    });
    expect(id).toBe('temp-msg-1');
    expect(request).toHaveBeenCalledWith(
      Actions.SEND_TEMP_MSG,
      expect.objectContaining({
        group_id: 88888,
        user_id: 99999,
        message: expect.any(String),
      }),
    );
  });

  it('无 parent 的 private 仍走 send_private_msg', async () => {
    await endpoint.$sendMessage({
      context: 'icqq',
      endpoint: '10001',
      type: 'private',
      id: '99999',
      content: 'hi',
    });
    expect(request).toHaveBeenCalledWith(
      Actions.SEND_PRIVATE_MSG,
      expect.objectContaining({ user_id: 99999 }),
    );
  });
});
