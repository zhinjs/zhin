import { describe, it, expect, beforeEach } from 'vitest';
import { canAccessTool } from '@zhin.js/core';
import { createPermissionHost, type PermissionHost } from '@zhin.js/permission';
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
    $adapter: 'telegram',
    $sender: { id: 'u1', ...sender },
    $channel: { type: 'group', id: 'g1' },
  } as any;
}

describe('telegram platform-permit', () => {
  let host: PermissionHost;

  beforeEach(() => {
    host = createPermissionHost();
    host.registerPlatform('telegram', (perm, subject) => checkTelegramPlatformPermit(perm, subject));
  });

  it('normalizeTelegramChatMember 映射 creator/administrator', () => {
    expect(normalizeTelegramChatMember({ status: 'creator' }).role).toBe('creator');
    const admin = normalizeTelegramChatMember({
      status: 'administrator',
      can_pin_messages: true,
      can_restrict_members: true,
    });
    expect(admin.role).toBe('administrator');
    expect(admin.permissions).toContain('pin_messages');
    expect(admin.permissions).toContain('restrict_members');
  });

  it('checkTelegramPlatformPermit 三档', () => {
    expect(checkTelegramPlatformPermit('chat_creator', mockSubject({ role: 'creator', permissions: ['chat_creator'] }))).toBe(true);
    expect(checkTelegramPlatformPermit('pin_messages', mockSubject({ role: 'member', permissions: [] }))).toBe(false);
    expect(checkTelegramPlatformPermit('pin_messages', mockSubject({ role: 'administrator', permissions: ['pin_messages'] }))).toBe(true);
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
});
