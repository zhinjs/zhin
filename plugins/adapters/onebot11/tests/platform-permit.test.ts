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
  return { $adapter: 'onebot11', $sender: sender, $channel: { type: 'group', id: 'g1' } } as any;
}

describe('onebot11 platform-permit', () => {
  beforeEach(() => {
    clearPlatformPermitCheckers();
    registerDefaultScenePlatformPermitChecker('onebot11');
  });
  afterEach(() => clearPlatformPermitCheckers());

  it('入站 sender.role 驱动 scene_admin', () => {
    const tool = {
      name: 't',
      description: 'd',
      parameters: { type: 'object', properties: {} },
      permissions: ['platform(onebot11,scene_admin)'],
      execute: async () => '',
    };
    expect(canAccessTool(tool, mockMsg('admin'))).toBe(true);
    expect(canAccessTool(tool, mockMsg('member'))).toBe(false);
  });
});
