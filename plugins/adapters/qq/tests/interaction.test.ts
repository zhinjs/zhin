import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { capabilityId, featureId, rootPluginId } from 'zhin.js';
import { QqWebsocketEndpoint } from '../src/endpoint.js';
import { normalizeQqInteraction } from '../src/interaction.js';
import { resolveQqConfig } from '../src/protocol.js';
import { formatOutbound } from '../src/outbound.js';

it('uses official callback type 1, URL type 0 and command type 2', () => {
  const payload = formatOutbound([{ type: 'keyboard', data: { rows: [[{ label: 'callback', payload: 'unique' }, { label: 'link', url: 'https://zhin.dev' }, { label: 'command', mode: 'command', payload: '/cmd' }]] } }]) as Array<{ data: { buttons: Array<{ action: { type: number; data: string } }> } }>;
  expect((Array.isArray(payload) ? payload : [payload]).find(row => row.data.buttons)?.data.buttons.map(button => button.action)).toEqual([
    expect.objectContaining({ type: 1, data: 'unique' }), expect.objectContaining({ type: 0, data: 'https://zhin.dev' }), expect.objectContaining({ type: 2, data: '/cmd' }),
  ]);
});
it('maps real published SDK private/group notices to action and ACK, preserving absent source ID', async () => {
  const require = createRequire(import.meta.url);
  const { ActionNoticeEvent } = require(join(dirname(require.resolve('qq-official-bot/package.json')), 'lib/events/notice.js'));
  const replyAction = vi.fn(async () => true);
  const sdkBot = { logger: { info: vi.fn() }, replyAction };
  const api = { start: vi.fn(async () => {}), stop: vi.fn(async () => {}), removeAllListeners: vi.fn(), on: vi.fn() };
  const endpoint = new QqWebsocketEndpoint({ id: capabilityId(rootPluginId(), featureId('zhin.adapter'), 'qq'), config: resolveQqConfig({ id: 'bot', appid: 'dummy', secret: 'dummy', mode: 'websocket' }), createBot: () => api as never });
  await endpoint.start(); endpoint.open();
  const emit = vi.spyOn(endpoint, 'emit').mockResolvedValue(undefined);
  const event = ActionNoticeEvent.parse.call(sdkBot, 'notice.friend.action', { scene: 'c2c', id: 'click1', user_openid: 'actor', data: { resolved: { button_data: 'accbtn:unique', button_id: 'confirm' } } });
  expect(endpoint.admitInteraction(event)).toBe(true); expect(endpoint.admitInteraction(event)).toBe(true);
  await Promise.resolve();
  expect(replyAction).toHaveBeenCalledExactlyOnceWith('click1', 0);
  expect(emit).toHaveBeenCalledOnce();
  expect(emit).toHaveBeenCalledWith('message.receive', expect.objectContaining({ conversation: expect.objectContaining({ kind: 'private', id: 'actor' }), sender: { id: 'actor' }, segments: [{ type: 'action', data: { payload: 'accbtn:unique' } }], metadata: { eventType: 'INTERACTION_CREATE', sourceMessageIdAvailable: false, callbackAssociation: 'payload-conversation-actor' } }));
  const group = ActionNoticeEvent.parse.call(sdkBot, 'notice.group.action', { scene: 'group', id: 'click2', group_openid: 'group', group_member_openid: 'actor2', data: { resolved: { button_data: 'group-callback', button_id: 'confirm' } } });
  const guild = ActionNoticeEvent.parse.call(sdkBot, 'notice.guild.action', { scene: 'guild', id: 'click3', guild_id: 'guild', channel_id: 'channel', data: { resolved: { user_id: 'actor3', message_id: 'source3', button_data: 'guild-callback', button_id: 'confirm' } } });
  expect(normalizeQqInteraction(guild)).toMatchObject({ sourceMessageId: 'source3', message: { channelKind: 'channel', channelId: 'channel', guildId: 'guild', authorId: 'actor3' } });
  expect(normalizeQqInteraction(group)?.message).toMatchObject({ channelKind: 'group', channelId: 'group', authorId: 'actor2' });
  await endpoint.stop(); expect(endpoint.admitInteraction(group)).toBe(false);
});
it('keeps genuine guild source message IDs and rejects malformed notices', () => {
  const raw = { sub_type: 'action', notice_type: 'guild', notice_id: 'event', channel_id: 'channel', guild_id: 'guild', operator_id: 'actor', data: { resolved: { button_data: 'unique', message_id: 'source' } }, reply: vi.fn(async () => true) };
  expect(normalizeQqInteraction(raw)).toMatchObject({ sourceMessageId: 'source', message: { channelKind: 'channel', channelId: 'channel', guildId: 'guild', authorId: 'actor' } });
  expect(normalizeQqInteraction({ ...raw, operator_id: undefined })).toBeNull();
  expect(normalizeQqInteraction({ ...raw, sub_type: 'increase' })).toBeNull();
});

it('rejects canonical share without sending only the neighboring text', () => {
  expect(() => formatOutbound([{ type: 'text', data: { text: 'probe' } }, { type: 'share', data: { url: 'https://zhin.dev', title: 'Zhin', description: 'description' } }])).toThrow(expect.objectContaining({ disposition: 'not_sent', code: 'unsupported_operation' }));
});
