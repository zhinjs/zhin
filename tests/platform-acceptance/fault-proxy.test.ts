import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { once } from 'node:events';
import { createFaultProxy } from '../../scripts/platform-acceptance/fault-proxy.mjs';

// Reuse an existing workspace transport dependency; the proxy itself uses only Node built-ins.
const { WebSocket, WebSocketServer } = createRequire(new URL('../../plugins/adapters/napcat/package.json', import.meta.url))('ws');

async function listen(server: ReturnType<typeof createServer>) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return `http://127.0.0.1:${(server.address() as { port: number }).port}`;
}

async function stop(server: ReturnType<typeof createServer>) {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

describe('isolated platform fault proxy', () => {
  it.each(['headers', 'body'] as const)('preserves HTTP path/query, cuts pending %s, and restores only new requests', async (phase) => {
    const paths: string[] = [];
    let pendingReached!: () => void;
    const pendingAtUpstream = new Promise<void>((resolve) => { pendingReached = resolve; });
    const server = createServer((request, response) => {
      paths.push(request.url!);
      if (request.url!.startsWith('/pending')) {
        if (phase === 'body') { response.writeHead(200); response.write('partial'); }
        pendingReached(); return;
      }
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ ok: true, result: request.url }));
    });
    const upstream = await listen(server);
    const proxy = await createFaultProxy({ upstream, port: 0, controlPort: 0 });
    try {
      expect(proxy.origin).toMatch(/^http:\/\/127\.0\.0\.1:/);
      expect(proxy.controlOrigin).toMatch(/^http:\/\/127\.0\.0\.1:/);
      const path = '/botTEST/getUpdates?offset=123&timeout=30';
      expect(await (await fetch(`${proxy.origin}${path}`)).json()).toMatchObject({ result: path });
      const pending = fetch(`${proxy.origin}/pending?update=124`).then((response) => response.text());
      const interrupted = expect(pending).rejects.toThrow();
      await pendingAtUpstream;
      expect((await (await fetch(`${proxy.controlOrigin}/cut`, { method: 'POST' })).json()).state).toBe('cut');
      await interrupted;
      await expect(fetch(`${proxy.origin}/blocked`)).rejects.toThrow();
      expect(paths).not.toContain('/blocked');
      const controlStatus = await (await fetch(`${proxy.controlOrigin}/status`)).json();
      expect(controlStatus).toMatchObject({ state: 'cut', acceptedRequests: 2, cuts: 1 });
      expect(JSON.stringify(controlStatus)).not.toContain('botTEST');
      await fetch(`${proxy.controlOrigin}/recover`, { method: 'POST' });
      expect(await (await fetch(`${proxy.origin}/recovered?sample=new`)).json()).toMatchObject({ result: '/recovered?sample=new' });
      expect(paths).toEqual([path, '/pending?update=124', '/recovered?sample=new']);
    } finally {
      await proxy.close();
      await proxy.close();
      await stop(server);
    }
    expect(proxy.status()).toMatchObject({ state: 'closed', activeSockets: 0 });
  });

  it('transparently forwards WS upgrades/frames and destroys both sides on cut', async () => {
    const server = createServer();
    const upstream = await listen(server);
    const sockets = new WebSocketServer({ server });
    const paths: string[] = [];
    sockets.on('connection', (socket, request) => {
      paths.push(request.url);
      socket.on('message', (data, binary) => socket.send(data, { binary }));
    });
    const proxy = await createFaultProxy({ upstream: upstream.replace('http:', 'ws:'), port: 0, controlPort: 0 });
    let client;
    let recovered;
    try {
      client = new WebSocket(`${proxy.origin.replace('http:', 'ws:')}/ws?endpoint=test-a`);
      await once(client, 'open');
      const echo = once(client, 'message');
      client.send('baseline');
      expect(String((await echo)[0])).toBe('baseline');
      const binaryEcho = once(client, 'message');
      client.send(Buffer.from([0, 255, 1]));
      expect((await binaryEcho)[0]).toEqual(Buffer.from([0, 255, 1]));
      const closed = once(client, 'close');
      await fetch(`${proxy.controlOrigin}/cut`, { method: 'POST' });
      await closed;
      await vi.waitFor(() => expect(sockets.clients.size).toBe(0));
      await vi.waitFor(() => expect(proxy.status().activeSockets).toBe(0));
      const blocked = new WebSocket(`${proxy.origin.replace('http:', 'ws:')}/ws?endpoint=blocked`);
      await once(blocked, 'error');
      expect(paths).toEqual(['/ws?endpoint=test-a']);
      await fetch(`${proxy.controlOrigin}/recover`, { method: 'POST' });
      recovered = new WebSocket(`${proxy.origin.replace('http:', 'ws:')}/ws?endpoint=test-b`);
      await once(recovered, 'open');
      const restoredEcho = once(recovered, 'message');
      recovered.send('restored');
      expect(String((await restoredEcho)[0])).toBe('restored');
      expect(paths).toEqual(['/ws?endpoint=test-a', '/ws?endpoint=test-b']);
    } finally {
      client?.terminate();
      recovered?.terminate();
      await proxy.close();
      for (const socket of sockets.clients) socket.terminate();
      await new Promise<void>((resolve) => sockets.close(() => resolve()));
      await stop(server);
    }
    expect(proxy.status()).toMatchObject({ state: 'closed', activeSockets: 0 });
  });

  it('rejects credential/path-bearing upstream configuration without retaining it', async () => {
    for (const upstream of ['https://user:password@test.invalid', 'https://test.invalid/botSECRET', 'https://test.invalid?token=SECRET']) {
      await expect(createFaultProxy({ upstream, port: 0, controlPort: 0 })).rejects.toThrow('origin without credentials, path or query');
    }
  });

  it('cleans its first listener up if the control port is already occupied', async () => {
    const occupied = createServer();
    const upstream = await listen(occupied);
    try {
      await expect(createFaultProxy({ upstream, port: 0, controlPort: (occupied.address() as { port: number }).port }))
        .rejects.toThrow('Could not bind fault proxy');
    } finally { await stop(occupied); }
  });
});

it('Discord Gateway mode rejects HTTP and arbitrary websocket destinations without making upstream connections', async () => {
  const proxy = await createFaultProxy({ discordGateway: true, port: 0, controlPort: 0 });
  try {
    await expect(fetch(`${proxy.origin}/__discord_gateway/gateway.discord.gg`)).rejects.toThrow();
    const socket = new WebSocket(`${proxy.origin.replace('http:', 'ws:')}/__discord_gateway/evil.example?v=10`);
    socket.on('error', () => {}); await new Promise<void>(resolve => socket.once('close', resolve));
    expect(proxy.status().activeSockets).toBe(0);
  } finally { await proxy.close(); }
});
