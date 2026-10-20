import https from 'node:https';
import tls from 'node:tls';
import { once } from 'node:events';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocketServer } from 'ws';
import { createDingTalkStreamSocket } from '../src/stream-proxy.js';
import { createTcpFaultProxy } from '../../../../scripts/platform-acceptance/tcp-fault-proxy.mjs';

it('real ws invokes loopback TLS connector, validates identity and loses/reopens transport on proxy cut/recover', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'zhin-ding-wss-'));
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-keyout', join(directory, 'key.pem'), '-out', join(directory, 'cert.pem'), '-subj', '/CN=gateway.test', '-addext', 'subjectAltName=DNS:gateway.test'], { stdio: 'ignore' });
  const ca = readFileSync(join(directory, 'cert.pem'));
  const server = https.createServer({ key: readFileSync(join(directory, 'key.pem')), cert: ca });
  const ws = new WebSocketServer({ server });
  ws.on('connection', socket => socket.on('message', data => socket.send(data)));
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const proxy = await createTcpFaultProxy({ upstreamHost: '127.0.0.1', upstreamPort: (server.address() as { port: number }).port, port: 0, controlPort: 0 });
  const original = tls.connect.bind(tls);
  // Trust only the test CA. The actual ws connector still decides routing/SNI/verification.
  const connector = vi.spyOn(tls, 'connect').mockImplementation(options => original({ ...options as tls.ConnectionOptions, ca }));
  const clients = [];
  try {
    const url = 'wss://gateway.test/callback?ticket=fixture-private';
    const create = () => createDingTalkStreamSocket(url, { port: proxy.port, serverName: 'gateway.test' });
    const first = create(); clients.push(first); await once(first, 'open');
    expect(connector).toHaveBeenCalledWith(expect.objectContaining({ host: '127.0.0.1', port: proxy.port, servername: 'gateway.test', rejectUnauthorized: true, path: undefined }));
    const frame = once(first, 'message'); first.send('fixture'); expect((await frame)[0].toString()).toBe('fixture');
    const closed = once(first, 'close'); proxy.cut(); await closed;
    proxy.recover();
    const second = create(); clients.push(second); await once(second, 'open');
    const after = once(second, 'message'); second.send('after'); expect((await after)[0].toString()).toBe('after');
    expect(proxy.status().connections).toBe(2);
  } finally {
    connector.mockRestore(); clients.forEach(socket => socket.terminate());
    await proxy.close(); ws.clients.forEach(socket => socket.terminate());
    await new Promise<void>(resolve => ws.close(() => resolve()));
    await new Promise<void>(resolve => server.close(() => resolve()));
    rmSync(directory, { recursive: true, force: true });
  }
});
