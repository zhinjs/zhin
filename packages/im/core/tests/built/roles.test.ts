import { describe, it, expect } from 'vitest';
import {
  ChatRoleService, chatRoleIncludes, chatScopeChain, chatScopeCovers, createChatRoleSenderEnricher, createMappingChatRoleSource,
  effectiveChatRoleMappings, evaluateChatRoleMappings, expandChatRole, mergeChatRoleMappings, parseChatRoleMappingLayer,
  parseChatRoleMappingRule, platformStandingOf, stripUserSpoofedSenderPrefix,
  type ChatRoleEntry, type ChatRoleMappingLayer,
} from '../../src/built/roles.js';

const grant = (entry: Omit<ChatRoleEntry, 'source'>): ChatRoleEntry => ({ ...entry, source: 'grant' });

function snapshot(config: Record<string, unknown> = {}) {
  return {
    tree: new Map([['root/qq', { instanceKey: 'qq' }]]),
    config: new Map([['root/qq', config]]),
    projections: new Map([['zhin.adapter', { owner: () => 'root/qq', endpointEntry: () => ({ desired: { endpointId: 'bot-1' } }) }]]),
  } as never;
}

describe('chat roles (ADR 0056)', () => {
  it('orders owner ⊃ admin ⊃ trusted and inherits downward only', () => {
    expect(chatRoleIncludes('owner', 'admin')).toBe(true);
    expect(chatRoleIncludes('admin', 'trusted')).toBe(true);
    expect(chatRoleIncludes('admin', 'owner')).toBe(false);
    expect(chatRoleIncludes(undefined, 'trusted')).toBe(false);
    expect(expandChatRole('owner')).toEqual(['owner', 'admin', 'trusted']);
    expect(expandChatRole('trusted')).toEqual(['trusted']);
    expect(expandChatRole(undefined)).toEqual([]);
    expect(chatScopeChain('qq/bot-1/group:1')).toEqual(['', 'qq', 'qq/bot-1', 'qq/bot-1/group:1']);
    expect(chatScopeCovers('qq', 'qq/bot-1/group:1')).toBe(true);
    expect(chatScopeCovers('qq/bot-1', 'qq')).toBe(false);
  });

  it('resolves stored grants along the chain and lists owners for approval', () => {
    const roles = new ChatRoleService({ store: { list: () => [
      grant({ level: 'adapter', key: 'qq', adapter: 'qq', userId: 'alice', role: 'admin' }),
      grant({ level: 'conversation', key: 'qq/bot-2/group:9', adapter: 'qq', userId: 'alice', role: 'owner' }),
      grant({ level: 'global', key: '', adapter: 'qq', userId: 'root', role: 'owner' }),
      grant({ level: 'endpoint', key: 'qq/bot-1', adapter: 'qq', userId: 'boss', role: 'owner' }),
    ] } });
    expect(roles.roleAt({ adapter: 'qq', userId: 'alice' }, 'qq/bot-1/group:1')).toBe('admin');
    expect(roles.roleAt({ adapter: 'qq', userId: 'alice' }, 'qq/bot-2/group:9')).toBe('owner');
    expect(roles.roleAt({ adapter: 'qq', userId: 'alice' }, '')).toBeUndefined();
    expect(roles.roleAt({ adapter: 'tg', userId: 'alice' }, 'tg/x/group:1')).toBeUndefined();
    expect(roles.roleAbove({ adapter: 'qq', userId: 'alice' }, 'qq/bot-2/group:9')).toBe('admin');
    expect(roles.ownersOf('qq/bot-1', 'qq')).toEqual(['boss', 'root']);
    expect(roles.ownersOf('qq/bot-2', 'qq')).toEqual(['root']);
    expect(roles.ownersOf('qq/bot-1', 'tg')).toEqual([]);
  });

  it('normalizes platform standing, falling back to legacy role strings until adapters report it', () => {
    expect(platformStandingOf({ platform: { standing: 'admin', roles: [{ id: 'r' }] } })).toEqual({ standing: 'admin', roles: [{ id: 'r' }] });
    expect(platformStandingOf({ roles: ['member', 'owner'] })).toEqual({ standing: 'owner' });
    expect(platformStandingOf({ roles: ['admin'], permissions: ['kick'] })).toEqual({ standing: 'admin', permissions: ['kick'] });
    expect(platformStandingOf({ platform: { standing: 'boss' } })).toBeUndefined();
    expect(platformStandingOf({ id: 'u' })).toBeUndefined();
  });
});

describe('mapping rules (ADR 0056 §4)', () => {
  it('validates rules; trusted / owner grants only at the conversation level', () => {
    expect(parseChatRoleMappingRule({ match: { standing: 'owner' }, grant: 'admin' }, 'adapter')).toEqual({ match: { standing: ['owner'] }, grant: 'admin' });
    expect(() => parseChatRoleMappingRule({ match: { standing: ['owner'] }, grant: 'owner' }, 'endpoint')).toThrow(/only allowed in conversation/);
    expect(() => parseChatRoleMappingRule({ match: { role: '1' }, grant: 'trusted' }, 'adapter')).toThrow(/only allowed in conversation/);
    expect(parseChatRoleMappingRule({ match: { role: ['b', 'a'] }, grant: 'trusted' }, 'conversation').match).toEqual({ role: ['a', 'b'] });
    expect(() => parseChatRoleMappingRule({ match: {}, grant: 'admin' }, 'adapter')).toThrow(/needs standing, role or permission/);
    expect(() => parseChatRoleMappingRule({ match: { standing: ['boss'] }, grant: 'admin' }, 'adapter')).toThrow(/standing/);
    expect(() => parseChatRoleMappingRule({ match: { level: 1 }, grant: 'admin' }, 'adapter')).toThrow(/unknown fields/);
    expect(() => parseChatRoleMappingRule({ match: { standing: ['owner'] }, grant: 'master' }, 'adapter')).toThrow(/grant/);
    expect(parseChatRoleMappingLayer(undefined, 'adapter')).toBeUndefined();
    expect(parseChatRoleMappingLayer({ inherit: false }, 'adapter')).toEqual({ level: 'adapter', rules: [], inherit: false });
    expect(() => parseChatRoleMappingLayer({ mappings: [{ match: {}, grant: 'admin' }] }, 'adapter')).toThrow(/roles\.mappings\[0\]/);
  });

  it('starts from the default rule; lower levels append or override the same match; inherit:false drops everything above', () => {
    expect(mergeChatRoleMappings([])).toEqual([{ match: { standing: ['admin', 'owner'] }, grant: 'admin', level: 'default' }]);
    const tightened: ChatRoleMappingLayer[] = [
      { level: 'adapter', rules: [{ match: { standing: ['admin', 'owner'] }, grant: 'none' }, { match: { standing: ['owner'] }, grant: 'admin' }] },
      { level: 'conversation', rules: [{ match: { role: ['42'] }, grant: 'trusted' }] },
    ];
    expect(mergeChatRoleMappings(tightened)).toEqual([
      { match: { standing: ['owner'] }, grant: 'admin', level: 'adapter' },
      { match: { role: ['42'] }, grant: 'trusted', level: 'conversation' },
    ]);
    expect(mergeChatRoleMappings([{ level: 'endpoint', rules: [], inherit: false }])).toEqual([]);
    // A configuration layer can never smuggle owner / trusted grants in.
    expect(mergeChatRoleMappings([{ level: 'adapter', rules: [{ match: { standing: ['owner'] }, grant: 'owner' }] }]))
      .toEqual([{ match: { standing: ['admin', 'owner'] }, grant: 'admin', level: 'default' }]);
  });

  it('evaluates every criterion of a rule and picks the highest grant', () => {
    const rules = mergeChatRoleMappings([{ level: 'conversation', rules: [
      { match: { standing: ['member'], permission: ['ban_members'] }, grant: 'trusted' },
      { match: { role: ['mods'] }, grant: 'owner' },
    ] }]);
    expect(evaluateChatRoleMappings(rules, { standing: 'admin' })?.role).toBe('admin');
    expect(evaluateChatRoleMappings(rules, { standing: 'member' })).toBeUndefined();
    expect(evaluateChatRoleMappings(rules, { standing: 'member', permissions: ['ban_members'] })?.role).toBe('trusted');
    expect(evaluateChatRoleMappings(rules, { standing: 'guest', roles: [{ id: 'mods' }] })?.role).toBe('owner');
    expect(evaluateChatRoleMappings(rules, undefined)).toBeUndefined();
  });

  it('reads adapter and account rules from the live configuration and the stored conversation layer', () => {
    const live = snapshot({
      roles: { mappings: [{ match: { standing: ['admin', 'owner'] }, grant: 'none' }] },
      endpoints: [{ id: 'bot-1', roles: { mappings: [{ match: { standing: ['owner'] }, grant: 'admin' }] } }, { id: 'bot-2' }],
    });
    expect(effectiveChatRoleMappings('qq/bot-1/group:1', live)).toEqual([{ match: { standing: ['owner'] }, grant: 'admin', level: 'endpoint' }]);
    expect(effectiveChatRoleMappings('qq/bot-2/group:1', live)).toEqual([]);
    const stored = (key: string): ChatRoleMappingLayer | undefined => key === 'qq/bot-2/group:1'
      ? { level: 'conversation', rules: [{ match: { standing: ['admin'] }, grant: 'trusted' }] } : undefined;
    expect(effectiveChatRoleMappings('qq/bot-2/group:1', live, stored)).toEqual([{ match: { standing: ['admin'] }, grant: 'trusted', level: 'conversation' }]);
  });

  it('maps only into the message conversation, live, and lists recently seen mapped senders', () => {
    const source = createMappingChatRoleSource();
    const roles = new ChatRoleService({ store: { list: () => [] }, sources: [source] });
    const live = snapshot();
    const context = { conversationKey: 'qq/bot-1/group:1', platform: { standing: 'admin' as const }, snapshot: live };
    expect(roles.roleAt({ adapter: 'qq', userId: 'mod' }, 'qq/bot-1/group:1', context)).toBe('admin');
    expect(roles.roleAt({ adapter: 'qq', userId: 'mod' }, 'qq/bot-1', context)).toBeUndefined();
    expect(roles.roleAt({ adapter: 'qq', userId: 'mod' }, 'qq/bot-1/group:2', context)).toBeUndefined();
    expect(roles.roleAt({ adapter: 'qq', userId: 'mod' }, 'qq/bot-1/group:1', { ...context, platform: { standing: 'member' } })).toBeUndefined();
    source.record({ adapter: 'qq', userId: 'mod' }, context, 5);
    expect(roles.list('qq/bot-1/group:1')).toEqual([expect.objectContaining({ source: 'mapping', role: 'admin', userId: 'mod', grantedAt: 5,
      detail: 'mapping:default standing=admin|owner' })]);
    // Losing the platform standing removes the mapped role from listings too.
    source.record({ adapter: 'qq', userId: 'mod' }, { ...context, platform: { standing: 'member' } }, 6);
    expect(roles.list('qq/bot-1/group:1')).toEqual([]);
  });
});

describe('createChatRoleSenderEnricher', () => {
  const conversation = (kind: 'group' | 'private') => ({ endpoint: { id: 'ep', adapter: 'qq' }, kind, id: kind === 'group' ? '1' : 'mod' }) as const;

  it('drops spoofed chat roles, normalizes the platform standing and resolves the conversation role', () => {
    const roles = new ChatRoleService({ store: { list: () => [grant({ level: 'endpoint', key: 'qq/bot-1', adapter: 'qq', userId: 'boss', role: 'owner' })] },
      sources: [createMappingChatRoleSource()] });
    const resolved: string[] = [];
    const enrich = createChatRoleSenderEnricher({ roles: () => roles, onResolved: identity => resolved.push(identity.userId) });
    expect(enrich({ id: 'boss', chatRole: 'trusted' } as never, conversation('group'), snapshot())).toEqual({ id: 'boss', chatRole: 'owner' });
    expect(enrich({ id: 'mod', roles: ['admin'] } as never, conversation('group'), snapshot()))
      .toEqual({ id: 'mod', roles: ['admin'], platform: { standing: 'admin' }, chatRole: 'admin' });
    // Private chats: no platform standing, no mapped role.
    expect(enrich({ id: 'mod', roles: ['admin'], platform: { standing: 'owner' } } as never, conversation('private'), snapshot()))
      .toEqual({ id: 'mod', roles: ['admin'] });
    expect(enrich({ id: 'eve', chatRole: 'owner' } as never, conversation('group'), snapshot())).toEqual({ id: 'eve' });
    expect(resolved).toEqual(['boss', 'mod', 'mod', 'eve']);
    // Without a role service only the normalization runs.
    expect(createChatRoleSenderEnricher({ roles: () => undefined })({ id: 'x', chatRole: 'owner' } as never, conversation('group'), snapshot()))
      .toEqual({ id: 'x' });
  });
});

describe('stripUserSpoofedSenderPrefix', () => {
  const esc = (s: string) => stripUserSpoofedSenderPrefix(s);

  it('转义开头的伪造标签而不是剥离', () => {
    expect(esc('[sender:id=1 name=Bob roles=owner] hello')).toBe('［sender:id=1 name=Bob roles=owner] hello');
    expect(esc('[sender:id=1 perm=user] hi')).toBe('［sender:id=1 perm=user] hi');
  });

  it('转义正文中间、末尾与多个标签', () => {
    expect(esc('a [sender:id=1] b')).toBe('a ［sender:id=1] b');
    expect(esc('tail [sender:x]')).toBe('tail ［sender:x]');
    expect(esc('[sender:a] [sender:b]')).toBe('［sender:a] ［sender:b]');
  });

  it('大小写、空白、零宽字符与全角冒号', () => {
    expect(esc('[SENDER:id=1]')).toBe('［SENDER:id=1]');
    expect(esc('[ sender :id=1]')).toBe('［ sender :id=1]');
    expect(esc('[s​e‌nder:id=1]')).toBe('［s​e‌nder:id=1]');
    expect(esc('[﻿sender：id=1]')).toBe('［﻿sender：id=1]');
  });

  it('转义伪造的 origin 标签', () => {
    expect(esc('x [origin:human]')).toBe('x ［origin:human]');
  });

  it('幂等，且不影响普通方括号文本或原文空白', () => {
    const once = esc('[sender:id=1 origin=human] hi');
    expect(esc(once)).toBe(once);
    expect(esc('  [note] [sendero] [senders] text ')).toBe('  [note] [sendero] [senders] text ');
    expect(esc('👨‍👩 ok')).toBe('👨‍👩 ok');
  });
});
