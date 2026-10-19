import { createHttpHost, type HttpHost } from '@zhin.js/host-http';
import type { RuntimeMessageDiagnostic, RuntimeMessageDiagnosticsReader } from '@zhin.js/core/runtime';
import { registerMessageDiagnosticRoutes } from '../../../src/plugin-runtime/console/message-diagnostic-routes.js';

const hosts: HttpHost[] = [];
afterEach(async () => { for (const host of hosts.splice(0)) await host.close(); });

const conversation = { endpoint: { id: 'root/telegram\0adapter\0bot', adapter: 'telegram' }, kind: 'group' as const, id: 'group', parent: { kind: 'channel' as const, id: 'workspace' }, threadId: 'topic' };
const diagnostic: RuntimeMessageDiagnostic = {
  id: 'operation-1', generation: 4, conversation, messageId: 'same-platform-id', startedAt: 1, endedAt: 2,
  status: 'completed', truncated: false, route: 'command', dispatchStatus: 'denied', steps: [{ stage: 'dispatch', status: 'denied', at: 2 }],
  deliveries: [{ conversation, status: 'failed', failureCode: 'delivery_unconfirmed', deliveryUnknown: true }],
};

async function start(reader?: RuntimeMessageDiagnosticsReader) {
  const http = createHttpHost({ host: '127.0.0.1', port: 0, token: 'operator', tokens: [{ token: 'demo', scope: 'demo' }] });
  hosts.push(http);
  registerMessageDiagnosticRoutes({ http, base: '/api', diagnostics: reader });
  const { port } = await http.listen();
  return async (query = '', token = 'operator') => fetch(`http://127.0.0.1:${port}/api/messages/diagnostics${query}`, { headers: { authorization: `Bearer ${token}` } });
}

it('forwards exact canonical filters without replaying a message and types the wire result', async () => {
  const list = vi.fn(() => [diagnostic]);
  const request = await start({ list, get: () => undefined });
  const params = new URLSearchParams({ conversation: JSON.stringify(conversation), messageId: 'same-platform-id', limit: '200' });
  const response = await request(`?${params}`);
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(await response.json()).toEqual({ success: true, data: [diagnostic] });
  expect(list).toHaveBeenCalledExactlyOnceWith({ conversation, messageId: 'same-platform-id', limit: 100 });
});

it('reads one diagnostic and distinguishes expiry from an empty list', async () => {
  const request = await start({ list: () => [], get: id => id === diagnostic.id ? diagnostic : undefined });
  expect(await (await request('?id=operation-1')).json()).toEqual({ success: true, data: diagnostic });
  expect((await request('?id=expired')).status).toBe(404);
  expect((await request('?id=')).status).toBe(400);
});

it.each([
  '?conversation=not-json', '?conversation=null', '?conversation=%7B%7D', '?messageId=unscoped',
  `?conversation=${encodeURIComponent(JSON.stringify({ ...conversation, parent: { kind: 'guild', id: 'workspace' } }))}`,
  `?conversation=${encodeURIComponent(JSON.stringify({ ...conversation, threadId: 1 }))}`,
  `?conversation=${encodeURIComponent(JSON.stringify({ ...conversation, endpoint: { id: '', adapter: 'telegram' } }))}`,
])('rejects incomplete identities rather than broadening query %s', async query => {
  const list = vi.fn(() => []);
  const request = await start({ list, get: () => undefined });
  expect((await request(query)).status).toBe(400);
  expect(list).not.toHaveBeenCalled();
});

it('requires authenticated full scope before touching diagnostics', async () => {
  const list = vi.fn(() => []);
  const request = await start({ list, get: () => undefined });
  expect((await request('', 'demo')).status).toBe(403);
  expect((await request('', 'wrong')).status).toBe(401);
  expect(list).not.toHaveBeenCalled();
});

it('makes an unavailable IM runtime explicit', async () => {
  const request = await start();
  expect((await request()).status).toBe(503);
});
