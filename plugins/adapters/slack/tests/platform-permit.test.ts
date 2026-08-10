import { describe, it, expect, beforeEach } from 'vitest';
import { canAccessTool } from '@zhin.js/core';
import { createPermissionHost, type PermissionHost } from '@zhin.js/permission';
import {
  checkSlackPlatformPermit,
  normalizeSlackSenderForPermit,
  platformPermit,
} from '../src/platform-permit.js';

function mockSubject(sender: { role?: string; permissions?: string[] }) {
  return {
    adapter: 'slack',
    sender: { id: 'u1', role: sender.role ? [sender.role] : [], permissions: sender.permissions },
    scene: { type: 'group', id: 'C1' },
  };
}

function mockMsg(sender: { role?: string; permissions?: string[] }) {
  return {
    $adapter: 'slack',
    $sender: { id: 'u1', ...sender },
    $channel: { type: 'group', id: 'C1' },
  } as any;
}

describe('slack platform-permit', () => {
  let host: PermissionHost;

  beforeEach(() => {
    host = createPermissionHost();
    host.registerPlatform('slack', (perm, subject) => checkSlackPlatformPermit(perm, subject));
  });

  it('normalizeSlackSenderForPermit', () => {
    expect(normalizeSlackSenderForPermit({ isWorkspaceOwner: true }).role).toBe('owner');
    expect(normalizeSlackSenderForPermit({ isChannelManager: true }).role).toBe('channel_admin');
  });

  it('checkSlackPlatformPermit', () => {
    expect(checkSlackPlatformPermit('channel_manager', mockSubject({ role: 'channel_admin', permissions: ['channel_manager'] }))).toBe(true);
    expect(checkSlackPlatformPermit('workspace_admin', mockSubject({ role: 'member', permissions: [] }))).toBe(false);
  });

  it('canAccessTool', async () => {
    const tool = {
      name: 't',
      description: 'd',
      parameters: { type: 'object' as const, properties: {} },
      permissions: [platformPermit('channel_manager')],
      execute: async () => '',
    };
    expect(await canAccessTool(tool, mockMsg({ role: 'member', permissions: [] }), host)).toBe(false);
    expect(await canAccessTool(tool, mockMsg({ role: 'admin', permissions: ['workspace_admin'] }), host)).toBe(true);
  });
});
