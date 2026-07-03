import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  applyQqSenderRoleToMessageSender,
  canAccessTool,
  clearPlatformPermitCheckers,
  registerDefaultScenePlatformPermitChecker,
} from 'zhin.js';

function mockMsg(role?: string) {
  const sender: { role?: string; permissions?: string[] } = {};
  applyQqSenderRoleToMessageSender(sender, role);
  return {
    $adapter: 'napcat',
    $sender: sender,
    $channel: { type: 'group', id: 'g1' },
  } as any;
}

describe('napcat platform-permit (QQ group_*)', () => {
  beforeEach(() => {
    clearPlatformPermitCheckers();
    registerDefaultScenePlatformPermitChecker('napcat');
  });
  afterEach(() => clearPlatformPermitCheckers());

  it('applyQqSenderRoleToMessageSender 写入 role', () => {
    expect(mockMsg('owner').$sender.role).toBe('owner');
    expect(mockMsg('admin').$sender.role).toBe('admin');
    expect(mockMsg('member').$sender.role).toBeUndefined();
  });

  it('canAccessTool scene_admin / scene_owner', () => {
    const adminTool = {
      name: 't',
      description: 'd',
      parameters: { type: 'object', properties: {} },
      permissions: ['platform(napcat,scene_admin)'],
      execute: async () => '',
    };
    const ownerTool = { ...adminTool, permissions: ['platform(napcat,scene_owner)'] };
    expect(canAccessTool(adminTool, mockMsg('member'))).toBe(false);
    expect(canAccessTool(adminTool, mockMsg('admin'))).toBe(true);
    expect(canAccessTool(ownerTool, mockMsg('admin'))).toBe(false);
    expect(canAccessTool(ownerTool, mockMsg('owner'))).toBe(true);
  });
});
