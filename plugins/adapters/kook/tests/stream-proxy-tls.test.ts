import https from 'node:https';
import tls from 'node:tls';
import { once } from 'node:events';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocketServer } from 'ws';
import { createKookStreamSocket } from '../src/stream-proxy.js';
import { loadPatchedKookFixture } from './sdk-patch-fixture.js';
import { createTcpFaultProxy } from '../../../../scripts/platform-acceptance/tcp-fault-proxy.mjs';

it('patched actual KOOK SDK socketFactory preserves TLS and supports controlled cut/recover', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'zhin-ding-wss-'));
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-keyout', join(directory, 'key.pem'), '-out', join(directory, 'cert.pem'), '-subj', '/CN=gateway.test', '-addext', 'subjectAltName=DNS:gateway.test'], { stdio: 'ignore' });
  const ca = readFileSync(join(directory, 'cert.pem'));
  const server = https.createServer({ key: readFileSync(join(directory, 'key.pem')), cert: ca });
  const ws = new WebSocketServer({ server });
  ws.on('connection', socket => { socket.send(JSON.stringify({ s: 1, d: { code: 0, session_id: 'fixture' } })); socket.on('message', () => socket.send(JSON.stringify({ s: 3 }))); });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const proxy = await createTcpFaultProxy({ upstreamHost: '127.0.0.1', upstreamPort: (server.address() as { port: number }).port, port: 0, controlPort: 0 });
  const original = tls.connect.bind(tls);
  // Trust only the test CA. The actual ws connector still decides routing/SNI/verification.
  const connector = vi.spyOn(tls, 'connect').mockImplementation(options => original({ ...options as tls.ConnectionOptions, ca }));
  const clients = [];
  const fixture = await loadPatchedKookFixture();
  try {
    const url = 'wss://gateway.test/callback?ticket=fixture-private';
    const create = async () => {
      const client = new fixture.sdk.Client({ token: 'fixture', handleProcessErrors: false, mode: 'websocket', autoReconnect: false, logLevel: 'off', socketFactory: (target: string) => createKookStreamSocket(target, { port: proxy.port, serverName: 'gateway.test' }) });
      client.request.get = vi.fn(async () => ({ data: { url } })); client.init = vi.fn(async () => {}); clients.push(client);
      await client.connect(); return client;
    };
    const first = await create();
    expect(connector).toHaveBeenCalledWith(expect.objectContaining({ host: '127.0.0.1', port: proxy.port, servername: 'gateway.test', rejectUnauthorized: true, path: undefined }));
    const disconnected = once(first.receiver, 'disconnected'); proxy.cut(); await disconnected;
    expect(first.receiver.reconnectTimer).toBeNull();
    await first.disconnect(); proxy.recover();
    const second = await create();
    expect(second.receiver.config.autoReconnect).toBe(false);
    expect(proxy.status().connections).toBe(2);
  } finally {
    connector.mockRestore(); await Promise.all(clients.map(client => client.disconnect()));
    await proxy.close(); ws.clients.forEach(socket => socket.terminate());
    await new Promise<void>(resolve => ws.close(() => resolve()));
    await new Promise<void>(resolve => server.close(() => resolve()));
    fixture.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
