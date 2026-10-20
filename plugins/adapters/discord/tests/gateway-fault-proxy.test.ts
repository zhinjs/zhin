import { createRequire } from 'node:module';
import { once } from 'node:events';
import { WebSocketManager, WebSocketShardEvents } from '@discordjs/ws';
import { DiscordFaultProxyStrategy, canonicalDiscordGatewayURL, discordGatewayProxyURL, validateDiscordGatewayFaultProxy } from '../src/gateway-fault-proxy.js';

it.each(['wss://127.0.0.1:1234/', 'ws://localhost:1234/', 'ws://127.0.0.1:1234/path', 'ws://user:secret@127.0.0.1:1234/'])('rejects a proxy outside the fixed loopback origin: %s', value => {
  expect(() => validateDiscordGatewayFaultProxy(value)).toThrow();
});
it.each(['ws://gateway.discord.gg/', 'wss://evil.example/', 'wss://gateway.discord.gg.evil.example/', 'wss://gateway.discord.gg:8443/', 'wss://secret@gateway.discord.gg/', 'wss://gateway.discord.gg/path'])('rejects unsafe upstream: %s', value => {
  expect(() => discordGatewayProxyURL('ws://127.0.0.1:1234/', value)).toThrow();
});
it('real installed SDK resumes through the same loopback proxy using the platform regional gateway and destroys cleanly', async () => {
  const require = createRequire(import.meta.url); const { WebSocketServer } = require('ws');
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 }); await once(server, 'listening');
  const port = server.address().port; const paths: string[] = []; let identified = 0; let resumed = 0;
  const sessionStore = new Map(); let resumeDone!: () => void; const resume = new Promise<void>(resolve => { resumeDone = resolve; });
  server.on('connection', (socket: any, request: any) => {
    paths.push(request.url); socket.send(JSON.stringify({ op: 10, d: { heartbeat_interval: 60_000 } }));
    socket.on('message', (raw: Buffer) => {
      const packet = JSON.parse(raw.toString());
      if (packet.op === 2) { identified++; socket.send(JSON.stringify({ op: 0, t: 'READY', s: 1, d: { v: 10, session_id: 'fixture-session', resume_gateway_url: 'wss://gateway-us-east1-b.discord.gg/?v=10&encoding=json', guilds: [], user: { id: 'fixture' }, application: { id: 'fixture' } } })); }
      if (packet.op === 6) { resumed++; socket.send(JSON.stringify({ op: 0, t: 'RESUMED', s: 2, d: {} })); resumeDone(); }
      if (packet.op === 1) socket.send(JSON.stringify({ op: 11, d: null }));
    });
  });
  const manager = new WebSocketManager({ token: 'fixture-token', intents: 0, shardIds: [0], shardCount: 1,
    rest: { get: async () => ({ url: 'wss://gateway.discord.gg/', shards: 1, session_start_limit: { total: 100, remaining: 100, reset_after: 60_000, max_concurrency: 1 } }) } as never,
    retrieveSessionInfo: id => sessionStore.get(id) ?? null, updateSessionInfo: (id, value) => { sessionStore.set(id, value); },
    buildStrategy: manager => new DiscordFaultProxyStrategy(manager, `ws://127.0.0.1:${port}/`),
  });
  manager.on(WebSocketShardEvents.Error, () => {});
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await manager.connect();
    for (const socket of server.clients) { socket.send(JSON.stringify({ op: 0, t: 'GUILD_CREATE', s: 2, d: {} })); socket.send(JSON.stringify({ op: 0, t: 'MESSAGE_CREATE', s: 3, d: {} })); }
    await vi.waitFor(() => expect(sessionStore.get(0).sequence).toBe(3));
    expect(sessionStore.get(0).resumeURL).toMatch(/^wss:\/\/gateway-us-east1-b\.discord\.gg\//);
    for (const socket of server.clients) socket.terminate();
    await Promise.race([resume, new Promise((_, reject) => timeout = setTimeout(() => reject(new Error('resume timed out')), 3000))]);
    expect(identified).toBe(1); expect(resumed).toBe(1);
    for (const socket of server.clients) { socket.send(JSON.stringify({ op: 0, t: 'MESSAGE_CREATE', s: 4, d: {} })); socket.send(JSON.stringify({ op: 0, t: 'MESSAGE_CREATE', s: 5, d: {} })); }
    await vi.waitFor(() => expect(sessionStore.get(0).sequence).toBe(5));
    expect(sessionStore.get(0).resumeURL).toBe('wss://gateway-us-east1-b.discord.gg/');
    expect(paths[0]).toMatch(/^\/__discord_gateway\/gateway\.discord\.gg\?/);
    expect(paths[1]).toMatch(/^\/__discord_gateway\/gateway-us-east1-b\.discord\.gg\?/);
    expect(paths.every(path => path.includes('v=10') && path.includes('encoding=json'))).toBe(true);
  } finally { if (timeout) clearTimeout(timeout); await manager.destroy(); for (const socket of server.clients) socket.terminate(); await new Promise<void>(resolve => server.close(resolve)); }
});

it('restores only this proxy route and accepts only official protocol query parameters', () => {
  const proxy = 'ws://127.0.0.1:1234/';
  expect(canonicalDiscordGatewayURL(proxy, 'ws://127.0.0.1:1234/__discord_gateway/gateway-us-east1-b.discord.gg')).toBe('wss://gateway-us-east1-b.discord.gg/');
  expect(discordGatewayProxyURL(proxy, 'wss://gateway.discord.gg/?v=10&encoding=json&compress=zlib-stream')).toBe('ws://127.0.0.1:1234/__discord_gateway/gateway.discord.gg');
  for (const value of ['ws://127.0.0.1:1235/__discord_gateway/gateway.discord.gg', 'ws://127.0.0.1:1234/__discord_gateway/evil.example', 'wss://gateway.discord.gg/?token=SECRET']) expect(() => canonicalDiscordGatewayURL(proxy, value)).toThrow();
});

it('invalid READY resume host rejects connection and closes without an unhandled SDK event rejection', async () => {
  const require = createRequire(import.meta.url); const { WebSocketServer } = require('ws');
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 }); await once(server, 'listening');
  server.on('connection', (socket: any) => { socket.send(JSON.stringify({ op: 10, d: { heartbeat_interval: 60_000 } })); socket.on('message', (raw: Buffer) => { if (JSON.parse(raw.toString()).op === 2) socket.send(JSON.stringify({ op: 0, t: 'READY', s: 1, d: { session_id: 'fixture', resume_gateway_url: 'wss://evil.example/?token=SECRET' } })); }); });
  const manager = new WebSocketManager({ token: 'fixture', intents: 0, shardIds: [0], shardCount: 1, rest: { get: async () => ({ url: 'wss://gateway.discord.gg/', shards: 1, session_start_limit: { total: 100, remaining: 100, reset_after: 60_000, max_concurrency: 1 } }) } as never, retrieveSessionInfo: () => null, updateSessionInfo: vi.fn(), buildStrategy: manager => new DiscordFaultProxyStrategy(manager, `ws://127.0.0.1:${server.address().port}/`) });
  const errors = vi.fn(); manager.on(WebSocketShardEvents.Error, errors);
  try {
    await expect(manager.connect()).rejects.toThrow('Invalid Discord gateway session');
    await vi.waitFor(() => expect(server.clients.size).toBe(0));
    expect(errors).toHaveBeenCalled(); expect(JSON.stringify(errors.mock.calls)).not.toContain('SECRET');
  } finally { await manager.destroy(); for (const socket of server.clients) socket.terminate(); await new Promise<void>(resolve => server.close(resolve)); }
});
