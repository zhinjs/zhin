import { describe, it, expect, beforeEach } from 'vitest';
import { canAccessTool } from '@zhin.js/core';
import { PermissionHost } from '@zhin.js/permission';
import {
  checkDingtalkPlatformPermit,
  normalizeDingtalkSenderForPermit,
  platformPermit,
} from '../src/platform-permit.js';

function mockSubject(sender: { role?: string; permissions?: string[] }) {
  return {
    adapter: 'dingtalk',
    sender: { id: 'u1', role: sender.role ? [sender.role] : [], permissions: sender.permissions },
    scene: { type: 'group', id: 'c1' },
  };
}

function mockMsg(sender: { role?: string; permissions?: string[] }) {
  return {
    clientAdapter: 'dingtalk',
    endpointId: 'bot1',
    conversation: { endpoint: { adapter: 'dingtalk', id: 'bot1' }, kind: 'group', id: 'c1' },
    sender: { id: 'u1', roles: sender.role ? [sender.role] : [] },
    metadata: { role: sender.role, permissions: sender.permissions },
  } as any;
}

describe('dingtalk platform-permit', () => {
  let host: PermissionHost;

  beforeEach(() => {
    host = new PermissionHost();
    host.registerPlatform('dingtalk', (perm, subject) => checkDingtalkPlatformPermit(perm, subject));
  });

  it('normalizeDingtalkSenderForPermit isAdmin', () => {
    expect(normalizeDingtalkSenderForPermit({ isAdmin: true }).role).toBe('admin');
    expect(normalizeDingtalkSenderForPermit({ isOwner: true }).role).toBe('owner');
  });

  it('checkDingtalkPlatformPermit', () => {
    expect(checkDingtalkPlatformPermit('chat_admin', mockSubject({ role: 'admin', permissions: ['chat_admin'] }))).toBe(true);
    expect(checkDingtalkPlatformPermit('chat_owner', mockSubject({ role: 'member', permissions: [] }))).toBe(false);
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
