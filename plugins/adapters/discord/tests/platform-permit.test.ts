import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { canAccessTool, clearPlatformPermitCheckers } from 'zhin.js';
import {
  checkDiscordPlatformPermit,
  normalizeDiscordSenderForPermit,
  platformPermit,
  registerDiscordPlatformPermitChecker,
} from '../src/platform-permit.js';

function mockMsg(sender: { role?: string; permissions?: string[] }) {
  return { $adapter: 'discord', $sender: sender, $channel: { type: 'group', id: 'g1' } } as any;
}

describe('discord platform-permit', () => {
  beforeEach(() => {
    clearPlatformPermitCheckers();
    registerDiscordPlatformPermitChecker();
  });
  afterEach(() => clearPlatformPermitCheckers());

  it('normalizeDiscordSenderForPermit', () => {
    const owner = normalizeDiscordSenderForPermit({ isOwner: true });
    expect(owner.role).toBe('owner');
    expect(owner.permissions).toContain('guild_owner');
  });

  it('checkDiscordPlatformPermit manage_roles/moderate', () => {
    expect(checkDiscordPlatformPermit('manage_roles', mockMsg({ role: 'member', permissions: ['MANAGE_ROLES'] }))).toBe(true);
    expect(checkDiscordPlatformPermit('moderate_members', mockMsg({ role: 'member', permissions: [] }))).toBe(false);
    expect(checkDiscordPlatformPermit('guild_owner', mockMsg({ role: 'owner', permissions: ['guild_owner'] }))).toBe(true);
  });

  it('canAccessTool', () => {
    const tool = {
      name: 't',
      description: 'd',
      parameters: { type: 'object', properties: {} },
      permissions: [platformPermit('manage_channels')],
      execute: async () => '',
    };
    expect(canAccessTool(tool, mockMsg({ role: 'member', permissions: [] }))).toBe(false);
    expect(canAccessTool(tool, mockMsg({ role: 'member', permissions: ['MANAGE_CHANNELS'] }))).toBe(true);
  });
});
