import http from 'node:http';
import { once } from 'node:events';
import type { Client } from 'discord.js';
import { defaultCreateClient } from '../src/gateway.js';

it.each(['lost', '500', '429', 'denied'] as const)('actual Discord REST sends exactly one POST for %s', async mode => {
  let calls = 0;
  const server = http.createServer((request, response) => {
    calls++; request.resume();
    if (mode === 'lost') { request.socket.destroy(); return; }
    response.statusCode = mode === '500' ? 500 : mode === '429' ? 429 : 403;
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify(mode === '429' ? { retry_after: 0.01, global: false } : { code: 50013, message: 'fixture denied' }));
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const client = defaultCreateClient([], undefined, { api: `http://127.0.0.1:${(server.address() as { port: number }).port}`, timeout: 1000 }) as unknown as Client;
  client.rest.setToken('fixture-only');
  try {
    await expect(client.rest.post('/channels/fixture/messages', { body: { content: 'fixture' } })).rejects.toBeDefined();
    expect(calls).toBe(1);
    await new Promise(resolve => setTimeout(resolve, 30)); expect(calls).toBe(1);
  } finally { await client.destroy(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});
