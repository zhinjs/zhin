import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { canAccessTool, clearPlatformPermitCheckers } from 'zhin.js';
import {
  checkSlackPlatformPermit,
  normalizeSlackSenderForPermit,
  platformPermit,
  registerSlackPlatformPermitChecker,
} from '../src/platform-permit.js';

function mockMsg(sender: { role?: string; permissions?: string[] }) {
  return { $adapter: 'slack', $sender: sender, $channel: { type: 'group', id: 'C1' } } as any;
}

describe('slack platform-permit', () => {
  beforeEach(() => {
    clearPlatformPermitCheckers();
    registerSlackPlatformPermitChecker();
  });
  afterEach(() => clearPlatformPermitCheckers());

  it('normalizeSlackSenderForPermit', () => {
    expect(normalizeSlackSenderForPermit({ isWorkspaceOwner: true }).role).toBe('owner');
    expect(normalizeSlackSenderForPermit({ isChannelManager: true }).role).toBe('channel_admin');
  });

  it('checkSlackPlatformPermit', () => {
    expect(checkSlackPlatformPermit('channel_manager', mockMsg({ role: 'channel_admin', permissions: ['channel_manager'] }))).toBe(true);
    expect(checkSlackPlatformPermit('workspace_admin', mockMsg({ role: 'member', permissions: [] }))).toBe(false);
  });

  it('canAccessTool', () => {
    const tool = {
      name: 't',
      description: 'd',
      parameters: { type: 'object', properties: {} },
      permissions: [platformPermit('channel_manager')],
      execute: async () => '',
    };
    expect(canAccessTool(tool, mockMsg({ role: 'member', permissions: [] }))).toBe(false);
    expect(canAccessTool(tool, mockMsg({ role: 'admin', permissions: ['workspace_admin'] }))).toBe(true);
  });
});
