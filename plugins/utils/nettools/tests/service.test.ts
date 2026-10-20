import { describe, expect, it, vi } from 'vitest';
import { parseCommandDefinition } from 'zhin.js/command';
import plugin from '../plugin.ts';
import pingCommand from '../commands/ping/[host]/index.ts';
import whoisCommand from '../commands/whois/[domain]/index.ts';
import dnsCommand from '../commands/dns/[name]/[[type]]/index.ts';
import priceCommand from '../commands/domain-price/[suffix]/[[order]]/index.ts';
import pingTool from '../skills/nettools/tools/net_ping/index.ts';
import dnsTool from '../skills/nettools/tools/dns_lookup/index.ts';
import whoisTool from '../skills/nettools/tools/whois_lookup/index.ts';
import priceTool from '../skills/nettools/tools/domain_price/index.ts';
import { resolveNettoolsConfig } from '../src/config.js';
import { commandCallerKey, toolCallerKey, UserCooldown } from '../src/cooldown.js';
import { DohResolver } from '../src/dns.js';
import { NettoolsError } from '../src/errors.js';
import { nettoolsServiceToken } from '../src/runtime.js';
import { NettoolsService } from '../src/service.js';
import { assertPublicTarget } from '../src/target-guard.js';
import { createClient, createFakeNetwork, doh, json } from './helpers.js';

function createService(network = createFakeNetwork(), cooldownSeconds = 10): NettoolsService {
  return new NettoolsService({
    config: { cooldownSeconds, maxRetries: 0, dohProviders: ['cloudflare'] },
    dependencies: network.dependencies,
  });
}

describe('plugin wiring', () => {
  it('defines the nettools plugin, commands and agent tools', () => {
    expect(plugin.name).toBe('nettools');
    for (const command of [pingCommand, whoisCommand, dnsCommand, priceCommand]) {
      expect(parseCommandDefinition(command)).toBe(command);
    }
    for (const tool of [pingTool, dnsTool, whoisTool, priceTool]) {
      expect(typeof tool.execute).toBe('function');
      expect(tool.description.length).toBeGreaterThan(10);
    }
  });

  it('routes commands and tools through the owner-scoped service', async () => {
    const service = { run: vi.fn(async () => 'ok'), dns: vi.fn(async () => 'ok') } as unknown as NettoolsService;
    const use = vi.fn((token: unknown) => {
      expect(token).toBe(nettoolsServiceToken);
      return service;
    });
    await dnsCommand.execute({ params: { name: 'example.com', type: 'MX' }, use, input: undefined } as never);
    await dnsTool.execute({ name: 'example.com', type: 'MX' }, { use, principal: { subjectId: 'u1' } } as never);
    expect(use).toHaveBeenCalledTimes(2);
    expect(service.run).toHaveBeenCalledTimes(2);
  });
});

describe('config', () => {
  it('applies conservative defaults and clamps out-of-range values', () => {
    expect(resolveNettoolsConfig(undefined)).toMatchObject({
      cooldownMs: 10_000,
      requestTimeoutMs: 8_000,
      maxRetries: 2,
      pingMaxNodes: 4,
      pingMaxPolls: 5,
      dohProviders: ['cloudflare', 'alidns', 'google'],
      priceListLimit: 8,
    });
    expect(
      resolveNettoolsConfig({
        cooldownSeconds: -5,
        requestTimeoutMs: 999_999,
        maxRetries: 99,
        dohProviders: ['bogus' as never, 'google', 'google'],
      }),
    ).toMatchObject({ cooldownMs: 0, requestTimeoutMs: 30_000, maxRetries: 5, dohProviders: ['google'] });
  });
});

describe('UserCooldown', () => {
  it('blocks a caller until the cooldown expires, independently per caller', () => {
    const clock = { now: 0 };
    const cooldown = new UserCooldown(10_000, () => clock.now);
    cooldown.take('alice');
    expect(() => cooldown.take('alice')).toThrowError(/10 秒后再试/u);
    cooldown.take('bob');
    clock.now = 9_999;
    expect(() => cooldown.take('alice')).toThrowError(NettoolsError);
    clock.now = 10_000;
    expect(() => cooldown.take('alice')).not.toThrow();
  });

  it('is disabled at 0 and bounded in size', () => {
    const disabled = new UserCooldown(0);
    disabled.take('a');
    expect(() => disabled.take('a')).not.toThrow();
    const clock = { now: 0 };
    const bounded = new UserCooldown(1_000, () => clock.now, 2);
    bounded.take('a');
    bounded.take('b');
    bounded.take('c');
    expect(bounded.remainingMs('a')).toBe(0);
    expect(bounded.remainingMs('c')).toBe(1_000);
  });

  it('derives caller keys from the sender (commands) and principal (tools)', () => {
    expect(commandCallerKey({ sender: { id: 42 }, metadata: { endpointId: 'qq' } })).toBe('im:qq:42');
    expect(commandCallerKey({ sender: { id: 42 }, conversation: { endpoint: { id: 'tg' } } })).toBe('im:tg:42');
    expect(commandCallerKey(undefined)).toBe('anonymous');
    expect(toolCallerKey({ principal: { subjectId: 'user:1' } })).toBe('principal:user:1');
    expect(toolCallerKey(undefined)).toBe('anonymous');
  });
});

describe('assertPublicTarget', () => {
  it('refuses hostnames that resolve to private or metadata addresses', async () => {
    const network = createFakeNetwork();
    network.route('cloudflare-dns.com/', (url) => {
      const type = url.searchParams.get('type');
      return type === 'A'
        ? json(doh([{ name: 'evil.example.com.', type: 1, data: '93.184.216.34' }]))
        : json(doh([{ name: 'evil.example.com.', type: 28, data: 'fd00:ec2::254' }]));
    });
    const resolver = new DohResolver(createClient(network), ['cloudflare']);
    await expect(assertPublicTarget('evil.example.com', resolver)).rejects.toMatchObject({
      kind: 'blocked_target',
      message: expect.stringContaining('fd00:ec2::254'),
    });
  });

  it('fails closed when a name does not resolve', async () => {
    const network = createFakeNetwork();
    network.route('cloudflare-dns.com/', () => json({ Status: 3 }));
    const resolver = new DohResolver(createClient(network), ['cloudflare']);
    await expect(assertPublicTarget('nx.example.com', resolver)).rejects.toMatchObject({ kind: 'not_found' });
  });

  it('accepts public names and literal IPs without resolving literals', async () => {
    const network = createFakeNetwork();
    network.route('cloudflare-dns.com/', () => json(doh([{ name: 'example.com.', type: 1, data: '93.184.216.34' }])));
    const resolver = new DohResolver(createClient(network), ['cloudflare']);
    const target = await assertPublicTarget('example.com', resolver);
    expect(target.resolvedAddresses).toContain('93.184.216.34');
    const callsBefore = network.calls.length;
    await assertPublicTarget('8.8.8.8', resolver);
    expect(network.calls).toHaveLength(callsBefore);
  });
});

describe('NettoolsService', () => {
  it('refuses blocked targets before spending cooldown or touching the network', async () => {
    const network = createFakeNetwork();
    const service = createService(network);
    for (const target of ['127.0.0.1', '0x7f.1', '[::ffff:169.254.169.254]', 'metadata.google.internal', '10.0.0.1']) {
      const text = await service.run(() => service.ping(target, 'alice'));
      expect(text).toContain('拒绝');
    }
    expect(network.calls).toHaveLength(0);
    network.route('cloudflare-dns.com/', () => json({ Status: 3 }));
    const afterBlocked = await service.run(() => service.dns('example.com', 'A', 'alice'));
    expect(afterBlocked).toContain('NXDOMAIN');
  });

  it('applies the per-user cooldown across all tools', async () => {
    const network = createFakeNetwork();
    network.route('cloudflare-dns.com/', () => json(doh([])));
    const service = createService(network);
    await service.dns('example.com', 'A', 'alice');
    const second = await service.run(() => service.whois('example.com', 'alice'));
    expect(second).toContain('操作太频繁');
    const otherUser = await service.run(() => service.dns('example.com', 'MX', 'bob'));
    expect(otherUser).toContain('没有 MX 记录');
  });

  it('does not spend cooldown on invalid input', async () => {
    const network = createFakeNetwork();
    network.route('cloudflare-dns.com/', () => json(doh([])));
    const service = createService(network);
    expect(await service.run(() => service.dns('not a host', 'A', 'alice'))).toContain('只接受裸主机名');
    expect(await service.run(() => service.dns('example.com', 'ANY', 'alice'))).toContain('不支持的记录类型');
    expect(await service.run(() => service.dns('example.com', 'A', 'alice'))).toContain('example.com');
  });

  it('does PTR lookups for IPs and refuses other record types on IPs', async () => {
    const network = createFakeNetwork();
    network.route('cloudflare-dns.com/', () => json(doh([{ name: '8.8.8.8.in-addr.arpa.', type: 12, data: 'dns.google.' }])));
    const service = createService(network, 0);
    expect(await service.run(() => service.dns('8.8.8.8', 'A', 'alice'))).toContain('PTR');
    const text = await service.dns('8.8.8.8', 'ptr', 'alice');
    expect(text).toContain('dns.google.');
    expect(network.calls[0]?.searchParams.get('name')).toBe('8.8.8.8.in-addr.arpa');
    expect(await service.run(() => service.dns('192.168.1.1', 'PTR', 'alice'))).toContain('拒绝');
  });

  it('turns upstream failures into a friendly message', async () => {
    const service = createService(createFakeNetwork());
    const text = await service.run(() => service.domainPrice('com', undefined, 'alice'));
    expect(text).toContain('无法连接 nazhumi.com');
  });

  it('runs a full ping through DoH pre-check and check-host polling', async () => {
    const network = createFakeNetwork();
    network.route('cloudflare-dns.com/', (url) =>
      url.searchParams.get('type') === 'A' ? json(doh([{ name: 'example.com.', type: 1, data: '93.184.216.34' }])) : json(doh([])),
    );
    network.route('check-host.net/check-ping', () =>
      json({ request_id: 'r1', nodes: { 'n1.node.check-host.net': ['sg', 'Singapore', 'Singapore'] } }),
    );
    network.route('check-host.net/check-result/r1', () => json({ 'n1.node.check-host.net': [[['OK', 0.005, '93.184.216.34']]] }));
    const service = createService(network);
    const text = await service.ping('example.com', 'alice');
    expect(text).toContain('SG Singapore：平均 5.0ms');
  });
});
