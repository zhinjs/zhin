import { createServer, type ServerResponse } from 'node:http';
import { createHttpHost, httpHostToken } from '@zhin.js/host-http';
import { createAdapterHarness } from '../../test-utils/endpoint.js';
import definition from '../adapters/onebot12/index.js';

/** The production HTTP Client and fetch run against a local synthetic platform. */
async function fixture() {
  const requests: Array<{ action: string; response: ServerResponse }> = [];
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString()); requests.push({ action: body.action, response });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Local platform did not listen');
  const http = createHttpHost({ host: '127.0.0.1', port: 0 });
  const h = await createAdapterHarness(definition, { id: 'synthetic', platform: 'qq', userId: 'bot', connection: 'webhook',
    api_url: `http://127.0.0.1:${address.port}`, path: '/onebot12', access_token: 'synthetic' },
  { name: 'onebot12', resources: new Map([[httpHostToken.id, http]]) });
  await h.start(); h.open();
  const request = { conversation: { endpoint: { adapter: 'onebot12', id: h.canonicalId }, kind: 'private' as const, id: 'user' },
    payload: [{ type: 'image', data: { media: { kind: 'base64', mime_type: 'image/png', value: 'c3ludGhldGlj' } } }] };
  return { ...h, requests, request, reply(index: number, data: unknown) {
    const response = requests[index]!.response; response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ status: 'ok', retcode: 0, data }));
  }, async cleanup() { await h.stop(); await http.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); } };
}

it('HTTP account retirement aborts pending upload without issuing send_message or retrying', async () => {
  const h = await fixture(); const sending = h.send(h.request).then(value => ({ value }), error => ({ error }));
  try {
    await vi.waitFor(() => expect(h.requests.map(item => item.action)).toEqual(['upload_file']));
    const stopping = h.index.stop(); await expect(sending).resolves.toMatchObject({ error: { disposition: 'unknown' } }); await stopping;
    expect(h.requests.map(item => item.action)).toEqual(['upload_file']);
  } finally { await h.cleanup(); await sending; }
});
it('HTTP operation cancellation does not retire the account and late upload completion cannot continue the send', async () => {
  const h = await fixture(), caller = new AbortController();
  const sending = h.send({ ...h.request, signal: caller.signal }).then(value => ({ value }), error => ({ error }));
  try {
    await vi.waitFor(() => expect(h.requests).toHaveLength(1)); caller.abort();
    await expect(sending).resolves.toMatchObject({ error: { disposition: 'unknown' } });
    h.reply(0, { file_id: 'late' });
    const next = h.send({ ...h.request, payload: 'next message' });
    await vi.waitFor(() => expect(h.requests.map(item => item.action)).toEqual(['upload_file', 'send_message']));
    h.reply(1, { message_id: 'next-id' }); await expect(next).resolves.toBe('next-id');
  } finally { await h.cleanup(); await sending; }
});
it('HTTP scoped recall retains its source lifetime instead of waiting for the remote response', async () => {
  const h = await fixture(), source = new AbortController();
  const control = h.index.control(h.canonicalId, 'recall', { signal: source.signal });
  if (!control?.recall) throw new Error('Declared recall port is missing');
  const recalling = control.recall({ message: { conversation: h.request.conversation, id: '42' } }).then(() => ({ success: true }), error => ({ error }));
  try {
    await vi.waitFor(() => expect(h.requests.map(item => item.action)).toEqual(['delete_message']));
    source.abort(); await expect(recalling).resolves.toMatchObject({ error: { disposition: 'unknown' } });
    const next = h.send({ ...h.request, payload: 'next message' });
    await vi.waitFor(() => expect(h.requests.map(item => item.action)).toEqual(['delete_message', 'send_message']));
    h.reply(1, { message_id: 'next-id' }); await expect(next).resolves.toBe('next-id');
  } finally { await h.cleanup(); await recalling; }
});
