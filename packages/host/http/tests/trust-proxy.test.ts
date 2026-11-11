import { afterEach, describe, expect, it } from 'vitest';
import { request as httpRequest } from 'node:http';
import { WebSocket } from 'ws';
import { createHttpRouter } from '../src/http-host.js';
import { createNodeHttpListener, type NodeHttpListener } from '../src/node/index.js';
import { resolveHttpConfig } from '../src/host-installer.js';
import { verifyProtocolAccessToken } from '../src/protocol-auth.js';
import {
  compileTrustProxy,
  parseTrustProxy,
  resolveClientAddress,
  TrustProxyConfigError,
} from '../src/trust-proxy.js';

const xff = (value: string) => new Headers({ 'x-forwarded-for': value });

describe('http.trustProxy client address', () => {
  it('ignores forwarding headers when off (spoofed X-Forwarded-For from an untrusted peer)', () => {
    expect(resolveClientAddress('203.0.113.9', xff('1.2.3.4'), undefined)).toBe('203.0.113.9');
    expect(resolveClientAddress('127.0.0.1', xff('1.2.3.4'), compileTrustProxy(parseTrustProxy(false)))).toBe('127.0.0.1');
    // Peer not in the trusted list: its header is ignored.
    expect(resolveClientAddress('203.0.113.9', xff('1.2.3.4'), compileTrustProxy(['10.0.0.0/8']))).toBe('203.0.113.9');
  });

  it('honours a trusted proxy and stops at the first untrusted hop', () => {
    const trusted = compileTrustProxy(['loopback', '10.0.0.0/8']);
    expect(resolveClientAddress('127.0.0.1', xff('198.51.100.7'), trusted)).toBe('198.51.100.7');
    expect(resolveClientAddress('::ffff:127.0.0.1', xff('198.51.100.7'), trusted)).toBe('198.51.100.7');
    // A client-supplied prefix is ignored: the rightmost untrusted hop wins.
    expect(resolveClientAddress('127.0.0.1', xff('6.6.6.6, 198.51.100.7, 10.1.2.3'), trusted)).toBe('198.51.100.7');
    expect(resolveClientAddress('127.0.0.1', xff('10.0.0.1, 10.0.0.2'), trusted)).toBe('10.0.0.1');
    expect(resolveClientAddress('127.0.0.1', new Headers({ forwarded: 'for="[2001:db8::1]:443";proto=https, for=10.0.0.5' }), trusted)).toBe('2001:db8::1');
    // Malformed chain: fail closed to the peer.
    expect(resolveClientAddress('127.0.0.1', xff('not-an-ip'), trusted)).toBe('127.0.0.1');
    expect(resolveClientAddress('127.0.0.1', new Headers({ forwarded: 'for=_hidden' }), trusted)).toBe('127.0.0.1');
  });

  it('supports true and hop counts', () => {
    expect(resolveClientAddress('127.0.0.1', xff('1.1.1.1, 2.2.2.2'), compileTrustProxy(true))).toBe('1.1.1.1');
    expect(resolveClientAddress('127.0.0.1', xff('1.1.1.1, 2.2.2.2'), compileTrustProxy(1))).toBe('2.2.2.2');
    expect(resolveClientAddress('127.0.0.1', xff('1.1.1.1, 2.2.2.2'), compileTrustProxy(2))).toBe('1.1.1.1');
  });

  it('validates config values', () => {
    expect(parseTrustProxy(undefined)).toBeUndefined();
    expect(parseTrustProxy('false')).toBeUndefined();
    expect(parseTrustProxy('true')).toBe(true);
    expect(parseTrustProxy('2')).toBe(2);
    expect(parseTrustProxy('10.0.0.1, fd00::/8')).toEqual(['10.0.0.1', 'fd00::/8']);
    expect(() => parseTrustProxy(['nope'])).toThrow(TrustProxyConfigError);
    expect(() => parseTrustProxy(['10.0.0.0/33'])).toThrow(/prefix/);
    expect(() => parseTrustProxy(-1)).toThrow(/hop count/);
    expect(() => parseTrustProxy({})).toThrow(/http.trustProxy/);
  });

  it('is read from http.trustProxy and inherited by additional listeners', async () => {
    const config = await resolveHttpConfig({ http: { trustProxy: ['loopback'], listeners: [{ host: '127.0.0.1', port: 9 }] } });
    expect(config.trustProxy).toEqual(['loopback']);
    expect(config.listeners?.[0]?.trustProxy).toEqual(['loopback']);
    await expect(resolveHttpConfig({ http: { trustProxy: ['bogus'] } })).rejects.toThrow(/trustProxy/);
  });
});

describe('forwarded traffic never counts as loopback', () => {
  it('refuses a token-less protocol socket when the loopback peer forwarded the request', () => {
    const at = (headers: Headers, remoteAddress = '127.0.0.1') => ({ headers, url: new URL('http://localhost/onebot'), remoteAddress });
    expect(verifyProtocolAccessToken(undefined, at(new Headers()))).toBe(true);
    expect(verifyProtocolAccessToken(undefined, at(xff('203.0.113.9')))).toBe(false);
    expect(verifyProtocolAccessToken(undefined, at(xff('127.0.0.1')))).toBe(false);
    expect(verifyProtocolAccessToken(undefined, at(new Headers({ forwarded: 'for=127.0.0.1' })))).toBe(false);
    // With an access token the credential decides, proxied or not.
    expect(verifyProtocolAccessToken('s', { ...at(xff('203.0.113.9')), url: new URL('http://localhost/onebot?access_token=s') })).toBe(true);
  });
});

describe('Node listener with trustProxy', () => {
  const listeners: NodeHttpListener[] = [];
  afterEach(async () => { await Promise.all(listeners.splice(0).map(listener => listener.close())); });

  async function start(trustProxy?: Parameters<typeof parseTrustProxy>[0]) {
    const router = createHttpRouter({ builtinRoutes: false });
    router.route('GET', '/ip', (_request, context) => new Response(context.remoteAddress ?? ''));
    const upgrades: Array<string | undefined> = [];
    const setting = parseTrustProxy(trustProxy);
    const listener = createNodeHttpListener({
      host: '127.0.0.1', port: 0,
      ...(setting !== undefined ? { trustProxy: setting } : {}),
      handle: (request, info) => router.handle(request, info),
      upgrade: async (request) => { upgrades.push(request.remoteAddress); return { accepted: false, status: 403 }; },
    });
    listeners.push(listener);
    return { address: await listener.listen(), upgrades };
  }

  const get = (port: number, headers: Record<string, string>) => new Promise<string>((resolve, reject) => {
    const request = httpRequest({ host: '127.0.0.1', port, path: '/ip', headers }, (response) => {
      let body = '';
      response.on('data', (chunk) => { body += chunk; });
      response.on('end', () => resolve(body));
    });
    request.on('error', reject);
    request.end();
  });

  const upgrade = (port: number, headers: Record<string, string>) => new Promise<void>((resolve) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers });
    socket.once('unexpected-response', () => resolve());
    socket.once('error', () => resolve());
  });

  it('keeps the peer address by default even with a spoofed X-Forwarded-For', async () => {
    const { address, upgrades } = await start();
    expect(await get(address.port, { 'x-forwarded-for': '198.51.100.7' })).toMatch(/127\.0\.0\.1$/u);
    await upgrade(address.port, { 'x-forwarded-for': '198.51.100.7' });
    expect(upgrades[0]).toMatch(/127\.0\.0\.1$/u);
  });

  it('derives the client address for HTTP and WebSocket upgrades behind a trusted proxy', async () => {
    const { address, upgrades } = await start(['loopback']);
    expect(await get(address.port, { 'x-forwarded-for': '6.6.6.6, 198.51.100.7' })).toBe('198.51.100.7');
    expect(await get(address.port, {})).toMatch(/127\.0\.0\.1$/u);
    await upgrade(address.port, { 'x-forwarded-for': '198.51.100.8' });
    expect(upgrades[0]).toBe('198.51.100.8');
  });
});
