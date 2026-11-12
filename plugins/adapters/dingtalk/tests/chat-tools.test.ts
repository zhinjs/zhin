import { describe, expect, it } from 'vitest';
import { checkBuiltinPermit, toPermissionSubject } from '@zhin.js/permission';
import createChat from '../agents/dingtalk/skills/dingtalk/tools/create_chat/index.js';
import addMembers from '../agents/dingtalk/skills/dingtalk-group-admin/tools/add_chat_members/index.js';
import updateChat from '../agents/dingtalk/skills/dingtalk-group-admin/tools/update_chat/index.js';

function subject(chatRole?: 'owner' | 'admin' | 'trusted', standing?: 'owner' | 'admin' | 'member') {
  return toPermissionSubject({
    clientAdapter: 'dingtalk',
    conversation: { endpoint: { adapter: 'dingtalk', id: 'bot' }, kind: 'group', id: 'cid1' },
    sender: { id: 'u1', ...(chatRole ? { chatRole } : {}), ...(standing ? { platform: { standing } } : {}) },
  } as never);
}
const allowed = (permits: readonly string[] | undefined, s: ReturnType<typeof subject>) => (permits ?? []).every((p) => checkBuiltinPermit(p, s));

describe('DingTalk chat tools', () => {
  it('create_chat needs zhin trusted (or above), not an unreported platform permission (M4)', () => {
    expect(createChat.permissions).toEqual(['trusted']);
    expect(allowed(createChat.permissions, subject('trusted'))).toBe(true);
    expect(allowed(createChat.permissions, subject('owner'))).toBe(true);
    expect(allowed(createChat.permissions, subject(undefined, 'admin'))).toBe(false);
  });

  it('cross-group chat administration needs zhin owner; a group admin of the current group is not enough (H1)', () => {
    for (const tool of [addMembers, updateChat]) {
      expect(tool.permissions).toEqual(['owner']);
      expect(allowed(tool.permissions, subject(undefined, 'admin'))).toBe(false);
      expect(allowed(tool.permissions, subject('owner'))).toBe(true);
    }
  });
});
