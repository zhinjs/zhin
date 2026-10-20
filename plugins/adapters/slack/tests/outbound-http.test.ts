import http from 'node:http';
import { once } from 'node:events';
import { createSlackWebClient, slackDeliveryError } from '../src/web-client.js';

it.each(['lost', '500', '429', 'denied'] as const)('actual Slack SDK sends one POST for %s and preserves outcome', async mode => {
  let calls = 0;
  const server = http.createServer((request, response) => {
    calls++;
    request.resume();
    if (mode === 'lost') { request.socket.destroy(); return; }
    response.statusCode = mode === '500' ? 500 : mode === '429' ? 429 : 200;
    response.setHeader('Content-Type', 'application/json');
    if (mode === '429') response.setHeader('Retry-After', '0');
    response.end(JSON.stringify({ ok: false, error: 'channel_not_found' }));
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const client = createSlackWebClient('fixture-only', { slackApiUrl: `http://127.0.0.1:${(server.address() as { port: number }).port}/api/`, logger: { debug() {}, info() {}, warn() {}, error() {}, setLevel() {}, getLevel() { return 'error'; }, setName() {} } as never });
  try {
    const error = await client.chat.postMessage({ channel: 'fixture', text: 'fixture' }).catch(error => error);
    expect(slackDeliveryError(error)).toMatchObject({ disposition: mode === 'lost' || mode === '500' ? 'unknown' : 'rejected' });
    expect(calls).toBe(1);
    await new Promise(resolve => setTimeout(resolve, 30)); expect(calls).toBe(1);
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});
