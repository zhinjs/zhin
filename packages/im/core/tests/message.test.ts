import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import { createSyntheticMessage, type Message, type MessageBase } from '../src/index.js';
import { RuntimeMessage } from '../src/plugin-runtime/im/contracts.js';

describe('canonical Message contract', () => {
  it('exports the Runtime middleware shape from the core root', () => {
    expectTypeOf<RuntimeMessage>().toMatchTypeOf<Message>();
    expectTypeOf<Message>().toMatchTypeOf<MessageBase>();
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

describe('synthetic Message contract', () => {
  const conversation = {
    endpoint: { id: 'bot1', adapter: 'test' },
    kind: 'private' as const,
    id: 'u1',
  };

  it('derives content from canonical segments', () => {
    const message = createSyntheticMessage({
      conversation,
      content: 'stale',
      segments: [{ type: 'text', data: { text: 'current' } }],
    });
    expect(message.content).toBe('current');
  });

  it('reports missing delivery ports instead of faking successful sends', async () => {
    const message = createSyntheticMessage({ conversation });
    await expect(message.$reply('hello')).resolves.toMatchObject({
      status: 'unsupported',
      failure: { code: 'synthetic_reply_unavailable' },
    });
    await expect(message.$sendTo({ kind: 'group', id: 'g1' }, 'hello')).resolves.toMatchObject({
      status: 'unsupported',
    });
  });

  it('uses only the explicitly supplied same-conversation reply port', async () => {
    const reply = vi.fn(async () => ({ status: 'sent' as const }));
    const message = createSyntheticMessage({ conversation, reply });
    await expect(message.$reply('hello')).resolves.toEqual({ status: 'sent' });
    expect(reply).toHaveBeenCalledWith('hello');
    await expect(message.$replyToGroup('g1', 'hello')).resolves.toMatchObject({
      status: 'unsupported',
    });
    expect(reply).toHaveBeenCalledOnce();
  });
});
