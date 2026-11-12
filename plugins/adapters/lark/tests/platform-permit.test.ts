import { describe, it, expect, beforeEach } from 'vitest';
import { canAccessTool } from '@zhin.js/core';
import { PermissionHost } from '@zhin.js/permission';
import {
  checkLarkPlatformPermit,
  normalizeLarkSenderForPermit,
  platformPermit,
} from '../src/platform-permit.js';

function mockSubject(sender: { role?: string; permissions?: string[] }) {
  return {
    adapter: 'lark',
    sender: { id: 'u1', platform: { standing: (sender.role ?? 'member') as never, ...(sender.permissions ? { permissions: sender.permissions } : {}) } },
    scene: { type: 'group', id: 'oc1' },
  };
}

function mockMsg(platformPermissions: string[]) {
  return {
    clientAdapter: 'lark',
    endpointId: 'bot1',
    conversation: { endpoint: { adapter: 'lark', id: 'bot1' }, kind: 'group', id: 'oc1' },
    sender: { id: 'u1', platform: { standing: 'member' as const, permissions: platformPermissions } },
  } as any;
}

describe('lark platform-permit', () => {
  let host: PermissionHost;

  beforeEach(() => {
    host = new PermissionHost();
  });

  it('normalizeLarkSenderForPermit', () => {
    expect(normalizeLarkSenderForPermit({ isOwner: true }).permissions).toContain('manage_managers');
    expect(normalizeLarkSenderForPermit({ isAdmin: true }).role).toBe('admin');
  });

  it('checkLarkPlatformPermit manage_managers', () => {
    expect(checkLarkPlatformPermit('manage_managers', mockSubject({ role: 'owner', permissions: ['chat_owner'] }))).toBe(true);
    expect(checkLarkPlatformPermit('manage_managers', mockSubject({ role: 'admin', permissions: ['chat_admin'] }))).toBe(false);
  });

  it('canAccessTool', async () => {
    const tool = {
      name: 't',
      description: 'd',
      parameters: { type: 'object' as const, properties: {} },
      permissions: [platformPermit('chat_admin')],
      execute: async () => '',
    };
    expect(await canAccessTool(tool, mockMsg([]), host)).toBe(false);
    expect(await canAccessTool(tool, mockMsg(['chat_admin']), host)).toBe(true);
  });
});
