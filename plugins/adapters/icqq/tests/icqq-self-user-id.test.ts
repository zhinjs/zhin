import { endpointRuntimeOf } from 'zhin.js/adapter';
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
    endpoint.emit('system.online');
    expect(endpoint.selfUserId).toBe('10001');
    expect(getProcessPeerRegistry().lookup('test-endpoint', '10001')).toBeDefined();
    retireEndpoint(endpoint);
    await endpoint.stop();
    expect(getProcessPeerRegistry().isReady('test-endpoint')).toBe(false);
  });

  it('does not report when the client uin is 0', async () => {
    const endpoint = createEndpoint('10001');
    (endpoint as unknown as { uin: number }).uin = 0;
    await endpoint.start(new AbortController().signal);
    endpoint.open();
    endpoint.emit('system.online');
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
    endpoint.emit('system.online');
    await stopping;
    expect(getProcessPeerRegistry().isReady('test-endpoint')).toBe(false);
  });

  it('still goes online and cancels login assist when reporting throws', async () => {
    const gateway = { receive: vi.fn(async () => undefined), send: vi.fn(async () => 'sent') };
    const ports = createIcqqTestPorts();
    const cancelOwned = vi.spyOn(ports.loginAssist, 'cancelOwned');
    const endpoint = bindTestEndpoint(new IcqqEndpoint({
      id: capabilityId(rootPluginId(), featureId('zhin.adapter'), 'icqq'),
      gateway,
      config: resolveIcqqConfig({ id: '10001', autoReconnect: false }),
      ...ports,
    }), gateway, undefined);
    const report = vi.spyOn(endpointRuntimeOf(endpoint) as unknown as { reportSelfUserId: () => void }, 'reportSelfUserId')
      .mockImplementation(() => { throw new Error('registry down'); });
    const starting = endpoint.start(new AbortController().signal);
    await vi.waitFor(() => expect(report).toHaveBeenCalled());
    endpoint.emit('system.online');
    await expect(starting).resolves.toBeUndefined();
    expect(cancelOwned).toHaveBeenCalledWith(expect.anything(), 'online');
    expect(endpoint.selfUserId).toBeUndefined();
    retireEndpoint(endpoint);
    await endpoint.stop();
  });
});
