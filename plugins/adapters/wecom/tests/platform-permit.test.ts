import { describe, it, expect, beforeEach } from 'vitest';
import { canAccessTool } from '@zhin.js/core';
import { createPermissionHost, type PermissionHost } from '@zhin.js/permission';
import {
  checkWecomPlatformPermit,
  normalizeWecomSenderForPermit,
  platformPermit,
} from '../src/platform-permit.js';

function mockSubject(sender: { role?: string; permissions?: string[] }) {
  return {
    adapter: 'wecom',
    sender: { id: 'u1', role: sender.role ? [sender.role] : [], permissions: sender.permissions },
    scene: { type: 'group', id: 'c1' },
  };
}

function mockMsg(sender: { role?: string; permissions?: string[] }) {
  return {
    $adapter: 'wecom',
    $sender: { id: 'u1', ...sender },
    $channel: { type: 'group', id: 'c1' },
  } as any;
}

describe('wecom platform-permit', () => {
  let host: PermissionHost;

  beforeEach(() => {
    host = createPermissionHost();
    host.registerPlatform('wecom', (perm, subject) => checkWecomPlatformPermit(perm, subject));
  });

  it('normalizeWecomSenderForPermit', () => {
    expect(normalizeWecomSenderForPermit({ isAdmin: true }).role).toBe('admin');
    expect(normalizeWecomSenderForPermit({ isOwner: true }).role).toBe('owner');
    expect(normalizeWecomSenderForPermit({}).role).toBe('member');
  });

  it('checkWecomPlatformPermit', () => {
    expect(checkWecomPlatformPermit('chat_admin', mockSubject({ role: 'admin', permissions: ['chat_admin'] }))).toBe(true);
    expect(checkWecomPlatformPermit('chat_owner', mockSubject({ role: 'member', permissions: [] }))).toBe(false);
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
