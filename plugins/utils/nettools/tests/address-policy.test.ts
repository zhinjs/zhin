import { describe, expect, it } from 'vitest';
import {
  classifyAddress,
  classifyHostname,
  classifyParsedHost,
  ipv6ToBytes,
  parseHostInput,
  reverseLookupName,
} from '../src/address-policy.js';
import { NettoolsError } from '../src/errors.js';

function verdictFor(input: string): { blocked: boolean; reason?: string } {
  return classifyParsedHost(parseHostInput(input));
}

describe('parseHostInput canonicalisation', () => {
  it.each([
    ['2130706433', '127.0.0.1'],
    ['0x7f000001', '127.0.0.1'],
    ['0x7f.1', '127.0.0.1'],
    ['017700000001', '127.0.0.1'],
    ['0177.0.0.1', '127.0.0.1'],
    ['127.1', '127.0.0.1'],
    ['127.0.0.1.', '127.0.0.1'],
    ['0', '0.0.0.0'],
    ['3232235777', '192.168.1.1'],
    ['0xA9.0xFE.0xA9.0xFE', '169.254.169.254'],
    ['8.8.8.8', '8.8.8.8'],
  ])('decodes IPv4 spelling %s as %s', (input, expected) => {
    const parsed = parseHostInput(input);
    expect(parsed.kind).toBe('ipv4');
    expect(parsed.kind === 'ipv4' ? parsed.address : '').toBe(expected);
  });

  it('normalises IPv6, with or without brackets', () => {
    const plain = parseHostInput('2001:4860:4860:0:0:0:0:8888');
    const bracketed = parseHostInput('[2001:4860:4860::8888]');
    expect(plain).toEqual(bracketed);
    expect(plain.kind === 'ipv6' ? plain.address : '').toBe('2001:4860:4860::8888');
  });

  it('lower-cases domains, strips one trailing dot and converts IDN to punycode', () => {
    expect(parseHostInput('Example.COM.')).toEqual({ kind: 'domain', name: 'example.com' });
    expect(parseHostInput('例子.测试')).toEqual({ kind: 'domain', name: 'xn--fsqu00a.xn--0zwm56d' });
  });

  it.each([
    '',
    '   ',
    'http://example.com',
    'example.com/path',
    'example.com:80',
    'user@example.com',
    'exa mple.com',
    'example.com?x=1',
    'example.com#frag',
    '127.0.0.%31',
    'fe80::1%eth0',
    '[::1]:80',
    '1.2.3.999',
    '1.2.3.4.5',
    'localhost',
    'intranet',
    'a..b.com',
    '-bad.example.com',
    'bad-.example.com',
    'under_score.example.com',
    'exa!mple.com',
    `${'a'.repeat(64)}.com`,
    `${'a.'.repeat(130)}com`,
  ])('rejects %j as invalid input', (input) => {
    expect(() => parseHostInput(input)).toThrowError(NettoolsError);
  });

  it('allows underscores only when asked (DNS names)', () => {
    expect(parseHostInput('_dmarc.example.com', { allowUnderscore: true })).toEqual({
      kind: 'domain',
      name: '_dmarc.example.com',
    });
  });
});

describe('IPv4 blocklist', () => {
  it.each([
    ['0.0.0.0', '未指定'],
    ['10.1.2.3', '私有'],
    ['172.16.0.1', '私有'],
    ['172.31.255.255', '私有'],
    ['192.168.0.1', '私有'],
    ['100.64.0.1', 'CGNAT'],
    ['100.127.255.254', 'CGNAT'],
    ['127.0.0.1', '回环'],
    ['127.255.255.254', '回环'],
    ['169.254.1.1', '链路本地'],
    ['169.254.169.254', '元数据'],
    ['169.254.170.2', '元数据'],
    ['100.100.100.200', '元数据'],
    ['168.63.129.16', '元数据'],
    ['192.0.2.1', '文档'],
    ['198.51.100.7', '文档'],
    ['203.0.113.9', '文档'],
    ['198.18.0.1', '基准'],
    ['224.0.0.1', '组播'],
    ['239.255.255.250', '组播'],
    ['240.0.0.1', '保留'],
    ['255.255.255.255', '保留'],
  ])('blocks %s (%s)', (address, reasonFragment) => {
    const verdict = verdictFor(address);
    expect(verdict.blocked).toBe(true);
    expect(verdict.blocked ? verdict.reason : '').toContain(reasonFragment);
  });

  it.each(['8.8.8.8', '1.1.1.1', '172.15.255.255', '172.32.0.0', '100.63.255.255', '100.128.0.0', '169.253.255.255', '93.184.216.34'])(
    'allows public %s',
    (address) => {
      expect(verdictFor(address).blocked).toBe(false);
    },
  );

  it.each(['2130706433', '0x7f.1', '017700000001', '127.1', '0xa9fea9fe', '0300.0250.0.1', '10.1'])(
    'blocks encoded private address %s',
    (input) => {
      expect(verdictFor(input).blocked).toBe(true);
    },
  );
});

describe('IPv6 blocklist', () => {
  it.each([
    ['::', '未指定'],
    ['::1', '回环'],
    ['[0:0:0:0:0:0:0:1]', '回环'],
    ['fc00::1', 'ULA'],
    ['fd12:3456::1', 'ULA'],
    ['fd00:ec2::254', '元数据'],
    ['fe80::1', '链路本地'],
    ['febf::1', '链路本地'],
    ['fec0::1', '站点本地'],
    ['ff02::1', '组播'],
    ['2001:db8::1', '文档'],
    ['3fff::1', '文档'],
    ['2001:0:4136:e378::1', 'Teredo'],
    ['64:ff9b:1::1', 'NAT64'],
    ['100::1', '非全球单播'],
    ['::ffff:127.0.0.1', 'IPv4 映射'],
    ['::ffff:7f00:1', 'IPv4 映射'],
    ['::ffff:169.254.169.254', '元数据'],
    ['::ffff:10.0.0.1', '私有'],
    ['64:ff9b::a9fe:a9fe', 'NAT64'],
    ['64:ff9b::192.168.1.1', 'NAT64'],
    ['2002:7f00:1::', '6to4'],
    ['2002:c0a8:0101::1', '6to4'],
    ['::127.0.0.1', '非全球单播'],
  ])('blocks %s (%s)', (address, reasonFragment) => {
    const verdict = verdictFor(address);
    expect(verdict.blocked).toBe(true);
    expect(verdict.blocked ? verdict.reason : '').toContain(reasonFragment);
  });

  it.each(['2001:4860:4860::8888', '2606:4700:4700::1111', '::ffff:8.8.8.8', '64:ff9b::808:808', '2002:0808:0808::1'])(
    'allows public %s',
    (address) => {
      expect(verdictFor(address).blocked).toBe(false);
    },
  );

  it('expands IPv6 text with dotted tails to the same bytes', () => {
    expect(ipv6ToBytes('::ffff:1.2.3.4')).toEqual(ipv6ToBytes('::ffff:102:304'));
    expect(() => ipv6ToBytes('1::2::3')).toThrowError(NettoolsError);
  });
});

describe('hostname policy', () => {
  it.each([
    'metadata.google.internal',
    'metadata.goog',
    'instance-data.ec2.internal',
    'printer.local',
    'db.internal',
    'nas.lan',
    'router.home.arpa',
    'foo.localhost',
    'site.test',
    'thing.invalid',
    'abc.onion',
    '4.4.8.8.in-addr.arpa',
  ])('blocks %s', (name) => {
    expect(classifyHostname(name).blocked).toBe(true);
    expect(verdictFor(name).blocked).toBe(true);
  });

  it.each(['example.com', 'github.io', 'internal.example.com', 'local.example.org'])('allows %s', (name) => {
    expect(classifyHostname(name).blocked).toBe(false);
  });

  it('classifyAddress refuses domains', () => {
    expect(() => classifyAddress('example.com')).toThrowError(NettoolsError);
  });
});

describe('reverseLookupName', () => {
  it('builds in-addr.arpa and ip6.arpa names', () => {
    expect(reverseLookupName(parseHostInput('8.8.4.4'))).toBe('4.4.8.8.in-addr.arpa');
    expect(reverseLookupName(parseHostInput('2001:db8::1'))).toBe(
      '1.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.8.b.d.0.1.0.0.2.ip6.arpa',
    );
  });
});
