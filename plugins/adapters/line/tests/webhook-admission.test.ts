import { Readable } from 'node:stream';
import { createHmac } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { handleLineWebhookRequest } from '../src/webhook.js';
import { resolveLineConfig } from '../src/protocol.js';

const config = resolveLineConfig({ id: 'fixture', channelSecret: 'fixture-secret', channelAccessToken: 'fixture-token' });
const event = { type: 'message', replyToken: 'reply', timestamp: 1, source: { type: 'user', userId: 'Ufixture' }, message: { id: 'm1', type: 'text', text: 'probe' } };
function fixtures(body: string) {
  const request = Readable.from([body]) as IncomingMessage;
  request.headers = { 'x-line-signature': createHmac('sha256', config.channelSecret).update(body).digest('base64') };
  const response = { writeHead: vi.fn(), end: vi.fn() } as unknown as ServerResponse;
  return { request, response };
}

it('acknowledges only after actual dispatch finishes and returns 503 for failed admission', async () => {
  const body = JSON.stringify({ events: [event] });
  const { request, response } = fixtures(body);
  let complete!: () => void;
  const admitAccepted = vi.fn(() => new Promise<void>(resolve => { complete = resolve; }));
  const handler = { config, isOpen: true, admit: vi.fn(), admitAccepted };
  const pending = handleLineWebhookRequest(request, response, handler);
  await vi.waitFor(() => expect(admitAccepted).toHaveBeenCalled());
  expect(response.writeHead).not.toHaveBeenCalled();
  complete();
  await pending;
  expect(response.writeHead).toHaveBeenCalledWith(200, expect.any(Object));
  const failed = fixtures(body);
  await handleLineWebhookRequest(failed.request, failed.response, { ...handler, admitAccepted: async () => { throw new Error('retired'); } });
  expect(failed.response.writeHead).toHaveBeenCalledWith(503, expect.any(Object));
});

it('rejects malformed and closed deliveries while accepting the empty verification probe', async () => {
  const admitAccepted = vi.fn(async () => {});
  const handler = { config, isOpen: false, admit: vi.fn(), admitAccepted };
  for (const [body, status] of [ ['{', 400], ['null', 400], ['{"events":[{}]}', 400], [JSON.stringify({ events: [event] }), 503], ['{"events":[]}', 200] ] as const) {
    const { request, response } = fixtures(body);
    await handleLineWebhookRequest(request, response, handler);
    expect(response.writeHead).toHaveBeenCalledWith(status, expect.any(Object));
  }
  expect(admitAccepted).not.toHaveBeenCalled();
});
