import { describe, expect, it } from 'vitest';
import { NettoolsError } from '../src/errors.js';
import { formatWhoisRecord, parseBootstrap, parseRdapDomain, parseWhoisFallback, RdapClient } from '../src/whois.js';
import { createClient, createFakeNetwork, json } from './helpers.js';

const BOOTSTRAP = {
  services: [
    [['com', 'net'], ['https://rdap.verisign.com/com/v1/']],
    [['insecure'], ['http://rdap.insecure.example/']],
    'junk',
  ],
};

const RDAP_EXAMPLE = {
  objectClassName: 'domain',
  ldhName: 'EXAMPLE.COM',
  status: ['client delete prohibited', 42],
  events: [
    { eventAction: 'registration', eventDate: '1995-08-14T04:00:00Z' },
    { eventAction: 'expiration', eventDate: '2027-08-13T04:00:00Z' },
    { eventAction: 'last changed', eventDate: '2026-08-14T08:01:43Z' },
  ],
  entities: [
    { roles: ['registrar'], vcardArray: ['vcard', [['version', {}, 'text', '4.0'], ['fn', {}, 'text', 'Example Registrar']]] },
  ],
  nameservers: [{ ldhName: 'A.IANA-SERVERS.NET' }, { nope: 1 }],
  secureDNS: { delegationSigned: true },
};

const WHOIS_CN = {
  code: 200,
  data: {
    domain: 'BAIDU.CN',
    status: ['clientDeleteProhibited'],
    registrar: '某注册商',
    registrant: { name: '某公司', email: 'secret@example.cn' },
    nameservers: ['NS1.BAIDU.CN'],
    dnssec: 'unsigned',
    created_at: 1047903605000,
    expires_at: 1868446116000,
    updated_at: 0,
  },
};

describe('RDAP parsing', () => {
  it('keeps only https bootstrap servers', () => {
    const servers = parseBootstrap(BOOTSTRAP);
    expect(servers.get('com')).toEqual(['https://rdap.verisign.com/com/v1/']);
    expect(servers.has('insecure')).toBe(false);
    expect(() => parseBootstrap({})).toThrowError(NettoolsError);
  });

  it('extracts registrar, dates, status, name servers and DNSSEC', () => {
    const record = parseRdapDomain(RDAP_EXAMPLE, 'example.com', 'rdap.test');
    expect(record).toMatchObject({
      domain: 'example.com',
      registrar: 'Example Registrar',
      statuses: ['client delete prohibited'],
      createdAt: '1995-08-14T04:00:00Z',
      expiresAt: '2027-08-13T04:00:00Z',
      nameservers: ['a.iana-servers.net'],
      dnssec: true,
    });
    const text = formatWhoisRecord(record);
    expect(text).toContain('到期时间：2027-08-13 (UTC)');
    expect(text).toContain('DNSSEC：已启用');
  });

  it('rejects non-domain objects', () => {
    expect(() => parseRdapDomain({ objectClassName: 'entity' }, 'x.com', 's')).toThrowError(NettoolsError);
    expect(() => parseRdapDomain('nope', 'x.com', 's')).toThrowError(NettoolsError);
  });

  it('parses the WHOIS fallback and never exposes registrant data', () => {
    const record = parseWhoisFallback(WHOIS_CN, 'baidu.cn', '60s.viki.moe');
    expect(record).toMatchObject({ registered: true, registrar: '某注册商', dnssec: false, nameservers: ['ns1.baidu.cn'] });
    expect(record.createdAt).toBe('2003-03-17T12:20:05.000Z');
    const text = formatWhoisRecord(record);
    expect(text).not.toContain('secret@example.cn');
    expect(text).not.toContain('某公司');
  });

  it('treats an empty WHOIS fallback answer as unregistered', () => {
    const empty = { code: 200, data: { domain: 'X.CN', status: [], registrar: '', nameservers: [], created_at: 0, expires_at: 0 } };
    expect(parseWhoisFallback(empty, 'x.cn', 's').registered).toBe(false);
  });
});

describe('RdapClient fallback chain', () => {
  it('uses the registry from the bootstrap and caches the bootstrap', async () => {
    const network = createFakeNetwork();
    network.route('data.iana.org/rdap/dns.json', () => json(BOOTSTRAP));
    network.route('rdap.verisign.com/com/v1/domain/', () => json(RDAP_EXAMPLE));
    const client = new RdapClient(createClient(network));
    await client.lookup('example.com');
    await client.lookup('example.com');
    const bootstrapCalls = network.calls.filter((url) => url.hostname === 'data.iana.org');
    expect(bootstrapCalls).toHaveLength(1);
    expect(network.calls[1]?.pathname).toBe('/com/v1/domain/example.com');
  });

  it('treats a registry 404 as authoritative "not registered"', async () => {
    const network = createFakeNetwork();
    network.route('data.iana.org/', () => json(BOOTSTRAP));
    network.route('rdap.verisign.com/', () => json({ errorCode: 404 }, 404));
    const record = await new RdapClient(createClient(network)).lookup('nobody-has-this.com');
    expect(record.registered).toBe(false);
    expect(network.calls.some((url) => url.hostname === 'rdap.org')).toBe(false);
    expect(formatWhoisRecord(record)).toContain('未查询到注册信息');
  });

  it('falls back to rdap.org when the registry fails', async () => {
    const network = createFakeNetwork();
    network.route('data.iana.org/', () => json(BOOTSTRAP));
    network.route('rdap.verisign.com/', () => json({}, 500));
    network.route('rdap.org/domain/', () => json(RDAP_EXAMPLE));
    const record = await new RdapClient(createClient(network, { maxRetries: 0 })).lookup('example.com');
    expect(record.source).toBe('rdap.org');
  });

  it('falls back to 60s WHOIS for TLDs without RDAP (.cn), even when IANA is down', async () => {
    const network = createFakeNetwork();
    network.route('data.iana.org/', () => json({}, 503));
    network.route('rdap.org/', () => json({}, 404));
    network.route('60s.viki.moe/v2/whois', () => json(WHOIS_CN));
    const record = await new RdapClient(createClient(network, { maxRetries: 0 })).lookup('baidu.cn');
    expect(record.registered).toBe(true);
    expect(record.source).toBe('60s.viki.moe');
    const whoisCall = network.calls.find((url) => url.hostname === '60s.viki.moe');
    expect(whoisCall?.searchParams.get('domain')).toBe('baidu.cn');
  });

  it('retries the parent domain once for unregistered subdomains', async () => {
    const network = createFakeNetwork();
    network.route('data.iana.org/', () => json(BOOTSTRAP));
    network.route('rdap.verisign.com/com/v1/domain/www.example.com', () => json({}, 404));
    network.route('rdap.verisign.com/com/v1/domain/example.com', () => json(RDAP_EXAMPLE));
    const record = await new RdapClient(createClient(network)).lookup('www.example.com');
    expect(record.domain).toBe('example.com');
  });

  it('throws a clear error when every source fails', async () => {
    const network = createFakeNetwork();
    await expect(new RdapClient(createClient(network, { maxRetries: 0 })).lookup('example.com')).rejects.toBeInstanceOf(
      NettoolsError,
    );
  });
});
