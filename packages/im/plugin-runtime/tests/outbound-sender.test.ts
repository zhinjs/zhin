import { describe, expect, it, vi } from 'vitest';
import { createToken } from '../src/token.js';
import { outboundHostToken, type OutboundHost, type OutboundSendInput } from '../src/outbound-host.js';
import { createOutboundSender, sendTo, tempSession, guildChannel } from '../src/outbound-sender.js';

function stubHost(): OutboundHost & { calls: OutboundSendInput[] } {
  const calls: OutboundSendInput[] = [];
  return {
    calls,
    send: vi.fn(async (input: OutboundSendInput) => {
      calls.push(input);
      return 'msg-1';
    }),
  };
}

function makeUse(host: OutboundHost) {
  return <T>(token: { id: string }): T => {
    if (token.id === outboundHostToken.id) return host as unknown as T;
    throw new Error(`Unknown token: ${String(token.id)}`);
  };
}

describe('createOutboundSender', () => {
  it('send(kind, id, content) 三参数形式', async () => {
    const host = stubHost();
    const sender = createOutboundSender(makeUse(host), 'root/icqq', 'main');

    const result = await sender.send('group', '67890', 'hello');

    expect(result).toBe('msg-1');
    expect(host.calls).toHaveLength(1);
    expect(host.calls[0]).toEqual({
      adapter: 'root/icqq',
      endpointId: 'main',
      conversation: { kind: 'group', id: '67890' },
      content: 'hello',
    });
  });

  it('send(conversation, content) 对象形式', async () => {
    const host = stubHost();
    const sender = createOutboundSender(makeUse(host), 'root/telegram', 'bot1');

    await sender.send({ kind: 'private', id: '12345', threadId: 't1' }, 'DM');

    expect(host.calls[0]).toEqual({
      adapter: 'root/telegram',
      endpointId: 'bot1',
      conversation: { kind: 'private', id: '12345', threadId: 't1' },
      content: 'DM',
    });
  });

  it('exposes adapter, endpointId, host', () => {
    const host = stubHost();
    const sender = createOutboundSender(makeUse(host), 'root/qq', 'ep1');

    expect(sender.adapter).toBe('root/qq');
    expect(sender.endpointId).toBe('ep1');
    expect(sender.host).toBe(host);
  });

  it('is frozen', () => {
    const host = stubHost();
    const sender = createOutboundSender(makeUse(host), 'a', 'b');
    expect(Object.isFrozen(sender)).toBe(true);
  });
});

describe('sendTo', () => {
  it('resolves host and sends one-shot', async () => {
    const host = stubHost();
    const result = await sendTo(makeUse(host), {
      adapter: 'root/icqq',
      endpointId: 'main',
      conversation: { kind: 'group', id: '99999' },
    }, 'broadcast');

    expect(result).toBe('msg-1');
    expect(host.calls[0]).toEqual({
      adapter: 'root/icqq',
      endpointId: 'main',
      conversation: { kind: 'group', id: '99999' },
      content: 'broadcast',
    });
  });
});

describe('tempSession', () => {
  it('构造群临时会话地址', () => {
    const conv = tempSession('12345', '67890');
    expect(conv).toEqual({
      kind: 'private',
      id: '12345',
      parent: { kind: 'group', id: '67890' },
    });
  });

  it('可直接用于 sender.send', async () => {
    const host = stubHost();
    const sender = createOutboundSender(makeUse(host), 'root/icqq', 'main');
    await sender.send(tempSession('u1', 'g1'), '临时私信');
    expect(host.calls[0]!.conversation).toEqual({
      kind: 'private',
      id: 'u1',
      parent: { kind: 'group', id: 'g1' },
    });
  });
});

describe('guildChannel', () => {
  it('构造频道子通道地址', () => {
    const conv = guildChannel('ch-1', 'guild-1');
    expect(conv).toEqual({
      kind: 'channel',
      id: 'ch-1',
      parent: { kind: 'channel', id: 'guild-1' },
    });
  });

  it('支持 threadId', () => {
    const conv = guildChannel('ch-1', 'guild-1', 'thread-42');
    expect(conv).toEqual({
      kind: 'channel',
      id: 'ch-1',
      parent: { kind: 'channel', id: 'guild-1' },
      threadId: 'thread-42',
    });
  });

  it('无 threadId 时不含 threadId 字段', () => {
    const conv = guildChannel('ch-1', 'guild-1');
    expect('threadId' in conv).toBe(false);
  });
});
