import { describe, it, expect, vi } from 'vitest';
import { PermissionHost } from '../src/host.js';
import {
  assertPermitSyntax, checkBuiltinPermit, isBuiltinPermit, parsePermitName, permitsNeedBotStanding, removedPermitReplacement,
} from '../src/builtin.js';
import { describeDeniedPermit, explainPermitRules } from '../src/explain.js';
import { toPermissionSubject, type PermissionSubject } from '../src/subject.js';

const subject = (overrides: Partial<PermissionSubject> = {}): PermissionSubject => ({
  adapter: 'qq', endpoint: 'e1', scene: { id: 'g1', type: 'group' }, sender: { id: 'u1' }, ...overrides,
});

describe('three dimensions (ADR 0056 §5): sender zhin role, sender platform standing, Bot standing', () => {
  it('parses bot:owner|admin, bot-role:<id> and bot-permission:<name>', () => {
    expect(parsePermitName('bot:admin')).toEqual({ kind: 'bot', values: ['admin'] });
    expect(parsePermitName('bot:owner')).toEqual({ kind: 'bot', values: ['owner'] });
    expect(parsePermitName('bot-role:42')).toEqual({ kind: 'bot-role', values: ['42'] });
    expect(parsePermitName('bot-permission:ban_members')).toEqual({ kind: 'bot-permission', values: ['ban_members'] });
    expect(isBuiltinPermit('bot:member')).toBe(false);
    expect(isBuiltinPermit('bot:')).toBe(false);
    expect(() => assertPermitSyntax(['bot:member'])).toThrow(/bot:owner\|admin/u);
    // A valid spelling is never reported as removed.
    expect(removedPermitReplacement('role(trusted)')).toBeUndefined();
    expect(removedPermitReplacement('bot:admin')).toBeUndefined();
  });

  it('reads only subject.bot for bot:* and never the sender', () => {
    const admin = { standing: 'admin' as const, roles: [{ id: '7' }], permissions: ['ban_members'] };
    expect(checkBuiltinPermit('bot:admin', subject({ bot: admin }))).toBe(true);
    expect(checkBuiltinPermit('bot:owner', subject({ bot: admin }))).toBe(false);
    expect(checkBuiltinPermit('bot:admin', subject({ bot: { standing: 'owner' } }))).toBe(true);
    expect(checkBuiltinPermit('bot-role:7', subject({ bot: admin }))).toBe(true);
    expect(checkBuiltinPermit('bot-permission:ban_members', subject({ bot: admin }))).toBe(true);
    expect(checkBuiltinPermit('bot-permission:kick_members', subject({ bot: admin }))).toBe(false);
    // The sender being a group admin does not make the Bot one, and vice versa.
    expect(checkBuiltinPermit('bot:admin', subject({ sender: { id: 'u1', platform: admin } }))).toBe(false);
    expect(checkBuiltinPermit('platform:admin', subject({ bot: admin }))).toBe(false);
    // Unknown Bot standing fails closed.
    expect(checkBuiltinPermit('bot:admin', subject())).toBe(false);
    // Platform standing is not a zhin role.
    expect(checkBuiltinPermit('admin', subject({ sender: { id: 'u1', platform: { standing: 'owner' } } }))).toBe(false);
  });

  it('combines the dimensions with the list AND', async () => {
    const host = new PermissionHost();
    const both = subject({ sender: { id: 'u1', platform: { standing: 'admin' } }, bot: { standing: 'admin' } });
    expect(await host.checkAll(['platform:admin', 'bot:admin'], both)).toBe(true);
    expect(await host.checkAll(['platform:admin', 'bot:admin'], { ...both, bot: { standing: 'member' } })).toBe(false);
    expect(await host.checkAll(['trusted', 'bot:admin'], { ...both, sender: { id: 'u1', chatRole: 'owner' } })).toBe(true);
    expect(await host.firstDenied(['platform:admin', 'bot:admin'], { ...both, bot: { standing: 'member' } })).toBe('bot:admin');
  });

  it('resolves subject.bot through the installed resolver only when a bot:* permit needs it', async () => {
    const host = new PermissionHost();
    const resolver = vi.fn(async (_source: unknown, options: { cachedOnly?: boolean }) => (options.cachedOnly ? undefined : { standing: 'admin' as const }));
    const dispose = host.setBotStandingResolver(resolver);
    const source = { conversation: { endpoint: { id: 'ep' }, kind: 'group', id: 'g1' } };
    expect(await host.checkAll(['group()'], subject(), { source })).toBe(true);
    expect(resolver).not.toHaveBeenCalled();
    expect(permitsNeedBotStanding(['group()', 'bot:admin'])).toBe(true);
    expect(await host.checkAll(['bot:admin'], subject(), { source })).toBe(true);
    expect(await host.checkAll(['bot:admin'], subject(), { source, cachedOnly: true })).toBe(false);
    expect(resolver).toHaveBeenLastCalledWith(source, { cachedOnly: true });
    // Without a source nothing is resolved; a throwing resolver means unknown.
    expect(await host.checkAll(['bot:admin'], subject())).toBe(false);
    host.setBotStandingResolver(() => { throw new Error('platform down'); });
    expect(await host.checkAll(['bot:admin'], subject(), { source })).toBe(false);
    dispose();
  });

  it('explains which condition is missing', () => {
    expect(describeDeniedPermit('bot:admin', 'zh-CN')).toBe('机器人不是本群管理员（或无法确认其身份）。');
    expect(describeDeniedPermit('bot-permission:ban_members', 'en')).toContain('ban_members');
    expect(describeDeniedPermit('platform:owner', 'zh-CN')).toBe('需要你是本群群主。');
    expect(explainPermitRules(['bot:admin'], subject())[0]).toMatchObject({ kind: 'bot', outcome: 'unknown' });
    expect(explainPermitRules(['bot:admin'], subject({ bot: { standing: 'admin' } }))[0]).toMatchObject({ outcome: 'match' });
  });

  it('never projects a Bot standing from message-like input', () => {
    expect(toPermissionSubject({ sender: { id: 'u' }, bot: { standing: 'owner' } }).bot).toBeUndefined();
  });
});
