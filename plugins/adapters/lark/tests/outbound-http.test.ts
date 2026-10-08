import http from 'node:http';
import { once } from 'node:events';
import { capabilityId, featureId, rootPluginId } from 'zhin.js';
import { createHttpHost } from '@zhin.js/host-http';
import { LarkEndpoint } from '../src/endpoint.js';
import { resolveLarkConfig } from '../src/protocol.js';

it.each(['lost', '500', '408', '429', '403', 'denied'] as const)('actual Lark HTTP sends once for %s', async mode => {
  let sends = 0;
  const server = http.createServer((request, response) => {
    request.resume(); response.setHeader('Content-Type', 'application/json');
    if (request.url?.includes('/auth/')) { response.end(JSON.stringify({ code: 0, tenant_access_token: 'fixture-only', expire: 7200 })); return; }
    sends++;
    if (mode === 'lost') { request.socket.destroy(); return; }
    response.statusCode = mode === 'denied' ? 200 : Number(mode);
    response.end(JSON.stringify({ code: mode === 'denied' ? 40003 : 0, data: {} }));
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const endpoint = new LarkEndpoint({ id: capabilityId(rootPluginId(), featureId('zhin.adapter'), 'lark'), http: createHttpHost({ host: '127.0.0.1', port: 0 }), config: resolveLarkConfig({ id: 'fixture', appId: 'fixture', appSecret: 'fixture-only', apiBaseUrl: `http://127.0.0.1:${(server.address() as { port: number }).port}` }) });
  try {
    await expect(endpoint.send({ conversation: { endpoint: { id: 'fixture', adapter: 'lark' }, kind: 'group', id: 'fixture' }, payload: 'fixture' })).rejects.toMatchObject({ disposition: mode === '429' || mode === '403' || mode === 'denied' ? 'rejected' : 'unknown' });
    expect(sends).toBe(1);
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});
