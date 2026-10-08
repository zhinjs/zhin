import https from 'node:https';
import tls from 'node:tls';
import { once } from 'node:events';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sendKookOutbound } from '../src/outbound.js';
import { RuntimeKookClient, defaultCreateClient, type KookClientTransport } from '../src/ws.js';
import { resolveKookConfig } from '../src/protocol.js';
import { createTcpFaultProxy } from '../../../../scripts/platform-acceptance/tcp-fault-proxy.mjs';

it.each(['www.kookapp.cn', 'wrong.invalid'])('actual KOOK SDK verifies TLS identity %s with single outbound submission', async hostname => {
  const dir = mkdtempSync(join(tmpdir(), 'kook-api-tls-'));
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-keyout', join(dir, 'key'), '-out', join(dir, 'cert'), '-subj', `/CN=${hostname}`, '-addext', `subjectAltName=DNS:${hostname}`], { stdio: 'ignore' });
  const ca = readFileSync(join(dir, 'cert')); let calls = 0; let cutting = true; let sni = ''; let host = '';
  const server = https.createServer({ key: readFileSync(join(dir, 'key')), cert: ca }, (request, response) => {
    calls++; host = request.headers.host ?? ''; request.resume(); request.once('end', () => {
      if (cutting) { proxy.cut(); return; }
      response.setHeader('content-type', 'application/json'); response.end(JSON.stringify({ code: 0, data: { msg_id: 'new-sample' } }));
    });
  });
  server.on('secureConnection', socket => { sni = socket.servername || ''; });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const proxy = await createTcpFaultProxy({ upstreamHost: '127.0.0.1', upstreamPort: (server.address() as { port: number }).port, port: 0, controlPort: 0 });
  const original = tls.connect.bind(tls); const connect = vi.spyOn(tls, 'connect').mockImplementation(options => original({ ...options as tls.ConnectionOptions, ca }));
  const client = new RuntimeKookClient({ token: 'fixture', mode: 'websocket', logLevel: 'off' } as never, undefined, { port: proxy.port });
  client.channels.set('fixture', { id: 'fixture' } as never);
  const agent = client.request.defaults.httpsAgent as https.Agent;
  try {
    expect(client.request.defaults.baseURL).toBe('https://www.kookapp.cn/api');
    const failure = await sendKookOutbound(client as unknown as KookClientTransport, { conversation: { endpoint: { id: 'fixture', adapter: 'kook' }, kind: 'channel', id: 'fixture' }, payload: 'fixture' }).catch(error => error);
    expect(failure).toBeInstanceOf(Error);
    if (hostname === 'wrong.invalid') { expect(failure.disposition).toBe('unknown'); expect(calls).toBe(0); return; }
    expect(failure.disposition).toBe('unknown');
    expect(calls).toBe(1); expect(sni).toBe('www.kookapp.cn'); expect(host).toBe('www.kookapp.cn');
    expect(connect).toHaveBeenCalledWith(expect.objectContaining({ servername: 'www.kookapp.cn', rejectUnauthorized: true, host: '127.0.0.1', port: proxy.port }));
    cutting = false; proxy.recover(); await new Promise(resolve => setTimeout(resolve, 30)); expect(calls).toBe(1);
    await expect(client.sendChannelMsg('fixture', 'manual-new-sample')).resolves.toMatchObject({ msg_id: 'new-sample' }); expect(calls).toBe(2);
    const before = connect.mock.calls.length;
    await expect(client.request.post('https://unexpected.invalid/api/v3/message/create', {})).rejects.toThrow('rejected destination identity');
    await expect(client.request.post('http://unexpected.invalid/api/v3/message/create', {})).rejects.toMatchObject({ disposition: 'not_sent' });
    expect(connect).toHaveBeenCalledTimes(before);
  } finally { agent.destroy(); connect.mockRestore(); await proxy.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); rmSync(dir, { recursive: true, force: true }); }
});
it('defaults to direct SDK API transport', () => {
  const client = defaultCreateClient(resolveKookConfig({ id: 'fixture', token: 'fixture' }) as never) as unknown as RuntimeKookClient;
  expect(client.request.defaults.httpsAgent).toBeUndefined();
});
it.each([0, -1, 65536, 1.5, '18000'])('rejects invalid API proxy port %j', port => {
  expect(() => resolveKookConfig({ id: 'fixture', token: 'fixture', apiProxy: { port } as never })).toThrow('apiProxy');
});
