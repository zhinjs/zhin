import { describe, it, expect, beforeEach } from 'vitest';
import { canAccessTool } from '@zhin.js/core';
import { PermissionHost } from '@zhin.js/permission';
import {
  checkSlackPlatformPermit,
  normalizeSlackSenderForPermit,
  platformPermit,
} from '../src/platform-permit.js';

function mockSubject(sender: { role?: string; permissions?: string[] }) {
  return {
    adapter: 'slack',
    sender: { id: 'u1', platform: { standing: (sender.role ?? 'member') as never, ...(sender.permissions ? { permissions: sender.permissions } : {}) } },
    scene: { type: 'group', id: 'C1' },
  };
}

function mockMsg(platformPermissions: string[]) {
  return {
    clientAdapter: 'slack',
    endpointId: 'bot1',
    conversation: { endpoint: { adapter: 'slack', id: 'bot1' }, kind: 'group', id: 'C1' },
    sender: { id: 'u1', platform: { standing: 'member' as const, permissions: platformPermissions } },
  } as any;
}

describe('slack platform-permit', () => {
  let host: PermissionHost;

  beforeEach(() => {
    host = new PermissionHost();
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
    expect(await canAccessTool(tool, mockMsg([]), host)).toBe(false);
    expect(await canAccessTool(tool, mockMsg(['channel_manager']), host)).toBe(true);
  });
});
