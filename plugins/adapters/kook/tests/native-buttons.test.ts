import { EventEmitter } from 'node:events';
import { Message } from 'kook-client';
import { capabilityId, featureId, rootPluginId } from 'zhin.js';
import { bindTestEndpoint } from '../../test-utils/endpoint.js';
import { KookWebsocketEndpoint, KookWebhookEndpoint } from '../src/endpoint.js';
import { sendKookOutbound } from '../src/outbound.js';
import { resolveKookConfig } from '../src/protocol.js';
import type { KookClientTransport } from '../src/ws.js';

const conversation = { endpoint: { id: 'test', adapter: 'kook' }, kind: 'channel' as const, id: 'channel' };
const click = { channel_type: 'GROUP', type: 255, target_id: 'channel', msg_id: 'click-id', msg_timestamp: 1,
  extra: { type: 'message_btn_click', body: { user_id: 'actor', msg_id: 'sent-card', value: 'acceptance:button', target_id: 'channel' } } };

it('serializes native return-val buttons and link shares through the installed SDK preserving quotes', async () => {
  const sendChannelMsg = vi.fn(async () => ({ msg_id: 'sent-card' }));
  const client = { sendChannelMsg } as unknown as KookClientTransport;
  await sendKookOutbound(client, { conversation, payload: [
    { type: 'reply', data: { message_id: 'parent' } }, { type: 'markdown', data: { content: '**choose**' } },
    { type: 'keyboard', data: { rows: [[{ label: '确认', payload: 'acceptance:button', style: 'primary' }]] } },
    { type: 'share', data: { title: 'Zhin', url: 'https://zhin.dev/', description: '打开官网' } },
  ] });
  const [, card, quote] = sendChannelMsg.mock.calls[0]!;
  expect(quote).toEqual({ message_id: 'parent' });
  const [content, , type] = await Message.processMessage.call(client as never, card as never, quote as never);
  expect(type).toBe(10);
  expect(JSON.parse(content)[0].modules).toEqual([
    expect.objectContaining({ text: { type: 'kmarkdown', content: '**choose**' } }),
    { type: 'action-group', elements: [{ type: 'button', theme: 'primary', value: 'acceptance:button', click: 'return-val', text: { type: 'plain-text', content: '确认' } }] },
    { type: 'section', mode: 'left', text: { type: 'plain-text', content: 'Zhin' } },
    { type: 'section', mode: 'left', text: { type: 'plain-text', content: '打开官网' } },
    { type: 'action-group', elements: [{ type: 'button', theme: 'secondary', value: 'https://zhin.dev/', click: 'link', text: { type: 'plain-text', content: '打开链接' } }] },
  ]);
});

it('routes native clicks through reliable canonical action ingress with the actual sender and source card', async () => {
  const receiver = new EventEmitter();
  const client = { receiver, sendChannelMsg: async () => ({ msg_id: 'sent-card' }), connect: async () => {}, disconnect: async () => {}, removeAllListeners: () => {}, on: () => {} } as unknown as KookClientTransport;
  const receive = vi.fn(async () => {});
  const id = capabilityId(rootPluginId(), featureId('zhin.adapter'), 'kook');
  const config = resolveKookConfig({ id: 'test', token: 'fixture', connection: 'websocket' });
  if (config.connection !== 'websocket') throw new Error('Wrong fixture');
  const endpoint = bindTestEndpoint(new KookWebsocketEndpoint({ id, config, createClient: () => client }), { receive });
  await endpoint.start(); endpoint.open();
  await endpoint.send({ conversation: { ...conversation, parent: { kind: 'channel', id: 'guild' } }, payload: [{ type: 'text', data: { text: 'choose' } }, { type: 'keyboard', data: { rows: [[{ label: '确认', payload: 'acceptance:button' }]] } }] });
  receiver.emit('event', { ...click, channel_type: 'PERSON', target_id: 'actor' });
  await vi.waitFor(() => expect(receive).toHaveBeenCalledTimes(1));
  expect(receive).toHaveBeenCalledWith(expect.objectContaining({ content: '[action: acceptance:button]', conversation: expect.objectContaining({ kind: 'channel', id: 'channel', parent: { kind: 'channel', id: 'guild' } }),
    sender: { id: 'actor' }, segments: [{ type: 'action', data: { id: 'click-id', payload: 'acceptance:button', sourceMessageId: 'sent-card' } }],
    metadata: expect.objectContaining({ sourceMessageId: 'sent-card', eventType: 'message_btn_click' }) }));
  endpoint.close(); receiver.emit('event', click);
  await endpoint.stop(); receiver.emit('event', click);
  expect(receive).toHaveBeenCalledTimes(1);
});

it('webhook buttons await admission and route private clicks to the user rather than the bot', async () => {
  let complete!: () => void;
  const receive = vi.fn(() => new Promise<void>(resolve => { complete = resolve; }));
  const config = resolveKookConfig({ id: 'test', token: 'fixture', connection: 'webhook', verify_token: 'fixture' });
  if (config.connection !== 'webhook') throw new Error('Wrong fixture');
  const client = { init: async () => {}, connect: async () => {}, disconnect: async () => {}, removeAllListeners: () => {} } as unknown as KookClientTransport;
  const endpoint = bindTestEndpoint(new KookWebhookEndpoint({ id: capabilityId(rootPluginId(), featureId('zhin.adapter'), 'kook'), config, http: { route: () => () => {} } as never, createClient: () => client }), { receive });
  await endpoint.start(); endpoint.open();
  let admitted = false;
  const pending = endpoint.admitEvent({ ...click, channel_type: 'PERSON', target_id: 'bot', extra: { ...click.extra, body: { ...click.extra.body, target_id: '' } } }).then(() => { admitted = true; });
  await vi.waitFor(() => expect(receive).toHaveBeenCalled());
  expect(admitted).toBe(false);
  expect(receive.mock.calls[0]![0]).toMatchObject({ conversation: { kind: 'private', id: 'actor' }, sender: { id: 'actor' } });
  complete(); await pending; await endpoint.stop();
});
