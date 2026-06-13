import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { canAccessTool, clearPlatformPermitCheckers } from 'zhin.js';
import {
  checkWecomPlatformPermit,
  normalizeWecomSenderForPermit,
  platformPermit,
  registerWecomPlatformPermitChecker,
} from '../src/platform-permit.js';

function mockMsg(sender: { role?: string; permissions?: string[] }) {
  return { $adapter: 'wecom', $sender: sender, $channel: { type: 'group', id: 'c1' } } as any;
}

describe('wecom platform-permit', () => {
  beforeEach(() => {
    clearPlatformPermitCheckers();
    registerWecomPlatformPermitChecker();
  });
  afterEach(() => clearPlatformPermitCheckers());

  it('normalizeWecomSenderForPermit', () => {
    expect(normalizeWecomSenderForPermit({ isAdmin: true }).role).toBe('admin');
    expect(normalizeWecomSenderForPermit({ isOwner: true }).role).toBe('owner');
    expect(normalizeWecomSenderForPermit({}).role).toBe('member');
  });

  it('checkWecomPlatformPermit', () => {
    expect(checkWecomPlatformPermit('chat_admin', mockMsg({ role: 'admin', permissions: ['chat_admin'] }))).toBe(true);
    expect(checkWecomPlatformPermit('chat_owner', mockMsg({ role: 'member', permissions: [] }))).toBe(false);
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
