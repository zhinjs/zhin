import https from 'node:https';
import tls from 'node:tls';
import net from 'node:net';
import { once } from 'node:events';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLarkWebApiTransport } from '../src/web-api-proxy.js';
import { LarkEndpoint } from '../src/endpoint.js';
import { resolveLarkConfig } from '../src/protocol.js';
import { createTcpFaultProxy } from '../../../../scripts/platform-acceptance/tcp-fault-proxy.mjs';

function certificate(host: string) {
  const dir = mkdtempSync(join(tmpdir(), 'zhin-lark-api-tls-'));
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-keyout', join(dir, 'key.pem'), '-out', join(dir, 'cert.pem'), '-subj', `/CN=${host}`, '-addext', `subjectAltName=DNS:${host}`], { stdio: 'ignore' });
  return { dir, key: readFileSync(join(dir, 'key.pem')), cert: readFileSync(join(dir, 'cert.pem')) };
}
const conversation = { endpoint: { id: 'fixture', adapter: 'lark' }, kind: 'private' as const, id: 'fixture' };

it('stop cancels a real pending TLS handshake and closes the peer socket', async () => {
  const server = net.createServer();
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const transport = createLarkWebApiTransport({ port: (server.address() as { port: number }).port });
  const connected = once(server, 'connection');
  const request = transport.fetch('https://open.feishu.cn/open-apis/im/v1/messages', { method: 'POST', body: '{}' });
  const outcome = request.then(() => ({ rejected: false }), () => ({ rejected: true }));
  const [peer] = await connected as [net.Socket];
  peer.resume();
  const peerClosed = once(peer, 'close');
  try {
    await transport.close();
    expect(await outcome).toEqual({ rejected: true });
    await peerClosed;
    expect(peer.destroyed).toBe(true);
    await expect(transport.fetch('https://open.feishu.cn/open-apis/im/v1/messages')).rejects.toThrow('stopped');
  } finally {
    peer.destroy(); await transport.close();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});

it('Node global fetch uses public undici dispatcher with verified official identity, one POST on cut and manual recovery', async () => {
  const cert = certificate('open.feishu.cn');
  let posts = 0; let cutting = true; const identities: string[] = [];
  const server = https.createServer(cert, (request, response) => {
    identities.push(String(request.headers.host));
    request.resume(); request.once('end', () => {
      if (request.url?.includes('/auth/')) { response.end(JSON.stringify({ code: 0, tenant_access_token: 'fixture-only', expire: 7200 })); return; }
      posts++;
      if (cutting) { proxy.cut(); return; }
      response.end(JSON.stringify({ code: 0, data: { message_id: 'fixture-receipt' } }));
    });
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const proxy = await createTcpFaultProxy({ upstreamHost: '127.0.0.1', upstreamPort: (server.address() as { port: number }).port, port: 0, controlPort: 0 });
  const original = tls.connect.bind(tls);
  const connect = vi.spyOn(tls, 'connect').mockImplementation(options => original({ ...options as tls.ConnectionOptions, ca: cert.cert }));
  const endpoint = new LarkEndpoint({ id: 'fixture', config: resolveLarkConfig({ id: 'fixture', appId: 'fixture', appSecret: 'fixture', webApiProxy: { port: proxy.port } }) });
  try {
    await expect(endpoint.send({ conversation, payload: 'first' })).rejects.toMatchObject({ code: 'delivery_unconfirmed', disposition: 'unknown' });
    expect(posts).toBe(1);
    cutting = false; proxy.recover(); await new Promise(resolve => setTimeout(resolve, 30)); expect(posts).toBe(1);
    await expect(endpoint.send({ conversation, payload: 'new-sample' })).resolves.toBe('fixture-receipt'); expect(posts).toBe(2);
    expect(identities.every(value => value === 'open.feishu.cn')).toBe(true);
    expect(connect).toHaveBeenCalledWith(expect.objectContaining({ host: '127.0.0.1', port: proxy.port, servername: 'open.feishu.cn', rejectUnauthorized: true }));
    const transport = createLarkWebApiTransport({ port: proxy.port });
    try {
      const before = connect.mock.calls.length;
      await expect(transport.fetch('https://unexpected.invalid/open-apis/im/v1/messages')).rejects.toThrow('destination identity');
      expect(connect).toHaveBeenCalledTimes(before);
      await transport.close();
      await expect(transport.fetch('https://open.feishu.cn/open-apis/im/v1/messages')).rejects.toThrow('stopped');
    } finally { await transport.close(); }
  } finally { await endpoint.stop(); connect.mockRestore(); await proxy.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); rmSync(cert.dir, { recursive: true, force: true }); }
});

it('rejects a trusted certificate with the wrong SAN before any HTTP request', async () => {
  const cert = certificate('wrong.invalid'); let calls = 0;
  const server = https.createServer(cert, (_request, response) => { calls++; response.end('{}'); });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const original = tls.connect.bind(tls);
  const connect = vi.spyOn(tls, 'connect').mockImplementation(options => original({ ...options as tls.ConnectionOptions, ca: cert.cert }));
  const transport = createLarkWebApiTransport({ port: (server.address() as { port: number }).port });
  try {
    await expect(transport.fetch('https://open.feishu.cn/open-apis/im/v1/messages', { method: 'POST', body: '{}' })).rejects.toMatchObject({ cause: { code: 'ERR_TLS_CERT_ALTNAME_INVALID' } });
    expect(calls).toBe(0);
  } finally { await transport.close(); connect.mockRestore(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); rmSync(cert.dir, { recursive: true, force: true }); }
});

it('defaults to direct fetch and rejects proxy origin/host/TLS configuration expansion', () => {
  const base = { id: 'fixture', appId: 'fixture', appSecret: 'fixture' };
  expect(resolveLarkConfig(base).webApiProxy).toBeUndefined();
  expect(resolveLarkConfig({ ...base, webApiProxy: { port: 18080 }, streamProxy: { port: 18081, serverName: 'gateway.feishu.cn' } })).toMatchObject({ webApiProxy: { port: 18080 }, streamProxy: { port: 18081 } });
  expect(() => resolveLarkConfig({ ...base, webApiProxy: { port: 18080, rejectUnauthorized: false } as never })).toThrow('webApiProxy');
  expect(() => resolveLarkConfig({ ...base, webApiProxy: { port: 18080 }, apiBaseUrl: 'http://127.0.0.1:18080/open-apis' })).toThrow('official Feishu');
  expect(() => resolveLarkConfig({ ...base, webApiProxy: { port: 18080 }, isFeishu: false })).toThrow('official Feishu');
});

it('default endpoint uses direct global fetch without a fault dispatcher', async () => {
  const http = await import('node:http');
  let calls = 0;
  const server = http.createServer((request, response) => {
    calls++; request.resume(); request.once('end', () => response.end(JSON.stringify(request.url?.includes('/auth/')
      ? { code: 0, tenant_access_token: 'fixture-only', expire: 7200 }
      : { code: 0, data: { message_id: 'direct-receipt' } })));
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const endpoint = new LarkEndpoint({ id: 'fixture', config: resolveLarkConfig({ id: 'fixture', appId: 'fixture', appSecret: 'fixture', apiBaseUrl: `http://127.0.0.1:${(server.address() as { port: number }).port}/open-apis` }) });
  try { await expect(endpoint.send({ conversation, payload: 'direct' })).resolves.toBe('direct-receipt'); expect(calls).toBe(2); }
  finally { await endpoint.stop(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});
