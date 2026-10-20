import { describe, it, expect } from 'vitest';
import { resolveIcqqInboundMessageId } from '../src/protocol.js';

const base = {
  post_type: 'message' as const,
  message_type: 'group' as const,
  type: 'group' as const,
  from_id: 1,
  user_id: 999,
  nickname: 'u',
  raw_message: 'hi',
  time: 1716988800,
  group_id: 860669870,
};

describe('resolveIcqqInboundMessageId', () => {
  it('优先使用 message_id', () => {
    const r = resolveIcqqInboundMessageId({ ...base, message_id: 1234567890 }, '860669870');
    expect(r).toEqual({ id: '1234567890', source: 'message_id' });
  });

  it('无 message_id 时回退 synthetic', () => {
    const r = resolveIcqqInboundMessageId(base, '860669870');
    expect(r).toEqual({
      id: '1716988800_999_860669870',
      source: 'synthetic',
    });
  });
});
