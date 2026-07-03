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
  return { $adapter: 'milky', $sender: sender, $channel: { type: 'group', id: 'g1' } } as any;
}

describe('milky platform-permit', () => {
  beforeEach(() => {
    clearPlatformPermitCheckers();
    registerDefaultScenePlatformPermitChecker('milky');
  });
  afterEach(() => clearPlatformPermitCheckers());

  it('scene_owner 仅 owner 可通过', () => {
    const tool = {
      name: 't',
      description: 'd',
      parameters: { type: 'object', properties: {} },
      permissions: ['platform(milky,scene_owner)'],
      execute: async () => '',
    };
    expect(canAccessTool(tool, mockMsg('admin'))).toBe(false);
    expect(canAccessTool(tool, mockMsg('owner'))).toBe(true);
  });
});
