import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import type { Message, MessageBase } from '../src/index.js';
import type { Message as ZhinMessage } from 'zhin.js';
import { RuntimeMessage } from '../src/plugin-runtime/im/contracts.js';

describe('canonical Message contract', () => {
  it('exports the Runtime middleware shape from the core root', () => {
    expectTypeOf<RuntimeMessage>().toMatchTypeOf<Message>();
    expectTypeOf<Message>().toMatchTypeOf<MessageBase>();
    expectTypeOf<ZhinMessage>().toEqualTypeOf<Message>();
    expectTypeOf<Message<{ traceId: string }>['traceId']>().toEqualTypeOf<string>();
  });

  it('contains the fields delivered to inbound middleware', async () => {
    const reply = vi.fn(async () => ({ status: 'sent' as const }));
    const message: Message = new RuntimeMessage(
      {
        endpoint: { id: 'root/icqq\0zhin.adapter\0icqq~8596238', adapter: 'root/icqq' },
        kind: 'private',
        id: '1659488338',
      },
      'kfc',
      4,
      reply,
      { id: '1659488338', name: '归雨', roles: ['master'] },
      { channelType: 'private', nickname: '归雨' },
      [{ type: 'text', data: { text: 'kfc' } }],
      {
        conversation: {
          endpoint: { id: 'root/icqq\0zhin.adapter\0icqq~8596238', adapter: 'root/icqq' },
          kind: 'private',
          id: '1659488338',
        },
        id: 'native-message-id',
      },
      '8596238',
      undefined,
      undefined,
      () => ({ uin: 8596238 }),
      'icqq',
    );

    expect(message).toMatchObject({
      content: 'kfc',
      generation: 4,
      endpointId: '8596238',
      clientAdapter: 'icqq',
      sender: { id: '1659488338', name: '归雨', roles: ['master'] },
      conversation: { kind: 'private', id: '1659488338' },
      message: { id: 'native-message-id' },
    });
    expect(message.id).toBe('native-message-id');
    await message.$reply('ok');
    expect(reply).toHaveBeenCalledWith('ok');
    expect('$id' in message).toBe(false);
    expect('$content' in message).toBe(false);
  });
});
