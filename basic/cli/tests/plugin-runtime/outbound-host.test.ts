import { describe, expect, it, vi } from 'vitest';
import { createOutboundHost } from '../../src/plugin-runtime/outbound-host-installer.js';
import type { ImRuntime } from '@zhin.js/core/runtime';

describe('OutboundHost', () => {
  it('delegates to ImRuntime.sendEndpointMessage', async () => {
    const sendEndpointMessage = vi.fn().mockResolvedValue({ messageId: 'm1' });
    const host = createOutboundHost({ sendEndpointMessage } as unknown as ImRuntime);
    await host.send({
      adapter: 'sandbox',
      endpointId: 'bot',
      channelType: 'private',
      channelId: 'u1',
      content: 'hello',
    });
    expect(sendEndpointMessage).toHaveBeenCalledWith({
      adapter: 'sandbox',
      endpointId: 'bot',
      channelType: 'private',
      channelId: 'u1',
      content: 'hello',
    });
  });
});
