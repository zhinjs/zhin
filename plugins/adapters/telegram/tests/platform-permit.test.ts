import { describe, it, expect, beforeEach } from 'vitest';
import { canAccessTool } from '@zhin.js/core';
import { PermissionHost, checkBuiltinPermit, toPermissionSubject } from '@zhin.js/permission';
import { resolveTurnCapabilities } from 'zhin.js/adapter';
import telegram from '../adapters/telegram/index.js';
import {
  checkTelegramPlatformPermit,
  normalizeTelegramChatMember,
  telegramChatMemberStanding,
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
    sender: { id: 'u1', ...(sender.role ? { platform: { standing: sender.role, permissions: sender.permissions } } : {}) },
    metadata: {},
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

  it('telegramChatMemberStanding 归一 ChatMember（ADR 0056 §1）', () => {
    expect(telegramChatMemberStanding({ status: 'creator' })).toMatchObject({ standing: 'owner', permissions: expect.arrayContaining(['restrict_members', 'pin_messages', 'promote_members']) });
    expect(telegramChatMemberStanding({ status: 'administrator', can_restrict_members: true, can_pin_messages: false, can_delete_messages: true } as never))
      .toEqual({ standing: 'admin', permissions: ['restrict_members', 'delete_messages'] });
    expect(telegramChatMemberStanding({ status: 'member' })).toEqual({ standing: 'member' });
    expect(telegramChatMemberStanding({ status: 'restricted', is_member: true, can_send_messages: true } as never)).toEqual({ standing: 'member', permissions: ['send_messages'] });
    expect(telegramChatMemberStanding({ status: 'restricted', is_member: false })).toEqual({ standing: 'guest' });
    expect(telegramChatMemberStanding({ status: 'left' })).toEqual({ standing: 'guest' });
    expect(telegramChatMemberStanding({ status: 'kicked' })).toEqual({ standing: 'guest' });
  });

  it('能力画像为群聊声明 standing + permissions', () => {
    const conversation = (kind: 'group' | 'private') => ({ endpoint: { id: 'e', adapter: 'telegram' }, kind, id: '1' });
    expect(resolveTurnCapabilities({ profile: telegram.profile!, conversation: conversation('group') }).get('scene.platformStanding')).toEqual({ standing: true, permissions: true });
    expect(resolveTurnCapabilities({ profile: telegram.profile!, conversation: conversation('private') }).has('scene.platformStanding')).toBe(false);
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
    expect(await canAccessTool(tool, mockMsg({ role: 'owner', permissions: ['pin_messages'] }), host)).toBe(true);
    expect(await canAccessTool(tool, mockMsg({ role: 'admin', permissions: ['pin_messages'] }), host)).toBe(true);
  });

  it('投影后的 creator / administrator 满足 role(owner,admin,master)，普通成员不满足', () => {
    for (const [status, expected] of [['creator', true], ['administrator', true], ['member', false]] as const) {
      const subject = toPermissionSubject({
        clientAdapter: 'telegram',
        conversation: { endpoint: { adapter: 'telegram', id: 'bot1' }, kind: 'group', id: 'g1' },
        sender: { id: 'u1', platform: telegramChatMemberStanding({ status }) },
      });
      expect(checkBuiltinPermit('role(owner,admin,master)', subject)).toBe(expected);
    }
  });
});
