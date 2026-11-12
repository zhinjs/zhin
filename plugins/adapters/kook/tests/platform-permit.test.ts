import { describe, it, expect, beforeEach } from 'vitest';
import { canAccessTool } from '@zhin.js/core';
import { PermissionHost } from '@zhin.js/permission';
import { KookPermission } from '../src/protocol.js';
import {
  checkKookPlatformPermit,
  normalizeKookSenderForPermit,
  platformPermit,
} from '../src/platform-permit.js';

function mockSubject(sender: { role?: string; permissions?: string[] }) {
  return {
    adapter: 'kook',
    sender: { id: 'u1', platform: { standing: (sender.role ?? 'member') as never, ...(sender.permissions ? { permissions: sender.permissions } : {}) } },
    scene: { type: 'group', id: 'g1' },
  };
}

function mockMsg(platformPermissions: string[]) {
  return {
    clientAdapter: 'kook',
    endpointId: 'bot1',
    conversation: { endpoint: { adapter: 'kook', id: 'bot1' }, kind: 'group', id: 'g1' },
    sender: { id: 'u1', platform: { standing: 'member' as const, permissions: platformPermissions } },
  } as any;
}

describe('kook platform-permit', () => {
  let host: PermissionHost;

  beforeEach(() => {
    host = new PermissionHost();
  });

  it('normalizeKookSenderForPermit 映射 permission 1/2/4/5', () => {
    expect(normalizeKookSenderForPermit({ permission: KookPermission.Owner }, false).role).toBe('owner');
    expect(normalizeKookSenderForPermit({ permission: KookPermission.Admin }, false).role).toBe('admin');
    expect(normalizeKookSenderForPermit({ permission: KookPermission.ChannelAdmin }, true).role).toBe('channel_admin');
  });

  it('checkKookPlatformPermit guild_owner/admin', () => {
    expect(checkKookPlatformPermit('guild_owner', mockSubject({ role: 'owner', permissions: ['guild_owner'] }))).toBe(true);
    expect(checkKookPlatformPermit('guild_admin', mockSubject({ role: 'member', permissions: [] }))).toBe(false);
    expect(checkKookPlatformPermit('manage_roles', mockSubject({ role: 'admin', permissions: ['guild_admin'] }))).toBe(true);
  });

  it('canAccessTool', async () => {
    const tool = {
      name: 't',
      description: 'd',
      parameters: { type: 'object' as const, properties: {} },
      permissions: [platformPermit('guild_owner')],
      execute: async () => '',
    };
    expect(await canAccessTool(tool, mockMsg(['42']), host)).toBe(false);
    expect(await canAccessTool(tool, mockMsg(['guild_owner']), host)).toBe(true);
  });
});
