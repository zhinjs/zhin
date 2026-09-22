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
    sender: { id: 'u1', roles: [], permissions: sender.permissions },
    metadata: sender.role ? { senderRole: sender.role } : {},
  } as any;
}

describe('qq official guild platform-permit', () => {
  let host: PermissionHost;

  beforeEach(() => {
    host = new PermissionHost();
    host.registerPlatform('qq', (perm, subject) => checkQqPlatformPermit(perm, subject));
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
    expect(await canAccessTool(tool, mockMsg({ role: 'admin', permissions: ['guild_admin'] }), host)).toBe(false);
    expect(await canAccessTool(tool, mockMsg({ role: 'owner', permissions: ['guild_owner'] }), host)).toBe(true);
  });
});
