import { describe, expect, it } from 'vitest';
import { checkBuiltinPermit, toPermissionSubject } from '@zhin.js/permission';
import uploadFile from '../agents/lark/skills/lark/tools/upload_file/index.js';

function subject(level: 'global' | 'conversation') {
  return toPermissionSubject({
    clientAdapter: 'lark',
    conversation: { endpoint: { adapter: 'lark', id: 'bot' }, kind: 'group', id: 'oc_1' },
    sender: { id: 'u1', chatRole: 'owner', chatRoleLevels: { owner: level, admin: level, trusted: level }, platform: { standing: 'owner' } },
  } as never);
}

describe('lark_upload_file', () => {
  it('reads a host file, so only a global zhin owner may use it (a group owner or conversation owner may not)', () => {
    expect(uploadFile.permissions).toEqual(['owner@global']);
    expect(uploadFile.permissions!.every((p) => checkBuiltinPermit(p, subject('global')))).toBe(true);
    expect(uploadFile.permissions!.every((p) => checkBuiltinPermit(p, subject('conversation')))).toBe(false);
  });
});
