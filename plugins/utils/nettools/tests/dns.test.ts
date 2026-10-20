import { describe, expect, it } from 'vitest';
import { DohResolver, formatDnsAnswer, parseDnsType, parseDohResponse } from '../src/dns.js';
import { NettoolsError } from '../src/errors.js';
import { createClient, createFakeNetwork, doh, json } from './helpers.js';

describe('parseDnsType', () => {
  it('defaults to A and accepts any case', () => {
    expect(parseDnsType(undefined)).toBe('A');
    expect(parseDnsType('')).toBe('A');
    expect(parseDnsType('mx')).toBe('MX');
    expect(parseDnsType(' TXT ')).toBe('TXT');
  });

  it('rejects unknown types', () => {
    expect(() => parseDnsType('ANY')).toThrowError(NettoolsError);
    expect(() => parseDnsType('toString')).toThrowError(NettoolsError);
  });
});

describe('parseDohResponse', () => {
  it('normalises answers and tolerates junk records', () => {
    const answer = parseDohResponse(
      {
        Status: 0,
        AD: true,
        Answer: [
          { name: 'www.example.com.', type: 5, TTL: 30, data: 'example.com.' },
          { name: 'example.com.', type: 1, TTL: 60, data: '93.184.216.34' },
          { name: 'example.com.', type: 1, data: 42 },
          'garbage',
          null,
        ],
      },
      'www.example.com',
      'A',
      'Test DoH',
    );
    expect(answer.status).toBe('NOERROR');
    expect(answer.authenticated).toBe(true);
    expect(answer.records).toEqual([
      { name: 'www.example.com', type: 'CNAME', ttl: 30, data: 'example.com.' },
      { name: 'example.com', type: 'A', ttl: 60, data: '93.184.216.34' },
    ]);
    const text = formatDnsAnswer(answer);
    expect(text).toContain('↪ www.example.com CNAME example.com.');
    expect(text).toContain('• 93.184.216.34');
    expect(text).toContain('DNSSEC 已验证');
  });

  it('maps NXDOMAIN to a status, SERVFAIL to an error and junk to malformed', () => {
    expect(parseDohResponse({ Status: 3 }, 'nx.example.com', 'A', 'T').status).toBe('NXDOMAIN');
    expect(() => parseDohResponse({ Status: 2 }, 'x.example.com', 'A', 'T')).toThrowError(/SERVFAIL/u);
    expect(() => parseDohResponse({ nope: true }, 'x.example.com', 'A', 'T')).toThrowError(NettoolsError);
    expect(() => parseDohResponse([], 'x.example.com', 'A', 'T')).toThrowError(NettoolsError);
  });

  it('formats empty and NXDOMAIN answers', () => {
    expect(formatDnsAnswer(parseDohResponse({ Status: 3 }, 'nx.example.com', 'A', 'T'))).toContain('NXDOMAIN');
    expect(formatDnsAnswer(parseDohResponse({ Status: 0 }, 'example.com', 'CAA', 'T'))).toContain('没有 CAA 记录');
  });
});

describe('DohResolver fallback', () => {
  it('encodes the query with URLSearchParams', async () => {
    const network = createFakeNetwork();
    network.route('cloudflare-dns.com/dns-query', () => json(doh([])));
    await new DohResolver(createClient(network), ['cloudflare']).resolve('_dmarc.example.com', 'TXT');
    const url = network.calls[0];
    expect(url?.searchParams.get('name')).toBe('_dmarc.example.com');
    expect(url?.searchParams.get('type')).toBe('TXT');
  });

  it('falls back to the next provider when the first is down', async () => {
    const network = createFakeNetwork();
    network.route('cloudflare-dns.com/', () => json({}, 503));
    network.route('dns.alidns.com/resolve', () => json(doh([{ name: 'example.com.', type: 1, data: '1.2.3.4' }])));
    const answer = await new DohResolver(createClient(network)).resolve('example.com', 'A');
    expect(answer.provider).toBe('AliDNS DoH');
    // Only one retry on the first provider while a fallback remains.
    const cloudflareCalls = network.calls.filter((url) => url.hostname === 'cloudflare-dns.com');
    expect(cloudflareCalls).toHaveLength(2);
  });

  it('falls back on SERVFAIL and on malformed JSON', async () => {
    const network = createFakeNetwork();
    network.route('cloudflare-dns.com/', () => json({ Status: 2 }));
    network.route('dns.alidns.com/', () => new Response('not json'));
    network.route('dns.google/resolve', () => json(doh([{ name: 'example.com.', type: 1, data: '1.2.3.4' }])));
    const answer = await new DohResolver(createClient(network)).resolve('example.com', 'A');
    expect(answer.provider).toBe('Google DoH');
  });

  it('does not fall back on NXDOMAIN (authoritative)', async () => {
    const network = createFakeNetwork();
    network.route('cloudflare-dns.com/', () => json({ Status: 3 }));
    const answer = await new DohResolver(createClient(network)).resolve('nx.example.com', 'A');
    expect(answer.status).toBe('NXDOMAIN');
    expect(network.calls).toHaveLength(1);
  });

  it('summarises every provider failure', async () => {
    const network = createFakeNetwork();
    const error = await new DohResolver(createClient(network, { maxRetries: 0 }))
      .resolve('example.com', 'A')
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(NettoolsError);
    expect((error as Error).message).toContain('所有 DNS 服务均不可用');
    expect(network.calls.map((url) => url.hostname)).toEqual(['cloudflare-dns.com', 'dns.alidns.com', 'dns.google']);
  });
});
