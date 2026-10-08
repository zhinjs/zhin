import https from 'node:https';
import tls from 'node:tls';
import { once } from 'node:events';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocketServer } from 'ws';
import { createSlackStreamAgent } from '../src/stream-proxy.js';
import { SocketModeClient } from '@slack/socket-mode';
import { createTcpFaultProxy } from '../../../../scripts/platform-acceptance/tcp-fault-proxy.mjs';

it('real Slack SDK routes WSS via loopback agent and reopens after cut while discovery remains separate', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'zhin-ding-wss-'));
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-keyout', join(directory, 'key.pem'), '-out', join(directory, 'cert.pem'), '-subj', '/CN=gateway.test', '-addext', 'subjectAltName=DNS:gateway.test'], { stdio: 'ignore' });
  const ca = readFileSync(join(directory, 'cert.pem'));
  const server = https.createServer({ key: readFileSync(join(directory, 'key.pem')), cert: ca });
  const ws = new WebSocketServer({ server });
  ws.on('connection', socket => { socket.send(JSON.stringify({ type: 'hello', connection_info: { app_id: 'fixture' } })); });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const proxy = await createTcpFaultProxy({ upstreamHost: '127.0.0.1', upstreamPort: (server.address() as { port: number }).port, port: 0, controlPort: 0 });
  const original = tls.connect.bind(tls);
  // Trust only the test CA. The actual ws connector still decides routing/SNI/verification.
  const connector = vi.spyOn(tls, 'connect').mockImplementation(options => original({ ...options as tls.ConnectionOptions, ca }));
  const clients = [];
  try {
    const url = 'wss://gateway.test/callback?ticket=fixture-private';
    const discovery = vi.fn(async () => url);
    const agents = [];
    const create = async () => {
      const agent = createSlackStreamAgent({ port: proxy.port, serverName: 'gateway.test' }); agents.push(agent);
      const client = new SocketModeClient({ appToken: 'xapp-fixture', autoReconnectEnabled: false, clientOptions: { agent } });
      vi.spyOn(client as unknown as { retrieveWSSURL(): Promise<string> }, 'retrieveWSSURL').mockImplementation(discovery);
      client.on('error', () => {});
      clients.push(client);
      await client.start();
      return client;
    };
    const first = await create();
    expect(connector).toHaveBeenCalledWith(expect.objectContaining({ host: '127.0.0.1', port: proxy.port, servername: 'gateway.test', rejectUnauthorized: true, path: undefined }));
    expect(discovery.mock.calls).toHaveLength(1);
    const peerClosed = Promise.all([...ws.clients].map(peer => once(peer, 'close')));
    proxy.cut(); await peerClosed;
    await first.disconnect();
    proxy.recover();
    await create();
    expect(discovery.mock.calls).toHaveLength(2);
    agents.forEach(agent => agent.destroy());
    expect(proxy.status().connections).toBe(2);
  } finally {
    connector.mockRestore(); await Promise.all(clients.map(client => client.disconnect()));
    await proxy.close(); ws.clients.forEach(socket => socket.terminate());
    await new Promise<void>(resolve => ws.close(() => resolve()));
    await new Promise<void>(resolve => server.close(() => resolve()));
    rmSync(directory, { recursive: true, force: true });
  }
});

