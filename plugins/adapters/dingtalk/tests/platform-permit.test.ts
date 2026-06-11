import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { canAccessTool, clearPlatformPermitCheckers } from 'zhin.js';
import {
  checkDingtalkPlatformPermit,
  normalizeDingtalkSenderForPermit,
  platformPermit,
  registerDingtalkPlatformPermitChecker,
} from '../src/platform-permit.js';

function mockMsg(sender: { role?: string; permissions?: string[] }) {
  return { $adapter: 'dingtalk', $sender: sender, $channel: { type: 'group', id: 'c1' } } as any;
}

describe('dingtalk platform-permit', () => {
  beforeEach(() => {
    clearPlatformPermitCheckers();
    registerDingtalkPlatformPermitChecker();
  });
  afterEach(() => clearPlatformPermitCheckers());

  it('normalizeDingtalkSenderForPermit isAdmin', () => {
    expect(normalizeDingtalkSenderForPermit({ isAdmin: true }).role).toBe('admin');
    expect(normalizeDingtalkSenderForPermit({ isOwner: true }).role).toBe('owner');
  });

  it('checkDingtalkPlatformPermit', () => {
    expect(checkDingtalkPlatformPermit('chat_admin', mockMsg({ role: 'admin', permissions: ['chat_admin'] }))).toBe(true);
    expect(checkDingtalkPlatformPermit('chat_owner', mockMsg({ role: 'member', permissions: [] }))).toBe(false);
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
