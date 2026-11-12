import { describe, expect, it } from 'vitest';
import { checkBuiltinPermit, toPermissionSubject } from '@zhin.js/permission';
import sendText from '../agents/wecom/skills/wecom/tools/send_text/index.js';

function subject(level: 'global' | 'conversation') {
  return toPermissionSubject({
    clientAdapter: 'wecom',
    conversation: { endpoint: { adapter: 'wecom', id: 'bot' }, kind: 'private', id: 'u1' },
    sender: { id: 'u1', chatRole: 'owner', chatRoleLevels: { owner: level, admin: level, trusted: level } },
  } as never);
}

describe('wecom_send_text', () => {
  it('messages any user outside the current conversation, so only a global zhin owner may use it', () => {
    expect(sendText.permissions).toEqual(['owner@global']);
    expect(sendText.permissions!.every((p) => checkBuiltinPermit(p, subject('global')))).toBe(true);
    expect(sendText.permissions!.every((p) => checkBuiltinPermit(p, subject('conversation')))).toBe(false);
  });
});
