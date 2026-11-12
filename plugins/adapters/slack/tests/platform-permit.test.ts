import { describe, it, expect, beforeEach } from 'vitest';
import { canAccessTool } from '@zhin.js/core';
import { PermissionHost } from '@zhin.js/permission';
import { platformPermit } from '../src/platform-permit.js';
import * as adapter from '../src/index.js';

function mockMsg(platformPermissions: string[]) {
  return {
    clientAdapter: 'slack',
    endpointId: 'bot1',
    conversation: { endpoint: { adapter: 'slack', id: 'bot1' }, kind: 'group', id: 'g1' },
    sender: { id: 'u1', platform: { standing: 'member' as const, permissions: platformPermissions } },
  } as any;
}

describe('slack platform-permit', () => {
  let host: PermissionHost;

  beforeEach(() => {
    host = new PermissionHost();
  });

  it('no longer exports the legacy permit resolver / checker (ADR 0056 §5 builtin evaluator only)', () => {
    expect(adapter).not.toHaveProperty('checkSlackPlatformPermit');
    expect(adapter).not.toHaveProperty('slackGroupPermitResolver');
    expect(adapter).not.toHaveProperty('normalizeSlackSenderForPermit');
  });

  it('canAccessTool', async () => {
    const tool = {
      name: 't',
      description: 'd',
      parameters: { type: 'object' as const, properties: {} },
      permissions: [platformPermit('channel_manager')],
      execute: async () => '',
    };
    expect(await canAccessTool(tool, mockMsg([]), host)).toBe(false);
    expect(await canAccessTool(tool, mockMsg(['channel_manager']), host)).toBe(true);
  });
});
