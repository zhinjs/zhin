import { describe, expect, it, vi } from 'vitest';
import type { OutboundHost } from '@zhin.js/plugin-runtime';
import {
  createAdapterOutageNotifier,
  resolveAdapterNotifyTarget,
} from '../src/index.js';

describe('adapter outage notify', () => {
  it('defaults to a private conversation and normalizes ids', () => {
    expect(resolveAdapterNotifyTarget({
      adapter: 'qq',
      endpoint: 'bot-1',
      id: 12345,
    })).toEqual({
      adapter: 'qq',
      endpoint: 'bot-1',
      kind: 'private',
      id: '12345',
    });
  });

  it('supports a parent channel/group', () => {
    expect(resolveAdapterNotifyTarget({
      adapter: 'qq',
      endpoint: 'bot-1',
      kind: 'channel',
      id: 'channel-1',
      parent: { kind: 'group', id: 100 },
    })).toMatchObject({
      kind: 'channel',
      parent: { kind: 'group', id: '100' },
    });
  });

  it('rejects incomplete or invalid targets', () => {
    expect(() => resolveAdapterNotifyTarget(null)).not.toThrow();
    expect(() => resolveAdapterNotifyTarget({ adapter: 'qq', endpoint: 'bot' })).toThrow(/id/u);
    expect(() => resolveAdapterNotifyTarget({ adapter: 'qq', endpoint: 'bot', id: '1', kind: 'guild' })).toThrow(/kind/u);
    expect(() => resolveAdapterNotifyTarget({ adapter: 'qq', endpoint: 'bot', id: '1', parent: { kind: 'group' } })).toThrow(/parent/u);
  });

  it('sends through OutboundHost and degrades to false on failure', async () => {
    const send = vi.fn(async () => 'sent');
    const outbound = { send } as unknown as OutboundHost;
    const target = resolveAdapterNotifyTarget({
      adapter: 'qq', endpoint: 'bot-1', id: 'master-openid',
    })!;
    const notifier = createAdapterOutageNotifier(outbound, target);
    expect(notifier.configured).toBe(true);
    await expect(notifier.send('ICQQ offline', { locale: 'zh-CN' })).resolves.toBe(true);
    expect(send).toHaveBeenCalledWith({
      adapter: 'qq',
      endpointKey: 'bot-1',
      conversation: { kind: 'private', id: 'master-openid' },
      content: 'ICQQ offline',
      locale: 'zh-CN',
    });

    send.mockRejectedValueOnce(new Error('offline'));
    await expect(notifier.send('again')).resolves.toBe(false);
  });

  it('is a no-op when outbound or target is missing', async () => {
    const notifier = createAdapterOutageNotifier(undefined, undefined);
    expect(notifier.configured).toBe(false);
    await expect(notifier.send('x')).resolves.toBe(false);
  });
});
