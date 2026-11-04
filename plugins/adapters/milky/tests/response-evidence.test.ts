import { createServer, type ServerResponse } from 'node:http';
import { ProtocolError } from '@imhelper/milky-v1';
import { createHttpHost } from '@zhin.js/host-http';
import { capabilityId, featureId, rootPluginId } from 'zhin.js';
import { createEndpointHarness } from '../../test-utils/endpoint.js';
import { MilkyWebhookEndpoint } from '../src/webhook-endpoint.js';
import { resolveMilkyConfig } from '../src/protocol.js';

/** Real native SDK and semantic Index share the production HTTP caller, with a loopback peer only. */
async function fixture() {
  const pending: ServerResponse[] = [];
  const server = createServer(async (request, response) => {
    for await (const _chunk of request) { /* consume the synthetic request */ }
    pending.push(response);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Loopback did not listen');
  const http = createHttpHost({ host: '127.0.0.1', port: 0 });
  const config = resolveMilkyConfig({ id: 'synthetic', connection: 'webhook', baseUrl: `http://127.0.0.1:${address.port}`, path: '/events' });
  if (config.connection !== 'webhook') throw new Error('Wrong fixture configuration');
  const h = await createEndpointHarness(() => new MilkyWebhookEndpoint({
    id: capabilityId(rootPluginId(), featureId('zhin.adapter'), 'milky'), http, config,
  }), { name: 'milky', capabilities: ['inbound', 'outbound'], operations: ['recall'] });
  await h.start(); h.open();
  return { ...h, pending,
    reply(index: number, envelope: unknown) { pending[index]!.writeHead(200, { 'Content-Type': 'application/json' }); pending[index]!.end(JSON.stringify(envelope)); },
    async cleanup() { server.closeAllConnections(); await h.stop(); await http.close(); await new Promise<void>(resolve => server.close(() => resolve())); },
  };
}

it.each([
  { name: 'contradictory success', response: { status: 'ok', retcode: -400, data: { message_seq: 42 } }, disposition: 'unknown' },
  { name: 'explicit rejection', response: { status: 'failed', retcode: -400, message: 'synthetic rejection' }, disposition: 'rejected' },
  { name: 'missing status', response: { retcode: 0, data: { message_seq: 42 } }, disposition: 'unknown', nativeOutcome: 'accepted' },
  { name: 'contradictory rejection', response: { status: 'failed', retcode: 0, data: { message_seq: 42 } }, disposition: 'unknown' },
  { name: 'null response', response: null, disposition: 'unknown' },
])('preserves native behavior and $disposition framework evidence for $name without retry', async ({ response, disposition, nativeOutcome }) => {
  const h = await fixture();
  try {
    const native = h.endpoint.call('send_group_message', { group_id: 123, message: [] });
    // The installed native SDK tolerates missing status.
    // Preserve that API surface; semantic delivery requires a confirmed protocol result.
    const nativeSettled = nativeOutcome === 'accepted'
      ? expect(native).resolves.toEqual(response)
      : expect(native).rejects.toBeInstanceOf(ProtocolError);
    await vi.waitFor(() => expect(h.pending).toHaveLength(1)); h.reply(0, response); await nativeSettled;
    const sending = h.send({ conversation: { endpoint: { adapter: 'milky', id: h.canonicalId }, kind: 'group', id: '123' }, payload: 'synthetic message' });
    const rejected = expect(sending).rejects.toMatchObject({ disposition });
    await vi.waitFor(() => expect(h.pending).toHaveLength(2)); h.reply(1, response); await rejected;
    expect(h.pending).toHaveLength(2);
  } finally { await h.cleanup(); }
});

it.each([
  { status: 'ok', retcode: '0', data: { message_seq: 42 } },
  { status: 'ok', data: { message_seq: 42 } },
])('never turns malformed retcode into a confirmed framework receipt: %j', async response => {
  const h = await fixture();
  try {
    const sending = h.send({ conversation: { endpoint: { adapter: 'milky', id: h.canonicalId }, kind: 'group', id: '123' }, payload: 'synthetic message' });
    const rejected = expect(sending).rejects.toMatchObject({ disposition: 'unknown' });
    await vi.waitFor(() => expect(h.pending).toHaveLength(1)); h.reply(0, response); await rejected;
    expect(h.pending).toHaveLength(1);
  } finally { await h.cleanup(); }
});
