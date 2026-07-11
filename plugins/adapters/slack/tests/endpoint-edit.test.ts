import { describe, expect, it, vi, beforeEach } from 'vitest';
import { SlackEndpoint } from '../src/endpoint.js';
import { SlackAdapter } from '../src/adapter.js';

function createEndpoint(): SlackEndpoint {
  const plugin = { logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } } as any;
  const adapter = new SlackAdapter(plugin);
  const endpoint = new SlackEndpoint(adapter, {
    context: 'slack',
    name: 'test-ep',
    token: 'xoxb-test',
    signingSecret: 'secret',
    socketMode: true,
    appToken: 'xapp-test',
  });
  endpoint.client = {
    chat: { update: vi.fn().mockResolvedValue({ ok: true }) },
  } as any;
  return endpoint;
}

describe('SlackEndpoint.$editMessage', () => {
  let endpoint: SlackEndpoint;

  beforeEach(() => {
    endpoint = createEndpoint();
  });

  it('parses channel:ts messageId', async () => {
    await endpoint.$editMessage({
      messageId: 'C001:1700000000.000000',
      context: 'slack',
      endpoint: 'test-ep',
      id: 'C001',
      type: 'group',
      content: [{ type: 'text', data: { text: 'updated' } }],
    });

    expect(endpoint.client!.chat.update).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: 'C001',
        ts: '1700000000.000000',
      }),
    );
  });

  it('falls back to options.id when messageId is plain ts', async () => {
    await endpoint.$editMessage({
      messageId: '1700000000.000000',
      context: 'slack',
      endpoint: 'test-ep',
      id: 'C001',
      type: 'group',
      content: 'plain update',
    });

    expect(endpoint.client!.chat.update).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: 'C001',
        ts: '1700000000.000000',
      }),
    );
  });
});
