import { describe, it, expect, beforeEach } from 'vitest';
import { canAccessTool } from '@zhin.js/core';
import { PermissionHost, checkBuiltinPermit, toPermissionSubject } from '@zhin.js/permission';
import { platformPermit, telegramChatMemberStanding } from '../src/platform-permit.js';
import * as telegram from '../src/index.js';
import setPermissions from '../agents/telegram/skills/telegram-group-permissions/tools/set_permissions/index.js';
import setDescription from '../agents/telegram/skills/telegram-chat-admin/tools/set_description/index.js';
import createInvite from '../agents/telegram/skills/telegram-chat-admin/tools/create_invite/index.js';
import pinMessage from '../agents/telegram/skills/telegram-chat-admin/tools/pin_message/index.js';
import unpinMessage from '../agents/telegram/skills/telegram-chat-admin/tools/unpin_message/index.js';

function mockMsg(platformPermissions: string[]) {
  return {
    clientAdapter: 'telegram',
    endpointId: 'bot1',
    conversation: { endpoint: { adapter: 'telegram', id: 'bot1' }, kind: 'group', id: 'g1' },
    sender: { id: 'u1', platform: { standing: 'member' as const, permissions: platformPermissions } },
  } as any;
}

function toolContext(client: Record<string, unknown>, kind: 'group' | 'private' = 'group') {
  const conversation = { endpoint: { adapter: 'telegram', id: 'bot1' }, kind, id: '-1001' };
  return { locale: 'en', $client: client, signal: new AbortController().signal,
    origin: { kind: 'im', platform: 'telegram', conversation } } as never;
}

describe('telegram platform-permit', () => {
  let host: PermissionHost;

  beforeEach(() => {
    host = new PermissionHost();
  });

  it('no longer exports the legacy permit resolver / checker', () => {
    expect(telegram).not.toHaveProperty('telegramGroupPermitResolver');
    expect(telegram).not.toHaveProperty('checkTelegramPlatformPermit');
    expect(telegram).not.toHaveProperty('normalizeTelegramChatMember');
  });

  it('canAccessTool 与 platform permit 联动', async () => {
    const tool = {
      name: 't',
      description: 'd',
      parameters: { type: 'object' as const, properties: {} },
      permissions: [platformPermit('pin_messages')],
      execute: async () => '',
    };
    expect(await canAccessTool(tool, mockMsg([]), host)).toBe(false);
    expect(await canAccessTool(tool, mockMsg(['pin_messages']), host)).toBe(true);
  });

  it('投影后的 creator / administrator 满足 platform:admin，普通成员不满足', () => {
    for (const [status, expected] of [['creator', true], ['administrator', true], ['member', false]] as const) {
      const subject = toPermissionSubject({
        clientAdapter: 'telegram',
        conversation: { endpoint: { adapter: 'telegram', id: 'bot1' }, kind: 'group', id: 'g1' },
        sender: { id: 'u1', platform: telegramChatMemberStanding({ status }) },
      });
      expect(checkBuiltinPermit('platform:admin', subject)).toBe(expected);
    }
  });

  it('only administrator rights become platform permissions (restricted / member alike report none)', () => {
    expect(telegramChatMemberStanding({ status: 'administrator', can_pin_messages: true, can_restrict_members: true } as never))
      .toEqual({ standing: 'admin', permissions: ['pin_messages', 'restrict_members'] });
    expect(telegramChatMemberStanding({ status: 'restricted', is_member: true, can_pin_messages: true, can_invite_users: true } as never))
      .toEqual({ standing: 'member' });
    expect(telegramChatMemberStanding({ status: 'member' })).toEqual({ standing: 'member' });
    expect(telegramChatMemberStanding({ status: 'creator' }).permissions).toEqual(expect.arrayContaining(['restrict_members', 'change_info', 'invite_users']));
  });
});

describe('telegram chat administration tools', () => {
  it('require the specific administrator right each action needs', () => {
    expect(setPermissions.permissions).toEqual(['platform-permission:restrict_members', 'bot-permission:restrict_members']);
    expect(setDescription.permissions).toEqual(['platform-permission:change_info', 'bot-permission:change_info']);
    expect(createInvite.permissions).toEqual(['platform-permission:invite_users', 'bot-permission:invite_users']);
  });

  it.each([['set_permissions', setPermissions], ['set_description', setDescription], ['create_invite', createInvite],
    ['pin_message', pinMessage], ['unpin_message', unpinMessage]] as const)('%s has no chat_id input', (_name, tool) => {
    expect((tool.inputSchema as unknown as { shape: Record<string, unknown> }).shape).not.toHaveProperty('chat_id');
  });

  it('acts on the current chat even when the model names another one', async () => {
    const client = {
      setChatPermissionsAll: vi.fn(async () => true), setChatDescription: vi.fn(async () => true),
      createInviteLink: vi.fn(async () => 'https://t.me/+x'), pinMessage: vi.fn(async () => true), unpinMessage: vi.fn(async () => true),
    };
    await setPermissions.execute({ chat_id: '-2002', can_send_messages: false } as never, toolContext(client));
    expect(client.setChatPermissionsAll).toHaveBeenCalledWith(-1001, { can_send_messages: false });
    await setDescription.execute({ chat_id: '-2002', description: 'd' } as never, toolContext(client));
    expect(client.setChatDescription).toHaveBeenCalledWith(-1001, 'd');
    await createInvite.execute({ chat_id: '-2002' } as never, toolContext(client));
    expect(client.createInviteLink).toHaveBeenCalledWith(-1001);
    await pinMessage.execute({ chat_id: '-2002', message_id: '5' } as never, toolContext(client));
    expect(client.pinMessage).toHaveBeenCalledWith(-1001, 5);
    await unpinMessage.execute({ chat_id: '-2002' } as never, toolContext(client));
    expect(client.unpinMessage).toHaveBeenCalledWith(-1001, undefined);
  });

  it('refuses outside a group or channel', async () => {
    const client = { setChatDescription: vi.fn(async () => true) };
    await expect(setDescription.execute({ description: 'd' }, toolContext(client, 'private'))).rejects.toThrow('Telegram group');
    expect(client.setChatDescription).not.toHaveBeenCalled();
  });
});
