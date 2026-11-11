import { createHmac } from 'node:crypto';
import { respondInto, webhookRequest } from '../../test-utils/http.js';
import { handleLineWebhookRequest } from '../src/webhook.js';
import { resolveLineConfig } from '../src/protocol.js';

const config = resolveLineConfig({ id: 'fixture', channelSecret: 'fixture-secret', channelAccessToken: 'fixture-token' });
const event = { type: 'message', replyToken: 'reply', timestamp: 1, source: { type: 'user', userId: 'Ufixture' }, message: { id: 'm1', type: 'text', text: 'probe' } };
function fixtures(body: string) {
  return webhookRequest(body, { 'x-line-signature': createHmac('sha256', config.channelSecret).update(body).digest('base64') });
}

it('acknowledges only after actual dispatch finishes and returns 503 for failed admission', async () => {
  const body = JSON.stringify({ events: [event] });
  let complete!: () => void;
  const admitAccepted = vi.fn(() => new Promise<void>(resolve => { complete = resolve; }));
  const handler = { config, isOpen: true, admit: vi.fn(), admitAccepted };
  const response = respondInto(handleLineWebhookRequest(fixtures(body), handler));
  await vi.waitFor(() => expect(admitAccepted).toHaveBeenCalled());
  expect(response.writeHead).not.toHaveBeenCalled();
  complete();
  await response.done;
  expect(response.writeHead).toHaveBeenCalledWith(200, expect.any(Object));
  const failed = await handleLineWebhookRequest(fixtures(body), { ...handler, admitAccepted: async () => { throw new Error('retired'); } });
  expect(failed.status).toBe(503);
});

it('rejects malformed and closed deliveries while accepting the empty verification probe', async () => {
  const admitAccepted = vi.fn(async () => {});
  const handler = { config, isOpen: false, admit: vi.fn(), admitAccepted };
  for (const [body, status] of [ ['{', 400], ['null', 400], ['{"events":[{}]}', 400], [JSON.stringify({ events: [event] }), 503], ['{"events":[]}', 200] ] as const) {
    expect((await handleLineWebhookRequest(fixtures(body), handler)).status).toBe(status);
  }
  expect(admitAccepted).not.toHaveBeenCalled();
});
