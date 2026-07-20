import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { canAccessTool, clearPlatformPermitCheckers } from 'zhin.js';
import { KookPermission } from '../src/protocol.js';
import {
  checkKookPlatformPermit,
  normalizeKookSenderForPermit,
  platformPermit,
  registerKookPlatformPermitChecker,
} from '../src/platform-permit.js';

function mockMsg(sender: { role?: string; permissions?: string[] }) {
  return { $adapter: 'kook', $sender: sender, $channel: { type: 'group', id: 'g1' } } as any;
}

describe('kook platform-permit', () => {
  beforeEach(() => {
    clearPlatformPermitCheckers();
    registerKookPlatformPermitChecker();
  });
  afterEach(() => clearPlatformPermitCheckers());

  it('normalizeKookSenderForPermit 映射 permission 1/2/4/5', () => {
    expect(normalizeKookSenderForPermit({ permission: KookPermission.Owner }, false).role).toBe('owner');
    expect(normalizeKookSenderForPermit({ permission: KookPermission.Admin }, false).role).toBe('admin');
    expect(normalizeKookSenderForPermit({ permission: KookPermission.ChannelAdmin }, true).role).toBe('channel_admin');
  });

  it('checkKookPlatformPermit guild_owner/admin', () => {
    expect(checkKookPlatformPermit('guild_owner', mockMsg({ role: 'owner', permissions: ['guild_owner'] }))).toBe(true);
    expect(checkKookPlatformPermit('guild_admin', mockMsg({ role: 'member', permissions: [] }))).toBe(false);
    expect(checkKookPlatformPermit('manage_roles', mockMsg({ role: 'admin', permissions: ['guild_admin'] }))).toBe(true);
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
