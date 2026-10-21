import { describe, it, expect, beforeEach } from 'vitest';
import { canAccessTool } from '@zhin.js/core';
import { PermissionHost, checkBuiltinPermit, toPermissionSubject } from '@zhin.js/permission';
import {
  checkTelegramPlatformPermit,
  normalizeTelegramChatMember,
  platformPermit,
} from '../src/platform-permit.js';

function mockSubject(sender: { role?: string; permissions?: string[] }) {
  return {
    adapter: 'telegram',
    sender: { id: 'u1', role: sender.role ? [sender.role] : [], permissions: sender.permissions },
    scene: { type: 'group', id: 'g1' },
  };
}

function mockMsg(sender: { role?: string; permissions?: string[] }) {
  return {
    clientAdapter: 'telegram',
    endpointId: 'bot1',
    conversation: { endpoint: { adapter: 'telegram', id: 'bot1' }, kind: 'group', id: 'g1' },
    sender: { id: 'u1', roles: sender.role ? [sender.role] : [] },
    metadata: { senderRole: sender.role, senderPermissions: sender.permissions },
  } as any;
}

describe('telegram platform-permit', () => {
  let host: PermissionHost;

  beforeEach(() => {
    host = new PermissionHost();
    host.registerPlatform('telegram', (perm, subject) => checkTelegramPlatformPermit(perm, subject));
  });

  it('normalizeTelegramChatMember 映射 creator/administrator 为规范角色 owner/admin', () => {
    expect(normalizeTelegramChatMember({ status: 'creator' }).role).toBe('owner');
    const admin = normalizeTelegramChatMember({
      status: 'administrator',
      can_pin_messages: true,
      can_restrict_members: true,
    });
    expect(admin.role).toBe('admin');
    expect(admin.permissions).toContain('pin_messages');
    expect(admin.permissions).toContain('restrict_members');
  });

  it('checkTelegramPlatformPermit 三档', () => {
    expect(checkTelegramPlatformPermit('chat_creator', mockSubject({ role: 'owner', permissions: ['chat_creator'] }))).toBe(true);
    expect(checkTelegramPlatformPermit('pin_messages', mockSubject({ role: 'member', permissions: [] }))).toBe(false);
    expect(checkTelegramPlatformPermit('pin_messages', mockSubject({ role: 'admin', permissions: ['pin_messages'] }))).toBe(true);
  });

  it('canAccessTool 与 platform permit 联动', async () => {
    const tool = {
      name: 't',
      description: 'd',
      parameters: { type: 'object' as const, properties: {} },
      permissions: [platformPermit('pin_messages')],
      execute: async () => '',
    };
    expect(await canAccessTool(tool, mockMsg({ role: 'member', permissions: [] }), host)).toBe(false);
    expect(await canAccessTool(tool, mockMsg({ role: 'creator', permissions: ['chat_creator'] }), host)).toBe(true);
  });

  it('投影后的 creator / administrator 满足 role(owner,admin,master)，普通成员不满足', () => {
    for (const [status, expected] of [['creator', true], ['administrator', true], ['member', false]] as const) {
      const member = normalizeTelegramChatMember({ status });
      const subject = toPermissionSubject({
        clientAdapter: 'telegram',
        conversation: { endpoint: { adapter: 'telegram', id: 'bot1' }, kind: 'group', id: 'g1' },
        sender: { id: 'u1', roles: member.role ? [member.role] : [] },
        metadata: { senderRole: member.role, senderPermissions: member.permissions },
      });
      expect(checkBuiltinPermit('role(owner,admin,master)', subject)).toBe(expected);
    }
  });
});
