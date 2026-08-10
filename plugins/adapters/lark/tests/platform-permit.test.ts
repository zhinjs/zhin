import { describe, it, expect, beforeEach } from 'vitest';
import { canAccessTool } from '@zhin.js/core';
import { createPermissionHost, type PermissionHost } from '@zhin.js/permission';
import {
  checkLarkPlatformPermit,
  normalizeLarkSenderForPermit,
  platformPermit,
} from '../src/platform-permit.js';

function mockSubject(sender: { role?: string; permissions?: string[] }) {
  return {
    adapter: 'lark',
    sender: { id: 'u1', role: sender.role ? [sender.role] : [], permissions: sender.permissions },
    scene: { type: 'group', id: 'oc1' },
  };
}

function mockMsg(sender: { role?: string; permissions?: string[] }) {
  return {
    $adapter: 'lark',
    $sender: { id: 'u1', ...sender },
    $channel: { type: 'group', id: 'oc1' },
  } as any;
}

describe('lark platform-permit', () => {
  let host: PermissionHost;

  beforeEach(() => {
    host = createPermissionHost();
    host.registerPlatform('lark', (perm, subject) => checkLarkPlatformPermit(perm, subject));
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
    expect(await canAccessTool(tool, mockMsg({ role: 'member', permissions: [] }), host)).toBe(false);
    expect(await canAccessTool(tool, mockMsg({ role: 'admin', permissions: ['chat_admin'] }), host)).toBe(true);
  });
});
