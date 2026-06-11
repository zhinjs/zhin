import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  applyQqSenderRoleToMessageSender,
  canAccessTool,
  clearPlatformPermitCheckers,
  registerDefaultGroupPlatformPermitChecker,
} from 'zhin.js';

function mockMsg(role?: string) {
  const sender: { role?: string; permissions?: string[] } = {};
  applyQqSenderRoleToMessageSender(sender, role);
  return { $adapter: 'milky', $sender: sender, $channel: { type: 'group', id: 'g1' } } as any;
}

describe('milky platform-permit', () => {
  beforeEach(() => {
    clearPlatformPermitCheckers();
    registerDefaultGroupPlatformPermitChecker('milky');
  });
  afterEach(() => clearPlatformPermitCheckers());

  it('group_owner 仅 owner 可通过', () => {
    const tool = {
      name: 't',
      description: 'd',
      parameters: { type: 'object', properties: {} },
      permissions: ['platform(milky,group_owner)'],
      execute: async () => '',
    };
    expect(canAccessTool(tool, mockMsg('admin'))).toBe(false);
    expect(canAccessTool(tool, mockMsg('owner'))).toBe(true);
  });
});
