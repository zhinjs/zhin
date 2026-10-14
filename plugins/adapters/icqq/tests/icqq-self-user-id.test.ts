import { bindTestEndpoint } from '../../test-utils/endpoint.js';
import { describe, expect, it, vi } from 'vitest';
import { capabilityId, featureId, rootPluginId } from 'zhin.js';
import { getProcessPeerRegistry, retireEndpoint } from 'zhin.js/adapter';

vi.mock('@icqqjs/icqq', async () => import('./_icqq-mock.js'));

import { IcqqEndpoint } from '../src/endpoint.js';
import { resolveIcqqSelfUserId } from '../src/icqq-inbound.js';
import { resolveIcqqConfig } from '../src/protocol.js';
import { createIcqqTestPorts } from './_icqq-mock.js';

function createEndpoint(uin: string): IcqqEndpoint {
  const gateway = { receive: vi.fn(async () => undefined), send: vi.fn(async () => 'sent') };
  return bindTestEndpoint(new IcqqEndpoint({
    id: capabilityId(rootPluginId(), featureId('zhin.adapter'), 'icqq'),
    gateway,
    config: resolveIcqqConfig({ id: uin, autoReconnect: false }),
    ...createIcqqTestPorts(),
  }), gateway, undefined);
}

describe('resolveIcqqSelfUserId', () => {
  it('accepts only positive integer uins', () => {
    expect(resolveIcqqSelfUserId({ uin: 10001 })).toBe('10001');
    expect(resolveIcqqSelfUserId({ uin: '10001' })).toBe('10001');
    for (const uin of [0, -1, NaN, 1.5, '', 'abc', undefined, null as never]) {
      expect(resolveIcqqSelfUserId({ uin })).toBeUndefined();
    }
  });
});

describe('IcqqEndpoint selfUserId', () => {
  it('reports the logged-in uin on system.online and clears on retire', async () => {
    const endpoint = createEndpoint('10001');
    expect(endpoint.selfUserId).toBeUndefined();
    await endpoint.start(new AbortController().signal);
    endpoint.open();
    endpoint.client.emit('system.online');
    expect(endpoint.selfUserId).toBe('10001');
    expect(getProcessPeerRegistry().lookup('test-endpoint', '10001')).toBeDefined();
    retireEndpoint(endpoint);
    await endpoint.stop();
    expect(getProcessPeerRegistry().isReady('test-endpoint')).toBe(false);
  });

  it('does not report when the client uin is 0', async () => {
    const endpoint = createEndpoint('10001');
    (endpoint.client as unknown as { uin: number }).uin = 0;
    await endpoint.start(new AbortController().signal);
    endpoint.open();
    endpoint.client.emit('system.online');
    expect(endpoint.selfUserId).toBeUndefined();
    expect(getProcessPeerRegistry().isReady('test-endpoint')).toBe(false);
    retireEndpoint(endpoint);
    await endpoint.stop();
  });

  it('does not report while retiring', async () => {
    const endpoint = createEndpoint('10001');
    await endpoint.start(new AbortController().signal);
    endpoint.open();
    expect(getProcessPeerRegistry().isReady('test-endpoint')).toBe(true);
    retireEndpoint(endpoint);
    const stopping = endpoint.stop();
    endpoint.client.emit('system.online');
    await stopping;
    expect(getProcessPeerRegistry().isReady('test-endpoint')).toBe(false);
  });
});
