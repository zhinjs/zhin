import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { canAccessTool, clearPlatformPermitCheckers } from 'zhin.js';
import {
  checkLarkPlatformPermit,
  normalizeLarkSenderForPermit,
  platformPermit,
  registerLarkPlatformPermitChecker,
} from '../src/platform-permit.js';

function mockMsg(sender: { role?: string; permissions?: string[] }) {
  return { $adapter: 'lark', $sender: sender, $channel: { type: 'group', id: 'oc1' } } as any;
}

describe('lark platform-permit', () => {
  beforeEach(() => {
    clearPlatformPermitCheckers();
    registerLarkPlatformPermitChecker();
  });
  afterEach(() => clearPlatformPermitCheckers());

  it('normalizeLarkSenderForPermit', () => {
    expect(normalizeLarkSenderForPermit({ isOwner: true }).permissions).toContain('manage_managers');
    expect(normalizeLarkSenderForPermit({ isAdmin: true }).role).toBe('admin');
  });

  it('checkLarkPlatformPermit manage_managers', () => {
    expect(checkLarkPlatformPermit('manage_managers', mockMsg({ role: 'owner', permissions: ['chat_owner'] }))).toBe(true);
    expect(checkLarkPlatformPermit('manage_managers', mockMsg({ role: 'admin', permissions: ['chat_admin'] }))).toBe(false);
  });

  it('canAccessTool', () => {
    const tool = {
      name: 't',
      description: 'd',
      parameters: { type: 'object', properties: {} },
      permissions: [platformPermit('chat_admin')],
      execute: async () => '',
    };
    expect(canAccessTool(tool, mockMsg({ role: 'member', permissions: [] }))).toBe(false);
    expect(canAccessTool(tool, mockMsg({ role: 'admin', permissions: ['chat_admin'] }))).toBe(true);
  });
});
