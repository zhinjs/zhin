import { LineEndpoint } from '../src/endpoint.js';
import { resolveLineConfig, type LineEvent } from '../src/protocol.js';
import { bindTestEndpoint } from '../../test-utils/endpoint.js';
import type { HttpHost } from '@zhin.js/host-http';
import { capabilityId, rootPluginId, featureId } from 'zhin.js';

const event: LineEvent = { webhookEventId: 'fixture-event', type: 'message', replyToken: 'fixture-reply', timestamp: 1, source: { type: 'user', userId: 'Ufixture' }, message: { id: 'fixture-message', type: 'text', text: 'probe' } };
function fixture(receive = vi.fn(async () => {})) {
  const endpoint = bindTestEndpoint(new LineEndpoint({ id: capabilityId(rootPluginId(), featureId('zhin.adapter'), 'line'), http: {} as HttpHost, config: resolveLineConfig({ id: 'fixture', channelSecret: 'fixture', channelAccessToken: 'fixture' }) }), { receive });
  endpoint.open();
  return { endpoint, receive };
}
it('shares concurrent admission and suppresses successful redelivery without recaching consumed reply token', async () => {
  let release!: () => void;
  const receive = vi.fn(() => new Promise<void>(resolve => { release = resolve; }));
  const { endpoint } = fixture(receive);
  const first = endpoint.admitAccepted(event);
  const duplicate = endpoint.admitAccepted({ ...event, deliveryContext: { isRedelivery: true } });
  await vi.waitFor(() => expect(receive).toHaveBeenCalledTimes(1));
  release(); await Promise.all([first, duplicate]);
  await endpoint.admitAccepted(event);
  expect(receive).toHaveBeenCalledTimes(1);
  await endpoint.stop();
});
it('releases rejected admissions for retry and isolates instance retirement', async () => {
  const receive = vi.fn().mockRejectedValueOnce(new Error('retired')).mockResolvedValue(undefined);
  const { endpoint } = fixture(receive);
  await expect(endpoint.admitAccepted(event)).rejects.toThrow('retired');
  await endpoint.admitAccepted(event);
  expect(receive).toHaveBeenCalledTimes(2);
  await endpoint.stop(); endpoint.open();
  await endpoint.admitAccepted(event);
  expect(receive).toHaveBeenCalledTimes(3);
  await endpoint.stop();
});
it('expires completed entries and does not infer an ID for legacy events', async () => {
  vi.useFakeTimers();
  const { endpoint, receive } = fixture();
  try {
    await endpoint.admitAccepted(event);
    vi.advanceTimersByTime(24 * 60 * 60 * 1000);
    await endpoint.admitAccepted(event);
    const { webhookEventId: _id, ...legacy } = event;
    await endpoint.admitAccepted(legacy); await endpoint.admitAccepted(legacy);
    expect(receive).toHaveBeenCalledTimes(4);
  } finally { await endpoint.stop(); vi.useRealTimers(); }
});
