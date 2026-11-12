import { describe, it, expect } from 'vitest';
import { PermissionHost } from '../src/host.js';
import type { PermissionSubject } from '../src/subject.js';

function makeSubject(overrides: Partial<PermissionSubject> = {}): PermissionSubject {
  return {
    adapter: 'qq',
    endpoint: 'e1',
    scene: { id: 'g1', type: 'group' },
    sender: { id: 'u1' },
    ...overrides,
  };
}

describe('PermissionHost', () => {
  describe('currentSenderRoles', () => {
    it('re-reads the sender role through the installed resolver, validated; undefined without one', () => {
      const host = new PermissionHost();
      expect(host.currentSenderRoles({ sender: { id: 'u1' } })).toBeUndefined();
      const dispose = host.setSenderRoleResolver(source => (source as { sender: { id: string } }).sender.id === 'u1'
        ? { chatRole: 'owner', chatRoleLevels: { owner: 'conversation', bogus: 'x' } as never }
        : { chatRole: 'master' as never });
      expect(host.currentSenderRoles({ sender: { id: 'u1' } })).toEqual({ chatRole: 'owner', chatRoleLevels: { owner: 'conversation' } });
      expect(host.currentSenderRoles({ sender: { id: 'u2' } })).toEqual({});
      dispose();
      expect(host.currentSenderRoles({ sender: { id: 'u1' } })).toBeUndefined();
      host.setSenderRoleResolver(() => { throw new Error('boom'); });
      expect(host.currentSenderRoles({ sender: { id: 'u1' } })).toBeUndefined();
    });
  });

  describe('check — builtin', () => {
    it('resolves builtin permits without extra registration', async () => {
      const host = new PermissionHost();
      expect(await host.check('adapter(qq)', makeSubject())).toBe(true);
      expect(await host.check('adapter(discord)', makeSubject())).toBe(false);
    });
  });

  describe('check — platform', () => {
    it('reads the normalized platform standing without any registration (ADR 0056)', async () => {
      const host = new PermissionHost();
      expect(await host.check('platform:admin', makeSubject({ sender: { id: 'u1', platform: { standing: 'admin' } } }))).toBe(true);
      expect(await host.check('platform:owner', makeSubject({ sender: { id: 'u1', platform: { standing: 'admin' } } }))).toBe(false);
      expect(await host.check('platform:admin', makeSubject())).toBe(false);
    });

    it('denies the removed platform(adapter,perm) form', async () => {
      const host = new PermissionHost();
      expect(await host.check('platform(qq,scene_admin)', makeSubject({ sender: { id: 'u1', platform: { standing: 'owner' } } }))).toBe(false);
    });
  });

  describe('check — custom register', () => {
    it('matches by exact name string', async () => {
      const host = new PermissionHost();
      host.register('can_deploy', () => true);
      expect(await host.check('can_deploy', makeSubject())).toBe(true);
    });

    it('matches by RegExp', async () => {
      const host = new PermissionHost();
      host.register(/^feature\./, () => true);
      expect(await host.check('feature.deploy', makeSubject())).toBe(true);
      expect(await host.check('other.thing', makeSubject())).toBe(false);
    });

    it('normalizes stateful RegExp matchers at the registration boundary', async () => {
      const host = new PermissionHost();
      const matcher = /^feature\./g;
      host.register(matcher, () => true);

      expect(await host.check('feature.deploy', makeSubject())).toBe(true);
      expect(await host.check('feature.deploy', makeSubject())).toBe(true);
      expect(matcher.lastIndex).toBe(0);
    });

    it('disposes custom checker', async () => {
      const host = new PermissionHost();
      const dispose = host.register('x', () => true);
      expect(await host.check('x', makeSubject())).toBe(true);
      dispose();
      expect(await host.check('x', makeSubject())).toBe(false);
    });

    it('async custom checker', async () => {
      const host = new PermissionHost();
      host.register('slow', async () => {
        await new Promise((r) => setTimeout(r, 1));
        return true;
      });
      expect(await host.check('slow', makeSubject())).toBe(true);
    });
  });

  describe('check — fallback deny', () => {
    it('returns false for unrecognized permit', async () => {
      const host = new PermissionHost();
      expect(await host.check('totally_unknown', makeSubject())).toBe(false);
    });
  });

  describe('checkAll (AND)', () => {
    it('all pass → true', async () => {
      const host = new PermissionHost();
      expect(await host.checkAll(['adapter(qq)', 'group()'], makeSubject())).toBe(true);
    });

    it('one fails → false', async () => {
      const host = new PermissionHost();
      expect(await host.checkAll(['adapter(qq)', 'private()'], makeSubject())).toBe(false);
    });

    it('empty permits → true', async () => {
      const host = new PermissionHost();
      expect(await host.checkAll([], makeSubject())).toBe(true);
    });
  });

  describe('resolution order: builtin → platform → custom → deny', () => {
    it('builtin takes precedence over custom with same pattern', async () => {
      const host = new PermissionHost();
      host.register('adapter(qq)', () => false);
      expect(await host.check('adapter(qq)', makeSubject())).toBe(true);
    });
  });
});
