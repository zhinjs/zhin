import { normalizeQqInboundWsPayload } from '../src/inbound-normalize.js';

describe('normalizeQqInboundWsPayload', () => {
  it('maps group_openid and member_openid for GROUP_AT_MESSAGE_CREATE', () => {
    const packet = {
      d: {
        group_openid: 'GROUP_OPENID_1',
        author: { member_openid: 'MEMBER_1' },
        content: '<@!900000099> 你好',
        attachments: [{ content_type: 'image/png' }],
      },
    };
    normalizeQqInboundWsPayload('GROUP_AT_MESSAGE_CREATE', packet);

    expect(packet.d!.group_id).toBe('GROUP_OPENID_1');
    expect((packet.d!.author as { id?: string }).id).toBe('MEMBER_1');
    expect(packet.d!.mentions).toEqual([{ id: '900000099' }]);
    expect((packet.d!.attachments as Array<{ url: string }>)[0]!.url).toBe('');
    expect(packet.d!.__zhin_group_at).toBe(true);
  });

  it('ignores unrelated events', () => {
    const packet = { d: { group_openid: 'x' } };
    normalizeQqInboundWsPayload('C2C_MESSAGE_CREATE', packet);
    expect(packet.d!.group_id).toBeUndefined();
  });
});
