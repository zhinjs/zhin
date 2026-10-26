import dnsCommand from '../commands/dns/[name]/[[type]]/index.ts';
import dnsTool from '../skills/nettools/tools/dns_lookup/index.ts';
import { NettoolsService } from '../src/service.js';
import { describeFailure, NettoolsError } from '../src/errors.js';
import { parseHostInput, classifyParsedHost } from '../src/address-policy.js';
import { formatMessage } from '../src/messages.js';
import { formatWhoisRecord, parseRdapDomain } from '../src/whois.js';
import { formatPriceComparison } from '../src/domain-price.js';
import { formatPingReport } from '../src/ping.js';
import { createFakeNetwork, doh, json } from './helpers.js';

it('localizes nested private-target explanations before any network request or cooldown', async () => {
  const network = createFakeNetwork();
  const service = new NettoolsService({ dependencies: network.dependencies });
  for (const target of ['127.0.0.1', '::ffff:169.254.169.254', '10.0.0.1', 'metadata.google.internal', 'fe80::1']) {
    const en = await service.run(() => service.ping(target, 'alice'), 'en');
    const zh = await service.run(() => service.ping(target, 'alice'), 'zh-CN');
    expect(en).toContain('Refused to probe');
    expect(en).not.toMatch(/[\u4e00-\u9fff]/);
    expect(zh).toContain('拒绝探测');
    const verdict = classifyParsedHost(parseHostInput(target));
    expect(verdict.blocked).toBe(true);
    if (verdict.blocked) expect(formatMessage(verdict.detail, 'en')).not.toMatch(/[\u4e00-\u9fff]/);
  }
  expect(network.calls).toHaveLength(0);
});

it('passes the command and tool language through one shared service without changing provider data', async () => {
  const network = createFakeNetwork();
  network.route('cloudflare-dns.com/', () => json(doh([{ name: 'example.com', type: 1, data: '8.8.8.8' }])));
  const service = new NettoolsService({ dependencies: network.dependencies, config: { cooldownSeconds: 0, dohProviders: ['cloudflare'] } });
  const use = () => service;
  const en = await dnsCommand.execute({ params: { name: 'example.com' }, use, locale: 'en' } as never);
  const zh = await dnsTool.execute({ name: 'example.com' }, { use, locale: 'zh-CN' } as never);
  expect(en).toContain('A records');
  expect(zh).toContain('A 记录');
  expect(en).toContain('8.8.8.8');
  expect(zh).toContain('8.8.8.8');
  expect(network.calls).toHaveLength(2);
});

it('preserves source error kinds and parameters through input, fallback and cancellation failures', async () => {
  const network = createFakeNetwork();
  const service = new NettoolsService({ dependencies: network.dependencies, config: { maxRetries: 0, cooldownSeconds: 0 } });
  expect(await service.run(() => service.dns('example.com', 'INVALID', 'a'), 'en')).toContain('Unsupported record type INVALID');
  const error = await service.dns('example.com', 'A', 'a').catch(value => value);
  expect(error).toBeInstanceOf(NettoolsError);
  expect(error.kind).toBe('network');
  expect(error.detail.key).toBe('dnsUnavailable');
  expect(describeFailure(error, 'en')).toContain('All DNS services are unavailable');
  expect(describeFailure(error, 'en')).not.toMatch(/[\u4e00-\u9fff]/);
  expect(describeFailure(error, 'zh-CN')).toContain('所有 DNS 服务均不可用');
  const controller = new AbortController(); controller.abort();
  const aborted = await service.dns('example.com', 'A', 'a', controller.signal).catch(value => value);
  expect(aborted.kind).toBe('aborted');
  expect(describeFailure(aborted, 'en')).toContain('cancelled');
});

it('renders English WHOIS, price and ping output with unchanged structured results', () => {
  const record = parseRdapDomain({ objectClassName: 'domain', ldhName: 'example.com', secureDNS: { delegationSigned: true }, events: [{ eventAction: 'registration', eventDate: '2020-01-02T00:00:00Z' }] }, 'example.com', 'test');
  const original = structuredClone(record);
  expect(formatWhoisRecord(record, 'en')).toContain('Registered: 2020-01-02 (UTC)');
  expect(formatWhoisRecord(record, 'en')).toContain('DNSSEC: Enabled');
  expect(record).toEqual(original);
  expect(formatPriceComparison({ suffix: 'com', kind: 'register', entries: [], updatedAt: undefined }, 8, 'en')).toBe('💰 No registration prices for .com');
  expect(formatPingReport({ host: 'example.com', nodes: [], permanentLink: 'https://example.com/report' }, 'en')).toContain('multi-region ping');
});
