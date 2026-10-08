import { DingTalkCards } from '../src/cards.js';
import { resolveDingTalkConfig } from '../src/protocol.js';
const config = resolveDingTalkConfig({ id: 'bot', appKey: 'key', appSecret: 'secret', mode: 'stream', cardTemplateId: 'template.schema', cardButtonCount: 2 });
const conversation = { endpoint: { id: 'bot', adapter: 'root/ding' }, kind: 'private' as const, id: 'private-conversation' };
const payload = [{ type: 'text', data: { text: 'question' } }, { type: 'keyboard', data: { rows: [[{ label: 'Yes', payload: 'answer' }]] } }];
function setup() {
  const cards = new DingTalkCards(); cards.remember(conversation, { senderStaffId: 'staff', senderId: 'sender', senderCorpId: 'corp' });
  const prepared = cards.prepare(config, conversation, payload)!;
  const success = { success: true, result: { outTrackId: prepared.id, deliverResults: [{ spaceType: 'IM_ROBOT', spaceId: 'staff', success: true }] } };
  const callback = { outTrackId: prepared.id, spaceType: 'IM_ROBOT', spaceId: 'staff', userId: 'staff', userIdType: 1, corpId: 'corp', content: JSON.stringify({ cardPrivateData: { params: { action: 'answer' } } }) };
  return { cards, prepared, success, callback };
}
it('builds a fixed card contract and confirms the exact target before accepting a callback', () => {
  const { cards, prepared, success, callback } = setup();
  expect(prepared.body).toMatchObject({ callbackType: 'STREAM', openSpaceId: 'dtv1.card//IM_ROBOT.staff', cardData: { cardParamMap: { title: '消息', text: 'question', button0_label: 'Yes', button0_payload: 'answer', button0_visible: 'true', button1_visible: 'false' } } });
  expect(() => cards.resolve(callback)).toThrow(); cards.confirm(prepared, success);
  expect(cards.resolve(callback)).toMatchObject({ conversation, payload: 'answer', senderId: 'sender', sourceMessageId: prepared.id });
  cards.clear(); expect(() => cards.resolve(callback)).toThrow();
});
it.each([{ userId: 'another' }, { userIdType: 2 }, { corpId: 'another' }, { spaceId: 'another' }, { outTrackId: 'another' }, { content: JSON.stringify({ cardPrivateData: { params: { action: 'another' } } }) }])('rejects a mismatching card actor/source/space/payload %j', mismatch => {
  const { cards, prepared, success, callback } = setup(); cards.confirm(prepared, success); expect(() => cards.resolve({ ...callback, ...mismatch })).toThrow();
});
it('does not confirm HTTP success without exact delivery success', () => {
  const { cards, prepared, success } = setup();
  expect(() => cards.confirm(prepared, { success: true, result: { outTrackId: prepared.id } })).toThrow('unconfirmed');
  expect(() => cards.confirm(prepared, { ...success, result: { ...success.result, deliverResults: [{ spaceType: 'IM_ROBOT', spaceId: 'staff', success: false }] } })).toThrow('rejected');
});
it('uses group context and bounds keyboard to the actual template', () => {
  const cards = new DingTalkCards(); const group = { ...conversation, kind: 'group' as const, id: 'cid-group' }; cards.remember(group, { senderStaffId: 'staff', senderCorpId: 'corp' });
  expect(cards.prepare(config, group, payload)?.body).toMatchObject({ openSpaceId: 'dtv1.card//IM_GROUP.cid-group', imGroupOpenDeliverModel: { robotCode: 'key' } });
  expect(() => cards.prepare({ ...config, cardButtonCount: 1 }, group, [{ type: 'keyboard', data: { rows: [[{ label: '1', payload: '1' }, { label: '2', payload: '2' }]] } }])).toThrow('fixed template');
  expect(() => cards.prepare({ ...config, cardTemplateId: undefined }, group, payload)).toThrow('configured');
});

it('does not resurrect an old card correlation after stop/restart', () => {
  const { cards, prepared, success, callback } = setup(); cards.clear();
  expect(() => cards.confirm(prepared, success)).toThrow('retirement');
  expect(() => cards.resolve(callback)).toThrow();
});
it('sends the real card API request and dispatches a matching callback through the endpoint', async () => {
  const { DingTalkEndpoint } = await import('../src/endpoint.js');
  const { bindTestEndpoint } = await import('../../test-utils/endpoint.js');
  const { capabilityId, rootPluginId, featureId } = await import('zhin.js');
  const receive = vi.fn(async () => Object.freeze({ matched: true }));
  let body: any;
  const fetch = vi.fn(async (url: any, options: any) => {
    if (String(url).includes('/gettoken')) return { ok: true, status: 200, json: async () => ({ errcode: 0, access_token: 'fixture', expires_in: 7200 }), text: async () => '' };
    body = JSON.parse(options.body);
    return { ok: true, status: 200, json: async () => ({ success: true, result: { outTrackId: body.outTrackId, deliverResults: [{ spaceType: 'IM_ROBOT', spaceId: 'staff', success: true }] } }), text: async () => '' };
  });
  const endpoint = bindTestEndpoint(new DingTalkEndpoint({ id: capabilityId(rootPluginId(), featureId('zhin.adapter'), 'ding'), config, fetch, gateway: { receive, send: vi.fn(async () => 'sent') } }), { receive, send: vi.fn(async () => 'sent') }, undefined);
  endpoint.open();
  await endpoint.admit({ msgtype: 'text', msgId: 'incoming', text: { content: 'hello' }, conversationId: conversation.id, conversationType: '1', senderStaffId: 'staff', senderId: 'sender', senderCorpId: 'corp' });
  const canonical = receive.mock.calls[0][0] as any;
  const id = await endpoint.send({ conversation: canonical.conversation, payload });
  expect(fetch).toHaveBeenLastCalledWith('https://api.dingtalk.com/v1.0/card/instances/createAndDeliver', expect.objectContaining({ headers: expect.objectContaining({ 'x-acs-dingtalk-access-token': 'fixture' }) }));
  receive.mockClear();
  await endpoint.admitCard({ outTrackId: id, spaceType: 'IM_ROBOT', spaceId: 'staff', userId: 'staff', userIdType: 1, corpId: 'corp', content: JSON.stringify({ cardPrivateData: { params: { action: 'answer' } } }) }, 'click');
  expect(receive).toHaveBeenCalledWith(expect.objectContaining({ conversation: canonical.conversation, sender: { id: 'sender' }, segments: [{ type: 'action', data: { id: 'click', payload: 'answer', sourceMessageId: id } }] }));
  endpoint.close(); await expect(endpoint.admitCard({}, 'late')).rejects.toThrow('closed'); await endpoint.stop();
});
it.each([
  [403, { code: 'Forbidden.AccessDenied.AccessTokenPermission', message: 'SECRET-TOKEN https://credential.example' }, 'response', 'Forbidden.AccessDenied.AccessTokenPermission'],
  [200, { success: false, code: 'InvalidParameter' }, 'delivery', 'InvalidParameter'],
])('logs safe diagnostics for card failure HTTP %s', async (status, responseBody, stage, platformCode) => {
  const { DingTalkEndpoint } = await import('../src/endpoint.js');
  const { bindTestEndpoint } = await import('../../test-utils/endpoint.js');
  const { capabilityId, rootPluginId, featureId } = await import('zhin.js');
  const { getAdapterLogger } = await import('@zhin.js/logger');
  const warn = vi.spyOn(getAdapterLogger('dingtalk', config.id), 'warn');
  const receive = vi.fn(async () => Object.freeze({ matched: true }));
  const fetch = vi.fn(async (url: any) => ({ ok: String(url).includes('/gettoken') || status === 200, status, json: async () => String(url).includes('/gettoken') ? { errcode: 0, access_token: 'SECRET-TOKEN', expires_in: 7200 } : responseBody, text: async () => '' }));
  const endpoint = bindTestEndpoint(new DingTalkEndpoint({ id: capabilityId(rootPluginId(), featureId('zhin.adapter'), 'ding'), config, fetch, gateway: { receive, send: vi.fn(async () => 'sent') } }), { receive, send: vi.fn(async () => 'sent') }, undefined);
  try {
    endpoint.open(); await endpoint.admit({ msgtype: 'text', conversationId: conversation.id, conversationType: '1', senderStaffId: 'staff' });
    await expect(endpoint.send({ conversation, payload })).rejects.toBeInstanceOf(Error);
    const log = JSON.stringify(warn.mock.calls);
    expect(log).toContain('dingtalk_card_delivery_failed'); expect(log).toContain(stage); expect(log).toContain(String(status)); expect(log).toContain(platformCode);
    expect(log).not.toContain('SECRET-TOKEN'); expect(log).not.toContain('credential.example'); expect(log).not.toContain('cardTemplateId');
  } finally { warn.mockRestore(); await endpoint.stop(); }
});
