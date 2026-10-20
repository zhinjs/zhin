import { describe, expect, it, vi } from 'vitest';
import type { ToolInvocationPolicy } from '@zhin.js/tool';
import {
  NodeNetworkTransport,
  TurnNetworkClient,
  type NetworkTransport,
} from '../../src/security/turn-network-client.js';
import { isBlockedIpAddress } from '../../src/security/network-policy.js';

describe('TurnNetworkClient', () => {
  it('classifies non-public DNS addresses fail-closed', () => {
    for (const address of [
      '0.0.0.0', '100.64.0.1', '169.254.1.1', '198.18.0.1', '224.0.0.1',
      '::1', 'fc00::1', 'fe80::1', 'ff02::1', '::ffff:127.0.0.1',
    ]) expect(isBlockedIpAddress(address), address).toBe(true);
    expect(isBlockedIpAddress('93.184.216.34')).toBe(false);
    expect(isBlockedIpAddress('2606:2800:220:1:248:1893:25c8:1946')).toBe(false);
  });

  it('rejects a private resolved address before opening a socket', async () => {
    await expect(new NodeNetworkTransport().request(
      new URL('http://localhost/resource'),
      {},
      new AbortController().signal,
      1024,
    )).rejects.toMatchObject({ name: 'NetworkAccessDeniedError' });
  });

  it('authorizes every redirect hop before transport execution', async () => {
    const request = vi.fn<NetworkTransport['request']>().mockResolvedValue({
      status: 302,
      statusText: 'Found',
      headers: { location: 'https://blocked.example/private' },
      body: '',
    });
    const client = new TurnNetworkClient(policy(['allowed.example']), new AbortController().signal, { request });

    await expect(client.getText('https://allowed.example/start')).rejects.toMatchObject({
      name: 'NetworkAccessDeniedError',
      policy: 'network-access',
    });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('fails closed before transport without explicit network authority', async () => {
    const request = vi.fn<NetworkTransport['request']>();
    const client = new TurnNetworkClient({
      permissions: [], unattended: false, network: { enabled: false },
    }, new AbortController().signal, { request });

    await expect(client.getText('https://example.com')).rejects.toThrow('no network authority');
    expect(request).not.toHaveBeenCalled();
  });
});

function policy(allowedDomains: readonly string[]): ToolInvocationPolicy {
  return {
    permissions: ['master'],
    unattended: false,
    network: { enabled: true, httpsOnly: true, allowedDomains },
  };
}
