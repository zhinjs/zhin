import https from 'node:https';
import { once } from 'node:events';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, cpSync, symlinkSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { createEndpointLifecycle } from 'zhin.js/adapter';
import { createQqStreamAgent } from '../src/stream-proxy.js';
import { createTcpFaultProxy } from '../../../../scripts/platform-acceptance/tcp-fault-proxy.mjs';

function sdkFixture(directory: string) {
  const require = createRequire(import.meta.url);
  const root = dirname(require.resolve('qq-official-bot/package.json'));
  cpSync(join(root, 'lib'), join(directory, 'lib'), { recursive: true });
  symlinkSync(resolve(root, '..'), join(directory, 'node_modules'), 'dir');
  const patch = readFileSync(resolve(import.meta.dirname, '../../../../patches/qq-official-bot@1.3.0.patch'), 'utf8');
  // Existing installed fixes stay intact; apply only the new scoped extension before parent install.
  const section = patch.split(/(?=^--- a\/)/m).find(section => section.includes('Optional instance-scoped transport extension'))!;
  if (!readFileSync(join(directory, 'lib/receivers/websocket.js'), 'utf8').includes('Optional instance-scoped transport extension')) execFileSync('patch', ['-p1'], { cwd: directory, input: section });
  const botSection = patch.split(/(?=^--- a\/)/m).find(section => section.includes('Composition roots own process errors'))!;
  if (!readFileSync(join(directory, 'lib/bot.js'), 'utf8').includes('Composition roots own process errors')) execFileSync('patch', ['-p1'], { cwd: directory, input: botSection });
  return { Bot: require(join(directory, 'lib/bot.js')).Bot, WebSocketServer: require('ws').WebSocketServer };
}

it('real SDK keeps verified WSS identity through loopback cut/recover with one lifecycle reconnect owner', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'qq-wss-'));
  const { Bot, WebSocketServer } = sdkFixture(directory);
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-keyout', join(directory, 'key.pem'), '-out', join(directory, 'cert.pem'), '-subj', '/CN=gateway.test', '-addext', 'subjectAltName=DNS:gateway.test'], { stdio: 'ignore' });
  const ca = readFileSync(join(directory, 'cert.pem'));
  const server = https.createServer({ key: readFileSync(join(directory, 'key.pem')), cert: ca });
  const ws = new WebSocketServer({ server });
  const hosts: string[] = []; const sni: string[] = [];
  server.on('secureConnection', socket => sni.push(socket.servername));
  ws.on('connection', (socket: any, request: any) => {
    hosts.push(request.headers.host);
    socket.send(JSON.stringify({ op: 10, d: { heartbeat_interval: 60_000 } }));
    socket.on('message', (data: Buffer) => {
      const packet = JSON.parse(data.toString());
      if (packet.op === 2) socket.send(JSON.stringify({ op: 0, t: 'READY', s: 1, d: { session_id: 'fixture-session', user: { id: 'fixture-bot', username: 'fixture' } } }));
      if (packet.op === 1) socket.send(JSON.stringify({ op: 11 }));
    });
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const proxy = await createTcpFaultProxy({ upstreamHost: '127.0.0.1', upstreamPort: (server.address() as { port: number }).port, port: 0, controlPort: 0 });
  const lifecycle = createEndpointLifecycle({ name: 'fixture', reconnect: { initialIntervalMs: 20, jitterMs: 0 } });
  const gateway = vi.fn(async () => 'wss://gateway.test/gateway?private=fixture');
  const bots: any[] = []; const agents: ReturnType<typeof createQqStreamAgent>[] = [];
  try {
    await lifecycle.start(async handle => {
      const bot = new Bot({ appid: 'fixture', secret: 'fixture', mode: 'websocket', logLevel: 'off', handleProcessErrors: false }); bots.push(bot);
      bot.sessionManager.getAccessToken = async () => 'fixture'; bot.sessionManager.getWsUrl = gateway;
      const agent = createQqStreamAgent({ port: proxy.port, serverName: 'gateway.test' }); agents.push(agent);
      agent.options.ca = ca;
      bot.receiver.config.agent = agent; bot.receiver.config.autoReconnect = false;
      bot.receiver.on('error', () => {});
      const cleanup = async () => { await bot.stop(); bot.sessionManager.authManager.destroy(); agent.destroy(); };
      handle.onForceClose(() => { void cleanup(); });
      bot.receiver.once('close', () => { void cleanup(); handle.notifyClosed(); });
      await bot.start();
    });
    expect(lifecycle.state).toBe('open');
    expect(hosts).toEqual(['gateway.test']); expect(sni).toEqual(['gateway.test']);
    const firstClosed = once(bots[0].receiver, 'close');
    proxy.cut(); await firstClosed;
    expect(lifecycle.state).toBe('reconnecting');
    proxy.recover();
    await vi.waitFor(() => expect(gateway).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(lifecycle.state).toBe('open'));
    expect(hosts).toEqual(['gateway.test', 'gateway.test']); expect(sni).toEqual(['gateway.test', 'gateway.test']);
    expect(proxy.status().connections).toBe(2);
    expect(bots[0].receiver.retryCount).toBe(0);
    await lifecycle.stop();
    await new Promise(done => setTimeout(done, 50));
    expect(gateway).toHaveBeenCalledTimes(2);
  } finally {
    await lifecycle.stop();
    for (const bot of bots) { await bot.stop(); bot.sessionManager.authManager.destroy(); }
    agents.forEach(agent => agent.destroy()); await proxy.close();
    ws.clients.forEach((socket: any) => socket.terminate());
    await new Promise<void>(done => ws.close(done)); await new Promise<void>(done => server.close(() => done()));
    rmSync(directory, { recursive: true, force: true });
  }
});
it('rejects changed gateway identity before creating any socket or bypassing proxy', () => {
  const agent = createQqStreamAgent({ port: 18443, serverName: 'placeholder.invalid' });
  try { expect(() => agent.createConnection({ host: 'gateway.test', port: 443 })).toThrow('gateway identity changed'); }
  finally { agent.destroy(); }
});

it('real SDK opt-out does not accumulate process handlers across Bot construction', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'qq-process-owner-'));
  const { Bot } = sdkFixture(directory);
  const before = { exception: process.listeners('uncaughtException'), rejection: process.listeners('unhandledRejection') };
  try {
    for (let count = 0; count < 3; count++) {
      const bot = new Bot({ appid: 'fixture', secret: 'fixture', mode: 'websocket', logLevel: 'off', handleProcessErrors: false });
      await bot.stop(); bot.sessionManager.authManager.destroy();
    }
    expect(process.listeners('uncaughtException')).toEqual(before.exception);
    expect(process.listeners('unhandledRejection')).toEqual(before.rejection);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
