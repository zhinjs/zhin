import { describe, it, expect, beforeEach } from 'vitest';
import { assertCanonicalSegments, canAccessTool, toCanonicalSegments } from '@zhin.js/core';
import { PermissionHost, checkBuiltinPermit, toPermissionSubject } from '@zhin.js/permission';
import { platformPermit, telegramChatMemberStanding } from '../src/platform-permit.js';
import { formatOutboundActions } from '../src/protocol.js';
import * as telegram from '../src/index.js';
import setPermissions from '../agents/telegram/skills/telegram-group-permissions/tools/set_permissions/index.js';
import setDescription from '../agents/telegram/skills/telegram-chat-admin/tools/set_description/index.js';
import createInvite from '../agents/telegram/skills/telegram-chat-admin/tools/create_invite/index.js';
import pinMessage from '../agents/telegram/skills/telegram-chat-admin/tools/pin_message/index.js';
import unpinMessage from '../agents/telegram/skills/telegram-chat-admin/tools/unpin_message/index.js';
import listAdmins from '../agents/telegram/skills/telegram-chat-admin/tools/list_admins/index.js';
import memberCount from '../agents/telegram/skills/telegram-chat-admin/tools/member_count/index.js';
import react from '../agents/telegram/skills/telegram-messages/tools/react/index.js';
import sendPoll from '../agents/telegram/skills/telegram-messages/tools/send_poll/index.js';
import sendSticker from '../agents/telegram/skills/telegram-messages/tools/send_sticker/index.js';

function mockMsg(platformPermissions: string[]) {
  return {
    clientAdapter: 'telegram',
    endpointId: 'bot1',
    conversation: { endpoint: { adapter: 'telegram', id: 'bot1' }, kind: 'group', id: 'g1' },
    sender: { id: 'u1', platform: { standing: 'member' as const, permissions: platformPermissions } },
  } as any;
}

function toolContext(client: Record<string, unknown>, kind: 'group' | 'private' = 'group', send = vi.fn(async (_request: unknown) => ({ status: 'sent', message: { id: '7' } }))) {
  const conversation = { endpoint: { adapter: 'telegram', id: 'bot1' }, kind, id: kind === 'private' ? '42' : '-1001' };
  return { locale: 'en', $client: client, signal: new AbortController().signal, owner: { id: 'telegram-plugin' }, use: () => ({ send }),
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

describe('telegram chat / message tools without a cross-chat permit', () => {
  it.each([['list_admins', listAdmins], ['member_count', memberCount], ['react', react], ['send_poll', sendPoll],
    ['send_sticker', sendSticker]] as const)('%s has no chat_id input', (_name, tool) => {
    expect((tool.inputSchema as unknown as { shape: Record<string, unknown> }).shape).not.toHaveProperty('chat_id');
  });

  it('act on the current chat even when the model names another one', async () => {
    const client = {
      getChatAdmins: vi.fn(async () => []), getChatMemberCount: vi.fn(async () => 3),
      setMessageReaction: vi.fn(async () => true), sendPoll: vi.fn(), sendStickerMessage: vi.fn(),
    };
    const send = vi.fn(async (_request: unknown) => ({ status: 'sent', message: { id: '7' } }));
    await listAdmins.execute({ chat_id: '-2002' } as never, toolContext(client));
    expect(client.getChatAdmins).toHaveBeenCalledWith(-1001);
    await memberCount.execute({ chat_id: '-2002' } as never, toolContext(client));
    expect(client.getChatMemberCount).toHaveBeenCalledWith(-1001);
    await react.execute({ chat_id: '-2002', message_id: '5', reaction: '👍' } as never, toolContext(client));
    expect(client.setMessageReaction).toHaveBeenCalledWith(-1001, 5, '👍');
    await sendPoll.execute({ chat_id: '-2002', question: 'q', options: '["a","b"]' } as never, toolContext(client, 'group', send));
    await sendSticker.execute({ chat_id: '-2002', sticker: 's' } as never, toolContext(client, 'group', send));
    // Polls and stickers go through the IM outbound chain to the current chat, never the client directly.
    expect(client.sendPoll).not.toHaveBeenCalled();
    expect(client.sendStickerMessage).not.toHaveBeenCalled();
    expect(send.mock.calls.map(([request]) => request)).toEqual([
      expect.objectContaining({ conversation: expect.objectContaining({ id: '-1001' }), content: { type: 'telegram:poll', data: { question: 'q', options: ['a', 'b'], is_anonymous: true, allows_multiple_answers: false } } }),
      expect.objectContaining({ conversation: expect.objectContaining({ id: '-1001' }), content: { type: 'telegram:sticker', data: { sticker: 's' } } }),
    ]);
  });

  it('message tools also work in the current private chat; directory tools need a group', async () => {
    const client = { setMessageReaction: vi.fn(async () => true), getChatAdmins: vi.fn() };
    const send = vi.fn(async (_request: unknown) => ({ status: 'sent', message: { id: '7' } }));
    await react.execute({ message_id: '5', reaction: '👍' }, toolContext(client, 'private'));
    expect(client.setMessageReaction).toHaveBeenCalledWith(42, 5, '👍');
    await sendSticker.execute({ sticker: 's' }, toolContext(client, 'private', send));
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ conversation: expect.objectContaining({ kind: 'private', id: '42' }) }));
    await expect(listAdmins.execute({}, toolContext(client, 'private'))).rejects.toThrow('Telegram group');
    expect(client.getChatAdmins).not.toHaveBeenCalled();
  });
});

describe('telegram namespaced outbound segments', () => {
  it('survive core normalization and encode to sendSticker / sendPoll', () => {
    const segments = toCanonicalSegments([
      { type: 'telegram:sticker', data: { sticker: 'CAACAgIAAxk' } },
      { type: 'telegram:poll', data: { question: 'q', options: ['a', 'b'], is_anonymous: false, allows_multiple_answers: true } },
    ]);
    expect(() => assertCanonicalSegments(segments)).not.toThrow();
    expect(formatOutboundActions('-1001', segments)).toEqual([
      { method: 'sendSticker', params: { chat_id: -1001, sticker: 'CAACAgIAAxk' } },
      { method: 'sendPoll', params: { chat_id: -1001, question: 'q', options: ['a', 'b'], is_anonymous: false, allows_multiple_answers: true } },
    ]);
  });

  it('refuse host paths for stickers and polls without options', () => {
    for (const sticker of ['/etc/passwd', 'file:///etc/passwd', '..\\secret', 'base64://AAAA']) {
      expect(() => formatOutboundActions('1', [{ type: 'telegram:sticker', data: { sticker } }])).toThrow('file_id');
    }
    expect(formatOutboundActions('1', [{ type: 'telegram:sticker', data: { sticker: 'https://example.com/s.webp' } }])[0]!.method).toBe('sendSticker');
    expect(() => formatOutboundActions('1', [{ type: 'telegram:poll', data: { question: 'q', options: ['a'] } }])).toThrow('two options');
  });
});
