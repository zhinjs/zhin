import { describe, expect, it, vi } from 'vitest';
import { createToken } from '../src/token.js';
import { outboundHostToken, type OutboundHost, type OutboundSendInput } from '../src/outbound-host.js';
import { createOutboundSender, sendTo } from '../src/outbound-sender.js';

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
