import { describe, expect, it, vi } from 'vitest';
import { PluginOutboundHost, childPluginId, rootPluginId } from '@zhin.js/plugin-runtime';
import {
  createOutboundHost,
  type OutboundRuntimePort,
} from '../../src/plugin-runtime/outbound-host-installer.js';

function createRuntime(
  endpoints: Partial<OutboundRuntimePort['endpoints']>,
): OutboundRuntimePort {
  return {
    endpoints: {
      capabilities: () => undefined,
      send: async () => ({ messageId: '' }),
      sendTarget: async () => ({ messageId: '' }),
      addReaction: async () => null,
      removeReaction: async () => undefined,
      recall: async () => undefined,
      edit: async () => null,
      typing: async () => undefined,
      ...endpoints,
    },
    runWithSnapshotView: (operation) => operation(),
  };
}

describe('OutboundHost', () => {
  it('delegates durable targets directly without resolving aliases or replacing delivery failures', async () => {
    const sendTarget = vi.fn().mockResolvedValue({ messageId: 'exact-message' });
    const send = vi.fn();
    const owner = childPluginId(rootPluginId(), 'reminder');
    const host = new PluginOutboundHost(owner, createOutboundHost(createRuntime({ sendTarget, send })));
    const target = { endpoint: { adapter: 'root/icqq', id: 'exact-endpoint' }, kind: 'channel' as const,
      id: 'room', parent: { kind: 'channel' as const, id: 'guild' }, threadId: 'thread' };
    const content = [{ type: 'image', data: { src: 'https://example.org/image.png' } }];
    expect(await host.sendTarget!(JSON.parse(JSON.stringify(target)), content)).toBe('exact-message');
    expect(sendTarget).toHaveBeenCalledWith(target, content, owner);
    expect(send).not.toHaveBeenCalled();
    const failure = Object.assign(new Error('delivery unknown'), { disposition: 'unknown' });
    sendTarget.mockRejectedValueOnce(failure);
    await expect(host.sendTarget!(target, 'reminder')).rejects.toBe(failure);
  });
  it('delegates to the Endpoint runtime', async () => {
    const sendEndpointMessage = vi.fn().mockResolvedValue({ messageId: 'm1' });
    const host = createOutboundHost(createRuntime({ send: sendEndpointMessage }));
    await host.send({
      adapter: 'sandbox',
      endpointKey: 'bot',
      conversation: { kind: 'private', id: 'u1' },
      content: 'hello',
    });
    expect(sendEndpointMessage).toHaveBeenCalledWith({
      adapter: 'sandbox',
      endpointKey: 'bot',
      conversation: { kind: 'private', id: 'u1' },
      content: 'hello',
    });
  });

  it('preserves captured locale without changing the owner argument of exact-target sends', async () => {
    const sendTarget = vi.fn().mockResolvedValue({ messageId: 'localized' });
    const owner = childPluginId(rootPluginId(), 'reminder');
    const host = new PluginOutboundHost(owner, createOutboundHost(createRuntime({ sendTarget })));
    const target = { endpoint: { adapter: 'root/icqq', id: 'exact-endpoint' }, kind: 'private' as const, id: 'user' };
    await host.sendTarget!(target, '原文', { locale: 'en' });
    expect(sendTarget).toHaveBeenCalledExactlyOnceWith(target, '原文', owner, { locale: 'en' });
  });

  it('swallows reaction failures so activity-feedback cannot block outbound send', async () => {
    const host = createOutboundHost(createRuntime({
      addReaction: vi.fn().mockRejectedValue(new Error('packet timeout')),
      removeReaction: vi.fn().mockRejectedValue(new Error('packet timeout')),
    }));
    const message = {
      conversation: {
        endpoint: { id: 'icqq', adapter: 'icqq' },
        kind: 'group' as const,
        id: '100',
      },
      id: '42',
    };
    await expect(host.addReaction?.({
      adapter: 'icqq',
      endpointKey: 'bot',
      message,
      emoji: '104',
    })).resolves.toBeNull();
    await expect(host.removeReaction?.({
      adapter: 'icqq',
      endpointKey: 'bot',
      message,
      reactionId: '104',
    })).resolves.toBeUndefined();
  });

  it('rejects business delivery failures instead of reporting a missing message id', async () => {
    const error = new Error('endpoint not found');
    const send = vi.fn().mockRejectedValue(error);
    const host = createOutboundHost(createRuntime({ send }));
    await expect(host.send({
      adapter: 'sandbox', endpointKey: 'missing',
      conversation: { kind: 'private', id: 'u1' }, content: 'reminder',
    })).rejects.toBe(error);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('returns null only for a completed send without a platform message id', async () => {
    const send = vi.fn().mockResolvedValue({ messageId: '' });
    const host = createOutboundHost(createRuntime({ send }));
    await expect(host.send({
      adapter: 'sandbox', endpointKey: 'bot',
      conversation: { kind: 'private', id: 'u1' }, content: 'reminder',
    })).resolves.toBeNull();
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('projects endpoint capabilities and delegates edit/typing controls', async () => {
    const message = {
      conversation: {
        endpoint: { id: 'bot', adapter: 'discord' },
        kind: 'channel' as const,
        id: 'channel-1',
      },
      id: 'message-1',
    };
    const endpointCapabilities = vi.fn().mockReturnValue({
      inbound: true,
      outbound: true,
      operations: { edit: true, typing: true },
    });
    const editEndpointMessage = vi.fn().mockResolvedValue('message-1');
    const setEndpointTyping = vi.fn().mockResolvedValue(undefined);
    const host = createOutboundHost(createRuntime({
      capabilities: endpointCapabilities,
      edit: editEndpointMessage,
      typing: setEndpointTyping,
    }));

    expect(host.capabilities?.({ adapter: 'discord', endpointKey: 'bot' })).toEqual({
      operations: ['edit', 'typing'],
    });
    await expect(host.edit?.({
      message,
      content: 'working',
    })).resolves.toBe('message-1');
    await expect(host.typing?.({
      conversation: message.conversation,
      active: true,
    })).resolves.toBeUndefined();

    expect(editEndpointMessage).toHaveBeenCalledWith({
      message, content: 'working',
    });
    expect(setEndpointTyping).toHaveBeenCalledWith({
      conversation: message.conversation, active: true,
    });
  });
});
