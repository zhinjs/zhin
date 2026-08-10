import { describe, it, expect, beforeEach } from 'vitest';
import { canAccessTool } from '@zhin.js/core';
import { createPermissionHost, type PermissionHost } from '@zhin.js/permission';
import { KookPermission } from '../src/protocol.js';
import {
  checkKookPlatformPermit,
  normalizeKookSenderForPermit,
  platformPermit,
} from '../src/platform-permit.js';

function mockSubject(sender: { role?: string; permissions?: string[] }) {
  return {
    adapter: 'kook',
    sender: { id: 'u1', role: sender.role ? [sender.role] : [], permissions: sender.permissions },
    scene: { type: 'group', id: 'g1' },
  };
}

function mockMsg(sender: { role?: string; permissions?: string[] }) {
  return {
    $adapter: 'kook',
    $sender: { id: 'u1', ...sender },
    $channel: { type: 'group', id: 'g1' },
  } as any;
}

describe('kook platform-permit', () => {
  let host: PermissionHost;

  beforeEach(() => {
    host = createPermissionHost();
    host.registerPlatform('kook', (perm, subject) => checkKookPlatformPermit(perm, subject));
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
    expect(await canAccessTool(tool, mockMsg({ role: 'admin', permissions: ['guild_admin'] }), host)).toBe(false);
    expect(await canAccessTool(tool, mockMsg({ role: 'owner', permissions: ['guild_owner'] }), host)).toBe(true);
  });
});
