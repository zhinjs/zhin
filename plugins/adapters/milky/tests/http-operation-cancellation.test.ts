import { createServer, type ServerResponse } from 'node:http';
import { createHttpHost, httpHostToken } from '@zhin.js/host-http';
import { createAdapterHarness } from '../../test-utils/endpoint.js';
import definition from '../adapters/milky/index.js';

/** Production Adapter + native Client + HTTP transport; the only peer is this local server. */
async function fixture() {
  const requests: Array<{ action: string; response: ServerResponse; closed: boolean }> = [];
  const server = createServer(async (request, response) => {
    for await (const _chunk of request) { /* consume the synthetic protocol body */ }
    const entry = { action: new URL(request.url ?? '/', 'http://synthetic.local').pathname.split('/').pop() ?? '', response, closed: false }; requests.push(entry);
    response.once('close', () => { entry.closed = true; });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Local platform did not listen');
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const http = createHttpHost({ host: '127.0.0.1', port: 0 });
  const h = await createAdapterHarness(definition, { id: 'synthetic', connection: 'webhook', baseUrl, path: '/events', access_token: 'synthetic' }, { name: 'milky', resources: new Map([[httpHostToken.id, http]]) });
  await h.start(); h.open();
  const conversation = { endpoint: { adapter: 'milky', id: h.canonicalId }, kind: 'group' as const, id: '123' };
  return { ...h, requests, conversation, reply(index: number, data: unknown) {
    requests[index]!.response.writeHead(200, { 'Content-Type': 'application/json' });
    requests[index]!.response.end(JSON.stringify({ status: 'ok', retcode: 0, data }));
  }, async cleanup() { server.closeAllConnections(); await h.stop(); await http.close(); await new Promise<void>(resolve => server.close(() => resolve())); } };
}

it.each(['caller', 'source'] as const)('physically aborts %s-owned list requests without retiring the account or fetching another page', async scope => {
  const h = await fixture(), caller = new AbortController(), source = new AbortController();
  const management = h.index.management(h.canonicalId, { signal: source.signal });
  const listing = management!.listGroups!({ signal: caller.signal }).then(value => ({ value }), error => ({ error }));
  try {
    await vi.waitFor(() => expect(h.requests.map(item => item.action)).toEqual(['get_group_list']));
    (scope === 'caller' ? caller : source).abort();
    let outcome: Awaited<typeof listing> | undefined; void listing.then(value => { outcome = value; });
    await vi.waitFor(() => expect(outcome).toMatchObject({ error: { disposition: 'unknown' } }), { timeout: 200 });
    await vi.waitFor(() => expect(h.requests[0]!.closed).toBe(true)); h.reply(0, { groups: [] });
    const fresh = h.index.management(h.canonicalId)!.listGroups!();
    await vi.waitFor(() => expect(h.requests).toHaveLength(2)); h.reply(1, { groups: [] });
    await expect(fresh).resolves.toEqual([]); expect(h.requests.map(item => item.action)).toEqual(['get_group_list', 'get_group_list']);
  } finally { await h.cleanup(); await listing; }
});
it('retains control source cancellation and sends the following reply through the same native client', async () => {
  const h = await fixture(), source = new AbortController();
  const control = h.index.control(h.canonicalId, 'recall', { signal: source.signal });
  const recalling = control!.recall!({ message: { conversation: h.conversation, id: 'group:123:42' } }).then(() => ({ success: true }), error => ({ error }));
  try {
    await vi.waitFor(() => expect(h.requests.map(item => item.action)).toEqual(['recall_group_message'])); source.abort();
    let outcome: Awaited<typeof recalling> | undefined; void recalling.then(value => { outcome = value; });
    await vi.waitFor(() => expect(outcome).toMatchObject({ error: { disposition: 'unknown' } }), { timeout: 200 });
    await vi.waitFor(() => expect(h.requests[0]!.closed).toBe(true));
    const next = h.send({ conversation: h.conversation, payload: 'synthetic next reply' });
    await vi.waitFor(() => expect(h.requests.map(item => item.action)).toEqual(['recall_group_message', 'send_group_message']));
    h.reply(1, { message_seq: 7 }); await expect(next).resolves.toBe('group:123:7');
  } finally { await h.cleanup(); await recalling; }
});
