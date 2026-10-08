import https from 'node:https';
import tls from 'node:tls';
import { once } from 'node:events';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocketServer, type WebSocket } from 'ws';
import { createKookStreamSocket } from '../src/stream-proxy.js';
import { RuntimeKookClient } from '../src/ws.js';
import { WebsocketReceiver } from 'kook-client';
import { createTcpFaultProxy } from '../../../../scripts/platform-acceptance/tcp-fault-proxy.mjs';

it('same Runtime client replays only after resume ACK, resets rejected sessions, and stops pending resume', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'zhin-ding-wss-'));
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-keyout', join(directory, 'key.pem'), '-out', join(directory, 'cert.pem'), '-subj', '/CN=gateway.test', '-addext', 'subjectAltName=DNS:gateway.test'], { stdio: 'ignore' });
  const ca = readFileSync(join(directory, 'cert.pem'));
  const server = https.createServer({ key: readFileSync(join(directory, 'key.pem')), cert: ca });
  const ws = new WebSocketServer({ server });
  const peers: WebSocket[] = []; const urls: URL[] = []; const pings: number[][] = [];
  ws.on('connection', (socket, request) => {
    peers.push(socket); urls.push(new URL(request.url!, 'https://gateway.test')); const seen: number[] = []; pings.push(seen);
    socket.send(JSON.stringify({ s: 1, d: { code: 0, session_id: 'fixture' } }));
    socket.on('message', bytes => { const data = JSON.parse(bytes.toString()); if (data.s === 2) { seen.push(data.sn); socket.send(JSON.stringify({ s: 3 })); } });
  });
  const until = async (check: () => boolean) => { for (let i = 0; i < 500; i++) { if (check()) return; await new Promise(resolve => setTimeout(resolve, 5)); } throw new Error('fixture wait timeout'); };
  const event = (socket: WebSocket, sn: number) => socket.send(JSON.stringify({ s: 0, sn, d: { channel_type: 'GROUP', type: 1, target_id: 'channel', author_id: 'actor', content: 'fixture', msg_id: `id-${sn}`, msg_timestamp: sn, extra: { type: 1, author: { id: 'actor', nickname: 'fixture', bot: false } } } }));
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const proxy = await createTcpFaultProxy({ upstreamHost: '127.0.0.1', upstreamPort: (server.address() as { port: number }).port, port: 0, controlPort: 0 });
  const original = tls.connect.bind(tls);
  // Trust only the test CA. The actual ws connector still decides routing/SNI/verification.
  const connector = vi.spyOn(tls, 'connect').mockImplementation(options => original({ ...options as tls.ConnectionOptions, ca }));
  const client = new RuntimeKookClient({ token: 'fixture', mode: 'websocket', logLevel: 'off', socketFactory: (target: string) => createKookStreamSocket(target, { port: proxy.port, serverName: 'gateway.test' }) }, { name: 'kook-fixture', reconnect: { initialIntervalMs: 20, maxIntervalMs: 20, jitterMs: 0 } });
  const discovery = vi.spyOn(client.request, 'get').mockResolvedValue({ data: { url: 'wss://gateway.test/?ticket=fixture' } });
  const init = vi.spyOn(client, 'init').mockResolvedValue(undefined);
  const receiver = client.receiver as WebsocketReceiver;
  const sequence: number[] = []; const messages: unknown[] = [];
  receiver.on('event', () => sequence.push(receiver.sn)); client.on('message.channel', message => messages.push(message));
  try {
    await client.connect(); event(peers[0]!, 1); event(peers[0]!, 2); await until(() => sequence.length === 2);
    proxy.cut(); await until(() => client.getTransportState() !== 'open'); proxy.recover(); await until(() => peers.length === 2);
    expect(urls[1]!.searchParams.get('sn')).toBe('2'); expect(urls[1]!.searchParams.get('resume')).toBe('1');
    event(peers[1]!, 3); event(peers[1]!, 3); await new Promise(resolve => setTimeout(resolve, 30));
    expect(sequence).toEqual([1, 2]); expect(messages).toHaveLength(2); expect(client.getTransportState()).not.toBe('open');
    peers[1]!.send(JSON.stringify({ s: 6, d: { session_id: 'fixture' } })); await until(() => client.getTransportState() === 'open');
    expect(sequence).toEqual([1, 2, 3]); expect(messages).toHaveLength(3); expect(init).toHaveBeenCalledTimes(1);
    event(peers[1]!, 5); event(peers[1]!, 4); event(peers[1]!, 4); await until(() => sequence.length === 5);
    peers[1]!.send(JSON.stringify({ s: 5, d: { code: 40108 } })); await until(() => peers.length === 3 && client.getTransportState() === 'open' && pings[2]!.length > 0);
    expect(urls[2]!.searchParams.has('resume')).toBe(false); expect(pings[2]![0]).toBe(0); expect(discovery).toHaveBeenCalledTimes(2); expect(init).toHaveBeenCalledTimes(2);
    event(peers[2]!, 1); await until(() => sequence.length === 6); expect(sequence).toEqual([1, 2, 3, 4, 5, 1]);
    proxy.cut(); await until(() => client.getTransportState() !== 'open'); proxy.recover(); await until(() => peers.length === 4);
    event(peers[3]!, 2); await new Promise(resolve => setTimeout(resolve, 30)); await client.disconnect();
    expect(client.getTransportState()).toBe('stopped'); expect(receiver.sn).toBe(1); expect(sequence).toHaveLength(6);
    expect((receiver as unknown as { cancelResume: unknown; resumeEvents: unknown[] }).cancelResume).toBeNull();
    expect((receiver as unknown as { resumeEvents: unknown[] }).resumeEvents).toEqual([]);
    await new Promise(resolve => setTimeout(resolve, 50)); expect(peers).toHaveLength(4);
    expect(connector).toHaveBeenCalledWith(expect.objectContaining({ host: '127.0.0.1', port: proxy.port, servername: 'gateway.test', rejectUnauthorized: true }));
  } finally {
    connector.mockRestore(); await client.disconnect();
    await proxy.close(); ws.clients.forEach(socket => socket.terminate());
    await new Promise<void>(resolve => ws.close(() => resolve()));
    await new Promise<void>(resolve => server.close(() => resolve()));
    rmSync(directory, { recursive: true, force: true });
  }
});
