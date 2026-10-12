import { createDeliveryTarget, normalizeDeliveryTarget } from '../src/delivery-target.js';

describe('durable delivery target', () => {
  it('retains exact bot, parent and thread without retaining the message or runtime', () => {
    const conversation = { endpoint: { adapter: 'root/adapter', id: 'endpoint\0main' }, kind: 'channel' as const,
      id: 'room', parent: { kind: 'channel' as const, id: 'guild' }, threadId: 'topic' };
    const message = { conversation, client: { send: () => undefined }, $reply: () => undefined };
    const target = createDeliveryTarget(message);
    expect(JSON.parse(JSON.stringify(target))).toEqual(conversation);
    expect(target).not.toBe(conversation);
    expect(target.endpoint).not.toBe(conversation.endpoint);
    conversation.endpoint.id = 'changed';
    expect(target.endpoint.id).toBe('endpoint\0main');
    expect(Object.keys(target)).not.toContain('client');
  });

  it('rejects malformed persisted targets without guessing a default endpoint', () => {
    expect(() => normalizeDeliveryTarget({ kind: 'group', id: 'room' })).toThrow('endpoint');
    expect(() => normalizeDeliveryTarget({ endpoint: { adapter: 'x', id: '' }, kind: 'group', id: 'room' })).toThrow('nonempty');
    expect(() => normalizeDeliveryTarget({ endpoint: { adapter: 'x', id: 'bot' }, kind: 'unknown', id: 'room' })).toThrow('kind');
  });
});
