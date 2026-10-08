import http from 'node:http';
import { once } from 'node:events';
import { RuntimeKookClient } from '../src/ws.js';
import { sendKookOutbound } from '../src/outbound.js';

it.each(['lost', '500', '500-denied', '501', '408', '403', 'denied'] as const)('actual KOOK axios SDK sends once and classifies %s', async mode => {
  let calls = 0;
  const server = http.createServer((request, response) => {
    calls++; request.resume();
    if (mode === 'lost') { request.socket.destroy(); return; }
    response.statusCode = mode === 'denied' ? 200 : parseInt(mode);
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify(mode === 'denied' || mode === '500-denied' ? { code: 40003, message: 'fixture denied' } : {}));
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const client = new RuntimeKookClient({ token: 'fixture-only', mode: 'websocket', logLevel: 'off' });
  client.channels.set('fixture', { id: 'fixture' } as never);
  client.request.defaults.baseURL = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  try {
    await expect(sendKookOutbound(client, { conversation: { endpoint: { id: 'test', adapter: 'kook' }, kind: 'channel', id: 'fixture' }, payload: 'fixture' })).rejects.toMatchObject({ disposition: mode === '403' || mode === 'denied' ? 'rejected' : 'unknown' });
    expect(calls).toBe(1);
  } finally { await client.disconnect(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});
