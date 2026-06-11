import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { canAccessTool, clearPlatformPermitCheckers } from 'zhin.js';
import {
  checkQqPlatformPermit,
  normalizeQqGuildSenderForPermit,
  platformPermit,
  registerQqPlatformPermitChecker,
} from '../src/platform-permit.js';

function mockMsg(sender: { role?: string; permissions?: string[] }) {
  return { $adapter: 'qq', $sender: sender, $channel: { type: 'channel', id: 'c1' } } as any;
}

describe('qq official guild platform-permit', () => {
  beforeEach(() => {
    clearPlatformPermitCheckers();
    registerQqPlatformPermitChecker();
  });
  afterEach(() => clearPlatformPermitCheckers());

  it('normalizeQqGuildSenderForPermit', () => {
    expect(normalizeQqGuildSenderForPermit({ isOwner: true }).role).toBe('owner');
    expect(normalizeQqGuildSenderForPermit({ isAdmin: true }).role).toBe('admin');
  });

  it('checkQqPlatformPermit guild_* 与 manage_roles', () => {
    expect(checkQqPlatformPermit('guild_owner', mockMsg({ role: 'owner', permissions: ['guild_owner'] }))).toBe(true);
    expect(checkQqPlatformPermit('manage_roles', mockMsg({ role: 'member', permissions: ['manage_roles'] }))).toBe(true);
    expect(checkQqPlatformPermit('manage_channels', mockMsg({ role: 'member', permissions: [] }))).toBe(false);
  });

  it('canAccessTool', () => {
    const tool = {
      name: 't',
      description: 'd',
      parameters: { type: 'object', properties: {} },
      permissions: [platformPermit('guild_owner')],
      execute: async () => '',
    };
    expect(canAccessTool(tool, mockMsg({ role: 'admin', permissions: ['guild_admin'] }))).toBe(false);
    expect(canAccessTool(tool, mockMsg({ role: 'owner', permissions: ['guild_owner'] }))).toBe(true);
  });
});
