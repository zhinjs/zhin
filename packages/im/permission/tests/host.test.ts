import { describe, it, expect } from 'vitest';
import { PermissionHost } from '../src/host.js';
import type { PermissionSubject } from '../src/subject.js';

function makeSubject(overrides: Partial<PermissionSubject> = {}): PermissionSubject {
  return {
    adapter: 'qq',
    endpoint: 'e1',
    scene: { id: 'g1', type: 'group' },
    sender: { id: 'u1', role: ['user'] },
    ...overrides,
  };
}

describe('PermissionHost', () => {
  describe('check — builtin', () => {
    it('resolves builtin permits without extra registration', async () => {
      const host = new PermissionHost();
      expect(await host.check('adapter(qq)', makeSubject())).toBe(true);
      expect(await host.check('adapter(discord)', makeSubject())).toBe(false);
    });
  });

  describe('check — platform', () => {
    it('delegates to registered platform checker', async () => {
      const host = new PermissionHost();
      host.registerPlatform('qq', (perm) => perm === 'scene_admin');
      expect(await host.check('platform(qq,scene_admin)', makeSubject())).toBe(true);
      expect(await host.check('platform(qq,scene_owner)', makeSubject())).toBe(false);
    });

    it('returns false when no platform checker registered', async () => {
      const host = new PermissionHost();
      expect(await host.check('platform(qq,scene_admin)', makeSubject())).toBe(false);
    });

    it('disposes platform checker', async () => {
      const host = new PermissionHost();
      const dispose = host.registerPlatform('qq', () => true);
      expect(await host.check('platform(qq,x)', makeSubject())).toBe(true);
      dispose();
      expect(await host.check('platform(qq,x)', makeSubject())).toBe(false);
    });

    it('isolates registrations between runtime owners', async () => {
      const first = new PermissionHost();
      const second = new PermissionHost();
      first.registerPlatform('qq', () => true);

      expect(await first.check('platform(qq,x)', makeSubject())).toBe(true);
      expect(await second.check('platform(qq,x)', makeSubject())).toBe(false);
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
