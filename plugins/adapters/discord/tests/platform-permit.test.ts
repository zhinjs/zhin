import { describe, it, expect, beforeEach } from 'vitest';
import { canAccessTool } from '@zhin.js/core';
import { PermissionHost } from '@zhin.js/permission';
import {
  checkDiscordPlatformPermit,
  normalizeDiscordSenderForPermit,
  platformPermit,
} from '../src/platform-permit.js';

function mockSubject(sender: { role?: string; permissions?: string[] }) {
  return {
    adapter: 'discord',
    sender: { id: 'u1', platform: { standing: (sender.role ?? 'member') as never, ...(sender.permissions ? { permissions: sender.permissions } : {}) } },
    scene: { type: 'group', id: 'g1' },
  };
}

function mockMsg(platformPermissions: string[]) {
  return {
    clientAdapter: 'discord',
    endpointId: 'bot1',
    conversation: { endpoint: { adapter: 'discord', id: 'bot1' }, kind: 'group', id: 'g1' },
    sender: { id: 'u1', platform: { standing: 'member' as const, permissions: platformPermissions } },
  } as any;
}

describe('discord platform-permit', () => {
  let host: PermissionHost;

  beforeEach(() => {
    host = new PermissionHost();
  });

  it('normalizeDiscordSenderForPermit', () => {
    const owner = normalizeDiscordSenderForPermit({ isOwner: true });
    expect(owner.role).toBe('owner');
    expect(owner.permissions).toContain('guild_owner');
  });

  it('checkDiscordPlatformPermit manage_roles/moderate', () => {
    expect(checkDiscordPlatformPermit('manage_roles', mockSubject({ role: 'member', permissions: ['MANAGE_ROLES'] }))).toBe(true);
    expect(checkDiscordPlatformPermit('moderate_members', mockSubject({ role: 'member', permissions: [] }))).toBe(false);
    expect(checkDiscordPlatformPermit('guild_owner', mockSubject({ role: 'owner', permissions: ['guild_owner'] }))).toBe(true);
  });

  it('moderate_members includes admin role (aligned with normalize)', () => {
    expect(checkDiscordPlatformPermit('moderate_members', mockSubject({ role: 'admin', permissions: [] }))).toBe(true);
    expect(checkDiscordPlatformPermit('moderate_members', mockSubject({ role: 'owner', permissions: [] }))).toBe(true);
    expect(checkDiscordPlatformPermit('moderate_members', mockSubject({ role: 'member', permissions: [] }))).toBe(false);
  });

  it('canAccessTool', async () => {
    const tool = {
      name: 't',
      description: 'd',
      parameters: { type: 'object' as const, properties: {} },
      permissions: [platformPermit('manage_channels')],
      execute: async () => '',
    };
    expect(await canAccessTool(tool, mockMsg([]), host)).toBe(false);
    expect(await canAccessTool(tool, mockMsg(['manage_channels']), host)).toBe(true);
  });
});
