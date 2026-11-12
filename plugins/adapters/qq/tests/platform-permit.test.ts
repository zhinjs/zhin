import { describe, it, expect, beforeEach } from 'vitest';
import { canAccessTool } from '@zhin.js/core';
import { PermissionHost } from '@zhin.js/permission';
import {
  checkQqPlatformPermit,
  normalizeQqGuildSenderForPermit,
  platformPermit,
} from '../src/platform-permit.js';

function mockSubject(sender: { role?: string; permissions?: string[] }) {
  return {
    adapter: 'qq',
    sender: { id: 'u1', platform: { standing: (sender.role ?? 'member') as never, ...(sender.permissions ? { permissions: sender.permissions } : {}) } },
    scene: { type: 'channel', id: 'c1' },
  };
}

function mockMsg(platformPermissions: string[]) {
  return {
    clientAdapter: 'qq',
    endpointId: 'bot1',
    conversation: { endpoint: { adapter: 'qq', id: 'bot1' }, kind: 'channel', id: 'c1' },
    sender: { id: 'u1', platform: { standing: 'member' as const, permissions: platformPermissions } },
  } as any;
}

describe('qq official guild platform-permit', () => {
  let host: PermissionHost;

  beforeEach(() => {
    host = new PermissionHost();
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
    expect(await canAccessTool(tool, mockMsg([]), host)).toBe(false);
    expect(await canAccessTool(tool, mockMsg(['guild_owner']), host)).toBe(true);
  });
});
