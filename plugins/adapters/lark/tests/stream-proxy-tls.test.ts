import https from 'node:https';
import tls from 'node:tls';
import { once } from 'node:events';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocketServer } from 'ws';
import { createLarkStreamAgent } from '../src/stream-proxy.js';
import { WSClient, LoggerLevel } from '@larksuiteoapi/node-sdk';
import { createTcpFaultProxy } from '../../../../scripts/platform-acceptance/tcp-fault-proxy.mjs';

it('real Lark SDK routes WSS via loopback agent and reopens after cut while discovery remains separate', async () => {
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
    const discovery = vi.fn(async () => ({ code: 0, data: { URL: url + '&device_id=fixture&service_id=1', ClientConfig: { PingInterval: 60, ReconnectCount: 0, ReconnectInterval: 1, ReconnectNonce: 0 } } }));
    const agents = [];
    const create = async () => {
      const agent = createLarkStreamAgent({ port: proxy.port, serverName: 'gateway.test' }); agents.push(agent);
      let resolveReady!: () => void;
      const ready = new Promise<void>(resolve => { resolveReady = resolve; });
      const client = new WSClient({ appId: 'cli_0123456789abcdef', appSecret: 'fixture', agent, autoReconnect: false, loggerLevel: LoggerLevel.error,
        httpInstance: { request: discovery } as never, onReady: resolveReady });
      clients.push(client);
      await client.start({ eventDispatcher: { invoke: vi.fn() } as never }); await ready;
      return client;
    };
    const first = await create();
    expect(connector).toHaveBeenCalledWith(expect.objectContaining({ host: '127.0.0.1', port: proxy.port, servername: 'gateway.test', rejectUnauthorized: true, path: undefined }));
    expect(discovery.mock.calls).toHaveLength(1);
    const peerClosed = Promise.all([...ws.clients].map(peer => once(peer, 'close')));
    proxy.cut(); await peerClosed;
    first.close({ force: true });
    proxy.recover();
    await create();
    expect(discovery.mock.calls).toHaveLength(2);
    agents.forEach(agent => agent.destroy());
    expect(proxy.status().connections).toBe(2);
  } finally {
    connector.mockRestore(); clients.forEach(client => client.close({ force: true }));
    await proxy.close(); ws.clients.forEach(socket => socket.terminate());
    await new Promise<void>(resolve => ws.close(() => resolve()));
    await new Promise<void>(resolve => server.close(() => resolve()));
    rmSync(directory, { recursive: true, force: true });
  }
});

it('real SDK catches mismatched gateway identity without opening any TLS socket', async () => {
  const agent = createLarkStreamAgent({ port: 18443, serverName: 'placeholder.invalid' });
  const connector = vi.spyOn(tls, 'connect');
  let failed!: () => void;
  const failure = new Promise<void>(resolve => { failed = resolve; });
  const client = new WSClient({ appId: 'cli_0123456789abcdef', appSecret: 'fixture', agent, autoReconnect: false, loggerLevel: LoggerLevel.error,
    onError: failed, httpInstance: { request: async () => ({ code: 0, data: { URL: 'wss://gateway.test/callback?ticket=fixture&service_id=1&device_id=fixture', ClientConfig: { PingInterval: 60, ReconnectCount: 0, ReconnectInterval: 1, ReconnectNonce: 0 } } }) } as never });
  try {
    await client.start({ eventDispatcher: { invoke: vi.fn() } as never });
    await failure;
    expect(connector).not.toHaveBeenCalled();
    expect(client.getConnectionStatus().state).not.toBe('connected');
  } finally { client.close({ force: true }); agent.destroy(); connector.mockRestore(); }
});
