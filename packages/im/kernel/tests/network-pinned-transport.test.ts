/**
 * Integration tests for the pinned download moved into the kernel (#1250 第 46 批): real local HTTP /
 * HTTPS servers, real TLS handshakes, real sockets. Only name resolution is scripted — a test cannot
 * make a public name point at 127.0.0.1 — and where a test needs a "public" address it maps that
 * address to the local server inside the connect step, after the transport has checked it.
 */
import { readFileSync } from 'node:fs';
import * as http from 'node:http';
import * as https from 'node:https';
import * as net from 'node:net';
import type { AddressInfo } from 'node:net';
import type { TLSSocket } from 'node:tls';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createPinnedAddressConnect,
  NodeNetworkTransport,
  type NetworkAddressLookup,
  type PinnedAddressConnect,
} from '../src/network/pinned-transport.js';
import { fetchPublicMediaBytes } from '../src/network/public-media-fetch.js';

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url));
/** Self-signed for media.test, cdn.example and next.example (see fixtures/README.md). */
const CERT = fixture('media-test-cert.pem');
const KEY = fixture('media-test-key.pem');
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

/** The production pinned request, trusting the fixture certificate instead of the system store. */
const pinnedConnect = createPinnedAddressConnect({ ca: CERT });

const closers: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of closers.splice(0)) await close(); });

interface Seen { readonly host?: string; readonly servername?: string; readonly path?: string; readonly headers: http.IncomingHttpHeaders }

async function listen(server: net.Server): Promise<number> {
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  closers.push(() => new Promise<void>((resolve) => {
    (server as http.Server).closeAllConnections?.();
    server.close(() => resolve());
  }));
  return (server.address() as AddressInfo).port;
}

async function httpsServer(handler: (req: http.IncomingMessage, res: http.ServerResponse, port: number) => void) {
  const seen: Seen[] = [];
  let port = 0;
  const server = https.createServer({ cert: CERT, key: KEY }, (req, res) => {
    seen.push({
      ...(req.headers.host ? { host: req.headers.host } : {}),
      ...((req.socket as TLSSocket).servername ? { servername: (req.socket as TLSSocket).servername as string } : {}),
      ...(req.url ? { path: req.url } : {}),
      headers: req.headers,
    });
    handler(req, res, port);
  });
  port = await listen(server);
  return { port, seen };
}

/** A plain TCP server that writes a raw HTTP response (malformed lengths, stalls). */
async function rawHttpServer(response: (socket: net.Socket) => void) {
  const sockets = new Set<net.Socket>();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.once('data', () => response(socket));
    socket.on('error', () => undefined);
  });
  const port = await listen(server);
  closers.push(async () => { for (const socket of sockets) socket.destroy(); });
  return port;
}

const timeout = (ms: number) => AbortSignal.timeout(ms);

describe('NodeNetworkTransport — DNS is bounded by the deadline (L1)', () => {
  it('a resolver that hangs for 60 s fails the download in about timeoutMs (1 s)', async () => {
    let timer: NodeJS.Timeout | undefined;
    const lookup: NetworkAddressLookup = () => new Promise((resolve) => {
      timer = setTimeout(() => resolve([{ address: '93.184.216.34', family: 4 }]), 60_000);
    });
    closers.push(async () => { clearTimeout(timer); });
    const connected: string[] = [];
    const transport = new NodeNetworkTransport({ lookup, connect: async (_url, address) => { connected.push(address); throw new Error('unreachable'); } });
    const started = Date.now();
    const result = await fetchPublicMediaBytes('https://slow-dns.example/a.png', { maxBytes: 1024, timeoutMs: 1_000, transport });
    const elapsed = Date.now() - started;
    expect(result).toMatchObject({ ok: false, code: 'failed', host: 'slow-dns.example' });
    expect(elapsed).toBeGreaterThanOrEqual(900);
    expect(elapsed).toBeLessThan(2_500);
    expect(connected).toEqual([]);
  });

  it('requestBytes rejects with the abort reason while the lookup is still pending', async () => {
    const transport = new NodeNetworkTransport({ lookup: () => new Promise(() => undefined) });
    const controller = new AbortController();
    const pending = transport.requestBytes(new URL('https://slow-dns.example/a.png'), {}, controller.signal, 1024);
    controller.abort(new Error('cancelled'));
    await expect(pending).rejects.toThrow('cancelled');
  });
});

describe('pinned request over real TLS', () => {
  it('connects to the checked address, never resolving the name, and verifies the certificate for the name', async () => {
    const server = await httpsServer((_req, res) => { res.writeHead(200, { 'content-type': 'image/png' }); res.end(PNG); });
    // media.test is not resolvable: the request can only succeed by connecting to the given address.
    const response = await pinnedConnect(new URL(`https://media.test:${server.port}/a.png?x=1`), '127.0.0.1', {}, timeout(5_000), 1024);
    expect(response.status).toBe(200);
    expect(Buffer.from(response.body).equals(PNG)).toBe(true);
    expect(server.seen).toEqual([expect.objectContaining({ host: `media.test:${server.port}`, servername: 'media.test', path: '/a.png?x=1' })]);
  });

  it('refuses a certificate that does not match the host name (real handshake)', async () => {
    const server = await httpsServer((_req, res) => res.end(PNG));
    await expect(pinnedConnect(new URL(`https://wrong.example:${server.port}/a.png`), '127.0.0.1', {}, timeout(5_000), 1024))
      .rejects.toMatchObject({ code: 'ERR_TLS_CERT_ALTNAME_INVALID' });
    expect(server.seen).toEqual([]);
  });

  it('refuses a certificate the trust store does not know (production default)', async () => {
    const server = await httpsServer((_req, res) => res.end(PNG));
    const production = createPinnedAddressConnect();
    await expect(production(new URL(`https://media.test:${server.port}/a.png`), '127.0.0.1', {}, timeout(5_000), 1024)).rejects.toThrow();
    expect(server.seen).toEqual([]);
  });

  it('sends the host name without its trailing dot as SNI (L7)', async () => {
    const server = await httpsServer((_req, res) => res.end(PNG));
    const response = await pinnedConnect(new URL(`https://media.test.:${server.port}/a.png`), '127.0.0.1', {}, timeout(5_000), 1024);
    expect(response.status).toBe(200);
    expect(server.seen[0]?.servername).toBe('media.test');
  });

  it('times out while reading a body that stalls after the headers', async () => {
    const server = await httpsServer((_req, res) => {
      res.writeHead(200, { 'content-length': '1000' });
      res.write(PNG); // then nothing
    });
    const started = Date.now();
    await expect(pinnedConnect(new URL(`https://media.test:${server.port}/a.png`), '127.0.0.1', {}, timeout(300), 4096)).rejects.toThrow();
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it('fetchPublicMediaBytes reports a stalled body as a failure within timeoutMs', async () => {
    const server = await httpsServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'image/png' });
      res.write(PNG);
    });
    const transport = new NodeNetworkTransport({
      lookup: async () => [{ address: '93.184.216.34', family: 4 }],
      connect: (url, _address, headers, signal, maxBytes) => pinnedConnect(url, '127.0.0.1', headers, signal, maxBytes),
    });
    const started = Date.now();
    await expect(fetchPublicMediaBytes(`https://media.test:${server.port}/a.png`, { maxBytes: 4096, allowedPorts: [server.port], timeoutMs: 400, transport }))
      .resolves.toMatchObject({ ok: false, code: 'failed' });
    expect(Date.now() - started).toBeLessThan(2_000);
  });
});

describe('pinned request — Content-Length', () => {
  const url = (port: number) => new URL(`http://media.test:${port}/a.png`);

  it('refuses a declared length over maxBytes before reading the body', async () => {
    const port = await rawHttpServer((socket) => {
      socket.write('HTTP/1.1 200 OK\r\nContent-Length: 1000000\r\n\r\n');
      socket.write(PNG);
    });
    await expect(pinnedConnect(url(port), '127.0.0.1', {}, timeout(5_000), 1024)).rejects.toThrow('exceeds 1024 bytes');
  });

  it('refuses a body shorter than its declared length (connection closed early)', async () => {
    const port = await rawHttpServer((socket) => {
      socket.end(Buffer.concat([Buffer.from('HTTP/1.1 200 OK\r\nContent-Length: 500\r\nConnection: close\r\n\r\n'), PNG]));
    });
    await expect(pinnedConnect(url(port), '127.0.0.1', {}, timeout(5_000), 1024)).rejects.toThrow();
  });

  it('never returns more than the declared length when the server sends extra bytes', async () => {
    const port = await rawHttpServer((socket) => {
      socket.end(Buffer.concat([Buffer.from('HTTP/1.1 200 OK\r\nContent-Length: 8\r\nConnection: close\r\n\r\n'), PNG]));
    });
    // Node's parser either stops at the declared length or rejects the trailing bytes as a parse
    // error, depending on how they arrive; both are fine — the extra bytes are never returned.
    const outcome = await pinnedConnect(url(port), '127.0.0.1', {}, timeout(5_000), 1024)
      .then(response => ({ response }), (error: unknown) => ({ error }));
    if ('response' in outcome) {
      expect(outcome.response.body.byteLength).toBe(8);
      expect(Buffer.from(outcome.response.body).equals(PNG.subarray(0, 8))).toBe(true);
    } else {
      expect(String(outcome.error)).toMatch(/Parse Error/u);
    }
  });

  it('refuses a body without Content-Length once it passes maxBytes', async () => {
    const port = await rawHttpServer((socket) => {
      socket.end(Buffer.concat([Buffer.from('HTTP/1.1 200 OK\r\nConnection: close\r\n\r\n'), Buffer.alloc(4096, 1)]));
    });
    await expect(pinnedConnect(url(port), '127.0.0.1', {}, timeout(5_000), 1024)).rejects.toThrow('exceeds 1024 bytes');
  });
});

describe('fetchPublicMediaBytes over real HTTPS — redirect hops and headers', () => {
  // The local test server listens on a random port; `allowedPorts` admits it on every hop (#1250 第 48 批).
  const DNS: Record<string, string> = {
    'media.test': '93.184.216.34',
    'next.example': '93.184.216.35',
    'cdn.example': '10.0.0.5', // a public-looking name with a private answer
  };
  /** Pinned transport with scripted DNS; every checked public address is served by the local server. */
  function transport() {
    const connected: Array<{ host: string; address: string }> = [];
    const connect: PinnedAddressConnect = (url, address, headers, signal, maxBytes) => {
      connected.push({ host: url.hostname, address });
      return pinnedConnect(url, '127.0.0.1', headers, signal, maxBytes);
    };
    const lookup: NetworkAddressLookup = async (host) => {
      const address = DNS[host];
      if (!address) throw new Error(`ENOTFOUND ${host}`);
      return [{ address, family: 4 }];
    };
    return { connected, transport: new NodeNetworkTransport({ lookup, connect }) };
  }

  async function redirectingServer() {
    return httpsServer((req, res, port) => {
      const go = (location: string) => { res.writeHead(302, { location }); res.end(); };
      switch (req.url) {
        case '/to-next': return go(`https://next.example:${port}/b.png`);
        case '/to-private-name': return go(`https://cdn.example:${port}/b.png`);
        case '/to-loopback': return go(`https://127.0.0.1:${port}/b.png`);
        case '/to-http': return go(`http://next.example:${port}/b.png`);
        case '/same-origin': return go('/b.png');
        default: res.writeHead(200, { 'content-type': 'image/png' }); return res.end(PNG);
      }
    });
  }

  it('follows a redirect to another public host, checking and pinning each hop', async () => {
    const server = await redirectingServer();
    const net = transport();
    const result = await fetchPublicMediaBytes(`https://media.test:${server.port}/to-next`, { maxBytes: 1024, allowedPorts: [server.port], transport: net.transport });
    expect(result).toMatchObject({ ok: true, mimeType: 'image/png', url: `https://next.example:${server.port}/b.png` });
    expect(net.connected).toEqual([
      { host: 'media.test', address: '93.184.216.34' },
      { host: 'next.example', address: '93.184.216.35' },
    ]);
  });

  it.each([
    ['a name that resolves to a private address', '/to-private-name', 'cdn.example'],
    ['a loopback literal', '/to-loopback', '127.0.0.1'],
    ['a downgrade to http', '/to-http', 'next.example'],
  ])('refuses a redirect to %s without connecting to it', async (_label, path, host) => {
    const server = await redirectingServer();
    const net = transport();
    const result = await fetchPublicMediaBytes(`https://media.test:${server.port}${path}`, { maxBytes: 1024, allowedPorts: [server.port], transport: net.transport });
    expect(result).toMatchObject({ ok: false, code: 'blocked', host });
    expect(net.connected).toEqual([{ host: 'media.test', address: '93.184.216.34' }]);
    expect(server.seen).toHaveLength(1);
  });

  it('drops caller headers on a cross-origin redirect (L2) and keeps them on the same origin', async () => {
    const server = await redirectingServer();
    const headers = { Authorization: 'Bearer secret', Range: 'bytes=0-63' };
    await expect(fetchPublicMediaBytes(`https://media.test:${server.port}/to-next`, { maxBytes: 1024, allowedPorts: [server.port], headers, transport: transport().transport }))
      .resolves.toMatchObject({ ok: true });
    expect(server.seen[0]?.headers.authorization).toBe('Bearer secret');
    expect(server.seen[1]?.host).toBe(`next.example:${server.port}`);
    expect(server.seen[1]?.headers.authorization).toBeUndefined();
    expect(server.seen[1]?.headers.range).toBeUndefined();

    server.seen.length = 0;
    await expect(fetchPublicMediaBytes(`https://media.test:${server.port}/same-origin`, { maxBytes: 1024, allowedPorts: [server.port], headers, transport: transport().transport }))
      .resolves.toMatchObject({ ok: true });
    expect(server.seen.map(seen => seen.headers.authorization)).toEqual(['Bearer secret', 'Bearer secret']);
  });
});
