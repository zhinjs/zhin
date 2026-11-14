import { describe, expect, it } from 'vitest';
import { ChatRoleService, type ChatRoleEntry } from '../../src/built/roles.js';
import { chatRolesToken, createChatRoleReader, hasChatRole, implicitChatPrincipalId, isOwner } from '../../src/built/chat-role-reader.js';
import { renderCommandFeedback } from '../../src/plugin-runtime/im/command-feedback.js';

const grant = (entry: Omit<ChatRoleEntry, 'source'>): ChatRoleEntry => ({ ...entry, source: 'grant' });

function reader(entries: ChatRoleEntry[]) {
  const service = new ChatRoleService({ store: { list: () => entries } });
  const listeners = new Set<(change: never) => void>();
  return {
    listeners,
    reader: createChatRoleReader({
      roles: () => service,
      // Conversations of the test resolve to `qq/bot-1/<kind>:<id>`.
      conversationKey: conversation => `qq/bot-1/${conversation.kind}:${conversation.id}`,
      subscribe: listener => { listeners.add(listener as never); return () => listeners.delete(listener as never); },
    }),
  };
}

const conversation = (id = '100', kind: 'group' | 'private' = 'group') => ({ endpoint: { id: 'qq:bot-1' as never, adapter: 'qq' }, kind, id }) as never;

describe('chat role public API (ADR 0060 §6)', () => {
  it('isOwner defaults to a global owner; hasChatRole to the conversation chain', () => {
    expect(isOwner({ chatRole: 'owner', chatRoleLevels: { owner: 'global' } })).toBe(true);
    // A conversation-level owner is not the owner of the host.
    expect(isOwner({ chatRole: 'owner', chatRoleLevels: { owner: 'conversation' } })).toBe(false);
    expect(isOwner({ chatRole: 'owner', chatRoleLevels: { owner: 'conversation' } }, { level: 'conversation' })).toBe(true);
    // Without levels a role counts as conversation-level only (fail closed).
    expect(isOwner({ chatRole: 'owner' })).toBe(false);
    expect(isOwner(undefined)).toBe(false);
    expect(hasChatRole({ chatRole: 'admin' }, 'trusted')).toBe(true);
    expect(hasChatRole({ chatRole: 'trusted' }, 'admin')).toBe(false);
    expect(hasChatRole({ chatRole: 'admin', chatRoleLevels: { admin: 'endpoint', trusted: 'endpoint' } }, 'admin', { level: 'adapter' })).toBe(false);
    // A forged role string is not a role.
    expect(hasChatRole({ chatRole: 'root' }, 'trusted')).toBe(false);
    expect(chatRolesToken.id).toBe('zhin.chat-roles');
  });

  it('roleOf / holders / factsOf read stored grants along the scope chain', () => {
    const { reader: r, listeners } = reader([
      grant({ level: 'global', key: '', adapter: 'qq', userId: 'boss', role: 'owner' }),
      grant({ level: 'global', key: '', adapter: 'tg', userId: 'boss-tg', role: 'owner' }),
      grant({ level: 'endpoint', key: 'qq/bot-1', adapter: 'qq', userId: 'acct', role: 'owner' }),
      grant({ level: 'conversation', key: 'qq/bot-1/group:100', adapter: 'qq', userId: 'mod', role: 'admin' }),
    ]);
    expect(r.roleOf({ adapter: 'qq', userId: 'boss' })).toBe('owner');
    expect(r.roleOf({ adapter: 'qq', userId: 'acct' })).toBeUndefined();
    expect(r.roleOf({ adapter: 'qq', userId: 'acct' }, { level: 'endpoint', adapter: 'qq', endpointId: 'bot-1' })).toBe('owner');
    expect(r.roleOf({ adapter: 'qq', userId: 'mod' }, { level: 'conversation', conversation: conversation() })).toBe('admin');
    expect(r.roleOf({ adapter: 'qq', userId: 'mod' }, { level: 'conversation', conversation: conversation('200') })).toBeUndefined();
    // Default holders: global owners only.
    expect(r.holders('owner').map(person => person.id)).toEqual(['implicit:qq:boss', 'implicit:tg:boss-tg']);
    expect(r.holders('owner', { adapter: 'qq' }).map(person => person.identities[0]!.userId)).toEqual(['boss']);
    // At a scope: everything effective there; `level` keeps only grants held at that level or above.
    expect(r.holders('admin', { scope: { level: 'conversation', conversation: conversation() } }).map(person => person.id))
      .toEqual(['implicit:qq:boss', 'implicit:tg:boss-tg', 'implicit:qq:acct', 'implicit:qq:mod']);
    expect(r.holders('admin', { scope: { level: 'conversation', conversation: conversation() }, level: 'endpoint' }).map(person => person.id))
      .toEqual(['implicit:qq:boss', 'implicit:tg:boss-tg', 'implicit:qq:acct']);
    expect(r.principalOf({ adapter: 'qq', userId: 'x' })).toEqual({ id: implicitChatPrincipalId({ adapter: 'qq', userId: 'x' }), identities: [{ adapter: 'qq', userId: 'x' }] });
    expect(r.factsOf(conversation(), 'acct')).toEqual({ identity: { adapter: 'qq', userId: 'acct' }, chatRole: 'owner',
      chatRoleLevels: { owner: 'endpoint', admin: 'endpoint', trusted: 'endpoint' } });
    expect(r.factsOf(conversation(), 'stranger')).toEqual({ identity: { adapter: 'qq', userId: 'stranger' } });
    const unsubscribe = r.subscribe(() => undefined);
    expect(listeners.size).toBe(1);
    unsubscribe();
    expect(listeners.size).toBe(0);
  });

  it('a malformed scope or identity resolves to nothing', () => {
    const { reader: r } = reader([grant({ level: 'global', key: '', adapter: 'qq', userId: 'boss', role: 'owner' })]);
    expect(r.roleOf({ adapter: 'QQ!', userId: 'boss' })).toBeUndefined();
    expect(r.roleOf({ adapter: 'qq', userId: 'boss' }, { level: 'adapter', adapter: 'bad/alias' })).toBeUndefined();
    expect(r.holders('owner', { scope: { level: 'endpoint', adapter: 'qq', endpointId: '' } })).toEqual([]);
  });
});

describe('command denial text (ADR 0060 §5.3)', () => {
  const snapshot = { root: 'root', generation: 1, resources: new Map() } as never;
  const denied = (permit: string) => ({ matched: true, status: 'denied', command: 'x', owner: 'root/p', denial: { permit, reason: 'r' } }) as never;
  const message = (standing?: string) => ({ locale: 'zh-CN', sender: { id: 'u', ...(standing ? { platform: { standing } } : {}) },
    conversation: { endpoint: { id: 'e', adapter: 'qq' }, kind: 'group', id: 'g' } }) as never;

  it('points zhin role denials at the owner / Console, and tells group owners their standing is not a role', async () => {
    expect((await renderCommandFeedback(denied('owner@global'), message(), snapshot))?.content).toContain('Console「聊天角色」');
    expect((await renderCommandFeedback(denied('role(admin)'), message('owner'), snapshot))?.content).toContain('群主 / 群管理员的平台身份不等于 zhin 角色');
    // Never names the missing role or who holds it.
    expect((await renderCommandFeedback(denied('owner@global'), message(), snapshot))?.content).not.toContain('owner');
    // Platform conditions keep their own explanation; other conditions stay generic.
    expect((await renderCommandFeedback(denied('platform:admin'), message(), snapshot))?.content).toBe('无法执行此指令：r');
    expect((await renderCommandFeedback(denied('group'), message(), snapshot))?.content).toBe('没有权限执行此指令。');
  });
});
