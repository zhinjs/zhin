import { createServer } from 'node:http';
import { once } from 'node:events';
import { capabilityId, featureId, rootPluginId } from 'zhin.js';
import { createEndpointHarness } from '../../test-utils/endpoint.js';
import { NapCatHttpEndpoint } from '../src/http-endpoint.js';
import { resolveNapCatConfig, type NapCatHttpConfig } from '../src/protocol.js';
import type { HttpHost } from '@zhin.js/host-http';

const cleanups: Array<() => Promise<unknown>> = [];
afterEach(async () => { for (const close of cleanups.splice(0).reverse()) await close(); });

it('aborts the actual HTTP request for one semantic caller while a native sibling completes', async () => {
  let admitted!: () => void;
  let disconnected!: () => void;
  const received = new Promise<void>(resolve => { admitted = resolve; });
  const closed = new Promise<void>(resolve => { disconnected = resolve; });
  const server = createServer((request, response) => {
    request.resume();
    if (request.url === '/get_group_list') {
      response.once('close', disconnected);
      admitted(); return;
    }
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ status: 'ok', retcode: 0, data: { user_id: 123 } }));
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  cleanups.push(async () => {
    const closing = new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    server.closeAllConnections(); await closing;
  });
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Missing loopback address');
  const config = resolveNapCatConfig({ connection: 'http', id: 'cancel-http', http_url: `http://127.0.0.1:${address.port}`, post_path: '/synthetic' }) as NapCatHttpConfig;
  const http = { route: () => () => undefined } as unknown as HttpHost;
  const bot = await createEndpointHarness(() => new NapCatHttpEndpoint({
    id: capabilityId(rootPluginId(), featureId('zhin.adapter'), 'napcat'), config, http,
  }), { name: 'napcat', capabilities: ['inbound', 'outbound'], operations: ['recall'] });
  cleanups.push(() => bot.stop());
  {
    await bot.start();
    const caller = new AbortController();
    const pending = bot.index.management(bot.canonicalId)!.listGroups!({ signal: caller.signal });
    const rejected = expect(pending).rejects.toMatchObject({ disposition: 'unknown' });
    await received;
    await expect(bot.endpoint.callApi('get_login_info')).resolves.toEqual({ user_id: 123 });
    caller.abort();
    await rejected;
    await closed;
    await expect(bot.endpoint.callApi('get_login_info')).resolves.toEqual({ user_id: 123 });
  }
});
