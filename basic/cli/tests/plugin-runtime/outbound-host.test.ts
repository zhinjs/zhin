import { describe, expect, it, vi } from 'vitest';
import { createOutboundHost } from '../../src/plugin-runtime/outbound-host-installer.js';
import type { ImRuntime } from '@zhin.js/core/runtime';

describe('OutboundHost', () => {
  it('delegates to ImRuntime.sendEndpointMessage', async () => {
    const sendEndpointMessage = vi.fn().mockResolvedValue({ messageId: 'm1' });
    const host = createOutboundHost({ sendEndpointMessage } as unknown as ImRuntime);
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
    const host = createOutboundHost({
      addEndpointReaction: vi.fn().mockRejectedValue(new Error('packet timeout')),
      removeEndpointReaction: vi.fn().mockRejectedValue(new Error('packet timeout')),
    } as unknown as ImRuntime);
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
});
