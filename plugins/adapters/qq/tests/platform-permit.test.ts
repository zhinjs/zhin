import { describe, it, expect, beforeEach } from 'vitest';
import { canAccessTool } from '@zhin.js/core';
import { PermissionHost } from '@zhin.js/permission';
import { resolveTurnCapabilities } from 'zhin.js/adapter';
import qq from '../adapters/qq/index.js';
import {
  checkQqPlatformPermit,
  normalizeQqGuildSenderForPermit,
  platformPermit,
  projectQqGuildSenderStanding,
} from '../src/platform-permit.js';

function mockSubject(sender: { role?: string; permissions?: string[] }) {
  return {
    adapter: 'qq',
    sender: {
      id: 'u1',
      role: sender.role ? [sender.role] : [],
      permissions: sender.permissions,
    },
    scene: { type: 'channel', id: 'c1' },
  };
}

function mockMsg(sender: { role?: string; permissions?: string[] }) {
  return {
    clientAdapter: 'qq',
    endpointId: 'bot1',
    conversation: { endpoint: { adapter: 'qq', id: 'bot1' }, kind: 'channel', id: 'c1' },
    sender: { id: 'u1', ...(sender.role ? { platform: { standing: sender.role } } : {}) },
    metadata: {},
  } as any;
}

describe('qq official guild platform-permit', () => {
  let host: PermissionHost;

  beforeEach(() => {
    host = new PermissionHost();
    host.registerPlatform('qq', (perm, subject) => checkQqPlatformPermit(perm, subject));
  });

  it('projectQqGuildSenderStanding (ADR 0056 §1)', () => {
    expect(projectQqGuildSenderStanding(['1', '4'])).toEqual({ standing: 'owner', roles: [{ id: '1', name: '普通成员' }, { id: '4', name: '频道主' }] });
    expect(projectQqGuildSenderStanding(['2'])?.standing).toBe('admin');
    expect(projectQqGuildSenderStanding(['5', '99'])).toEqual({ standing: 'member', roles: [{ id: '5', name: '子频道管理员' }, { id: '99' }] });
    expect(projectQqGuildSenderStanding(undefined)).toBeUndefined();
    expect(projectQqGuildSenderStanding([])).toBeUndefined();
  });

  it('declares standing + roles for channel conversations only', () => {
    const conversation = (kind: 'group' | 'channel') => ({ endpoint: { id: 'e', adapter: 'qq' }, kind, id: '1' });
    expect(resolveTurnCapabilities({ profile: qq.profile!, conversation: conversation('channel') }).get('scene.platformStanding')).toEqual({ standing: true, roles: true });
    expect(resolveTurnCapabilities({ profile: qq.profile!, conversation: conversation('group') }).has('scene.platformStanding')).toBe(false);
  });

  it('normalizeQqGuildSenderForPermit', () => {
    expect(normalizeQqGuildSenderForPermit({ isOwner: true }).role).toBe('owner');
    expect(normalizeQqGuildSenderForPermit({ isAdmin: true }).role).toBe('admin');
  });

  it('checkQqPlatformPermit guild_* 与 manage_roles', () => {
    expect(checkQqPlatformPermit('guild_owner', mockSubject({ role: 'owner', permissions: ['guild_owner'] }))).toBe(true);
    expect(checkQqPlatformPermit('manage_roles', mockSubject({ role: 'member', permissions: ['manage_roles'] }))).toBe(true);
    expect(checkQqPlatformPermit('manage_channels', mockSubject({ role: 'member', permissions: [] }))).toBe(false);
  });

  it('canAccessTool', async () => {
    const tool = {
      name: 't',
      description: 'd',
      parameters: { type: 'object' as const, properties: {} },
      permissions: [platformPermit('guild_owner')],
      execute: async () => '',
    };
    expect(await canAccessTool(tool, mockMsg({ role: 'admin' }), host)).toBe(false);
    expect(await canAccessTool(tool, mockMsg({ role: 'owner' }), host)).toBe(true);
  });
});
