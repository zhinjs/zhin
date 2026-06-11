import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { canAccessTool, clearPlatformPermitCheckers } from 'zhin.js';
import {
  checkTelegramPlatformPermit,
  normalizeTelegramChatMember,
  platformPermit,
  registerTelegramPlatformPermitChecker,
} from '../src/platform-permit.js';

function mockMsg(sender: { role?: string; permissions?: string[] }) {
  return {
    $adapter: 'telegram',
    $sender: sender,
    $channel: { type: 'group', id: 'g1' },
  } as any;
}

describe('telegram platform-permit', () => {
  beforeEach(() => {
    clearPlatformPermitCheckers();
    registerTelegramPlatformPermitChecker();
  });
  afterEach(() => clearPlatformPermitCheckers());

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
    expect(checkTelegramPlatformPermit('chat_creator', mockMsg({ role: 'creator', permissions: ['chat_creator'] }))).toBe(true);
    expect(checkTelegramPlatformPermit('pin_messages', mockMsg({ role: 'member', permissions: [] }))).toBe(false);
    expect(checkTelegramPlatformPermit('pin_messages', mockMsg({ role: 'administrator', permissions: ['pin_messages'] }))).toBe(true);
  });

  it('canAccessTool 与 platform permit 联动', () => {
    const tool = {
      name: 't',
      description: 'd',
      parameters: { type: 'object', properties: {} },
      permissions: [platformPermit('pin_messages')],
      execute: async () => '',
    };
    expect(canAccessTool(tool, mockMsg({ role: 'member', permissions: [] }))).toBe(false);
    expect(canAccessTool(tool, mockMsg({ role: 'creator', permissions: ['chat_creator'] }))).toBe(true);
  });
});
