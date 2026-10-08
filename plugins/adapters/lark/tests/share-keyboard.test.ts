import { capabilityId, featureId, rootPluginId } from 'zhin.js';
import { LarkEndpoint } from '../src/endpoint.js';
import { formatOutboundBody, resolveLarkConfig } from '../src/protocol.js';

it('encodes ordered text, share title/description/url and native callback buttons', () => {
  const body = formatOutboundBody([
    { type: 'text', data: { text: '**bold** & < >' } },
    { type: 'share', data: { title: 'Zhin', description: '描述', url: 'https://zhin.dev' } },
    { type: 'keyboard', data: { rows: [[{ id: 'confirm', label: '确认', payload: 'accbtn:123' }]] } },
  ]);
  expect(body.msg_type).toBe('interactive');
  expect(JSON.parse(body.content).elements).toEqual([
    { tag: 'div', text: { tag: 'plain_text', content: '**bold** & < >' } },
    { tag: 'div', text: { tag: 'plain_text', content: 'Zhin' } },
    { tag: 'div', text: { tag: 'plain_text', content: '描述' } },
    { tag: 'action', actions: [{ tag: 'button', text: { tag: 'plain_text', content: '打开链接' }, url: 'https://zhin.dev' }] },
    { tag: 'action', actions: [{ tag: 'button', text: { tag: 'plain_text', content: '确认' }, value: { zhin_payload: 'accbtn:123', zhin_button_id: 'confirm' } }] },
  ]);
});
it.each(['share', 'keyboard'])('rejects malformed %s without a placeholder', type => {
  expect(() => formatOutboundBody([{ type, data: {} }])).toThrow('malformed');
});
it('correlates actual card action to original full conversation, source and actor', async () => {
  const endpoint = new LarkEndpoint({ id: capabilityId(rootPluginId(), featureId('zhin.adapter'), 'lark'),
    config: resolveLarkConfig({ id: 'bot', appId: 'fixture', appSecret: 'fixture', mode: 'websocket' }),
    longConnectionFactory: () => ({ connect: async () => {}, close: () => {} }),
    fetch: async url => ({ ok: true, status: 200, text: async () => '', json: async () => url.includes('/auth/') ? { code: 0, tenant_access_token: 'fixture', expire: 7200 } : { code: 0, data: { message_id: 'om_sent' } } }),
  });
  await endpoint.start(); endpoint.open();
  const emit = vi.spyOn(endpoint, 'emit').mockResolvedValue(undefined);
  const conversation = { endpoint: { id: 'endpoint', adapter: 'lark' }, kind: 'private' as const, id: 'oc_chat', threadId: 'thread' };
  await endpoint.send({ conversation, payload: [{ type: 'keyboard', data: { rows: [[{ label: '确认', payload: 'confirm' }]] } }] });
  const event = { token: 'click1', context: { open_message_id: 'om_sent', open_chat_id: 'oc_chat' }, operator: { open_id: 'ou_actor' }, action: { tag: 'button', value: { zhin_payload: 'confirm' } } };
  endpoint.admitCardAction({ ...event, context: { ...event.context, open_chat_id: 'wrong' } });
  endpoint.admitCardAction({ ...event, context: { ...event.context, open_message_id: 'unknown' } });
  expect(emit).not.toHaveBeenCalled();
  endpoint.admitCardAction(event); endpoint.admitCardAction(event);
  expect(emit).toHaveBeenCalledTimes(1);
  expect(emit).toHaveBeenCalledWith('message.receive', expect.objectContaining({ conversation, sender: { id: 'ou_actor' }, segments: [{ type: 'action', data: { payload: 'confirm' } }], metadata: { eventType: 'card.action.trigger', sourceMessageId: 'om_sent' } }));
  await endpoint.stop(); endpoint.admitCardAction(event); expect(emit).toHaveBeenCalledTimes(1);
});

it('routes v2 card actions over authenticated HTTP and immediately acknowledges', async () => {
  const { Readable } = await import('node:stream');
  const { handleLarkWebhookRequest } = await import('../src/webhook.js');
  const { verifySignature } = await import('../src/protocol.js');
  const { createHash } = await import('node:crypto');
  const config = resolveLarkConfig({ id: 'bot', appId: 'fixture', appSecret: 'fixture', encryptKey: 'fixture-key', verificationToken: 'fixture-token' });
  const event = { context: { open_message_id: 'om1', open_chat_id: 'oc1' }, operator: { open_id: 'ou1' }, action: { tag: 'button', value: { zhin_payload: 'confirm' } } };
  const body = JSON.stringify({ schema: '2.0', header: { event_type: 'card.action.trigger', token: config.verificationToken }, event });
  const timestamp = String(Math.floor(Date.now() / 1000)); const nonce = 'nonce';
  const signature = createHash('sha256').update(`${timestamp}${nonce}${config.encryptKey}${body}`).digest('hex');
  expect(verifySignature(config.encryptKey!, timestamp, nonce, body, signature)).toBe(true);
  const request = Object.assign(Readable.from([body]), { headers: { 'x-lark-request-token': config.verificationToken, 'x-lark-request-timestamp': timestamp, 'x-lark-request-nonce': nonce, 'x-lark-signature': signature } });
  const response = { writeHead: vi.fn(), end: vi.fn() };
  const handler = { config, isOpen: true, admit: vi.fn(), admitPlatform: vi.fn(), admitCardAction: vi.fn() };
  await handleLarkWebhookRequest(request as unknown as import('node:http').IncomingMessage, response as unknown as import('node:http').ServerResponse, handler);
  expect(handler.admitCardAction).toHaveBeenCalledWith(event);
  expect(response.writeHead).toHaveBeenCalledWith(200, expect.any(Object));
  request.headers['x-lark-signature'] = 'invalid';
  const invalid = Object.assign(Readable.from([body]), { headers: request.headers });
  await handleLarkWebhookRequest(invalid as unknown as import('node:http').IncomingMessage, response as unknown as import('node:http').ServerResponse, handler);
  expect(handler.admitCardAction).toHaveBeenCalledTimes(1);
  expect(response.writeHead).toHaveBeenLastCalledWith(403, expect.any(Object));
});

it('uses JSON 2.0 native markdown for inline code rather than v1 lark_md', () => {
  const body = formatOutboundBody([{ type: 'markdown', data: { content: '**bold** `acceptance` & < >' } }]);
  expect(JSON.parse(body.content)).toEqual({ schema: '2.0', body: { elements: [{ tag: 'markdown', content: '**bold** `acceptance` & < >' }] } });
});
