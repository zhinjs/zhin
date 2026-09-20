import { describe, expect, it, vi } from 'vitest';
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
      adapter: 'discord',
      endpointKey: 'bot',
      message,
      content: 'working',
    })).resolves.toBe('message-1');
    await expect(host.typing?.({
      adapter: 'discord',
      endpointKey: 'bot',
      conversation: message.conversation,
      active: true,
    })).resolves.toBeUndefined();

    expect(editEndpointMessage).toHaveBeenCalledWith({
      adapter: 'discord', endpointKey: 'bot', message, content: 'working',
    });
    expect(setEndpointTyping).toHaveBeenCalledWith({
      adapter: 'discord', endpointKey: 'bot', conversation: message.conversation, active: true,
    });
  });
});
