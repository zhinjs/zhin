import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { qqDeliveryFailure } from '../src/delivery-error.js';
import { resolveOutboundMessageId } from '../src/protocol.js';

it.each(['reject', 'cut', 'missing-id'])('actual SDK outbound %s submits once and cannot claim delivery', async mode => {
  let requests = 0;
  const server = createServer((request, response) => {
    requests++;
    request.resume();
    request.on('end', () => {
      if (mode === 'cut') { response.destroy(); return; }
      response.writeHead(mode === 'reject' ? 403 : 200, { 'content-type': 'application/json' });
      response.end(JSON.stringify(mode === 'reject' ? { code: 40001, message: 'private fixture' } : {}));
    });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const require = createRequire(import.meta.url);
  const { Client } = require(join(dirname(require.resolve('qq-official-bot/package.json')), 'lib/client.js'));
  const address = server.address() as { port: number };
  const client = new Client({ mode: 'websocket', appid: 'fixture', secret: 'fixture', apiBaseUrl: `http://127.0.0.1:${address.port}`, timeout: 1000 });
  try {
    let error: unknown;
    try { const response = await client.request.post('/v2/users/fixture/messages', { content: 'fixture' }); resolveOutboundMessageId(response.data); }
    catch (failure) { error = failure; }
    expect(qqDeliveryFailure(error).failure).toMatchObject({ disposition: mode === 'reject' ? 'rejected' : 'unknown' });
    expect(requests).toBe(1);
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
});
