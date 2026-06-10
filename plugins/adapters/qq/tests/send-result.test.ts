import { describe, it, expect } from 'vitest';
import { resolveOutboundMessageId } from '../src/bot.js';

describe('resolveOutboundMessageId', () => {
  it('应读取正常发送结果的 id', () => {
    expect(resolveOutboundMessageId({ id: 'msg-1', timestamp: 1 })).toBe('msg-1');
  });

  it('应读取审核回包中的 audit_id', () => {
    expect(resolveOutboundMessageId({
      code: 304023,
      message: 'push message is waiting for audit now',
      data: { message_audit: { audit_id: 'audit-1' } },
    })).toBe('audit-1');
  });

  it('缺少消息 ID 时应抛出明确错误', () => {
    expect(() => resolveOutboundMessageId({ code: 40001, message: 'bad request' }))
      .toThrow('QQ 发送消息失败（40001）: bad request');
  });
});
