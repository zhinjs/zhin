import { describe, it, expect, beforeEach } from 'vitest';
import { canAccessTool } from '@zhin.js/core';
import { PermissionHost } from '@zhin.js/permission';
import { platformPermit } from '../src/platform-permit.js';
import * as adapter from '../src/index.js';

function mockMsg(platformPermissions: string[]) {
  return {
    clientAdapter: 'wecom',
    endpointId: 'bot1',
    conversation: { endpoint: { adapter: 'wecom', id: 'bot1' }, kind: 'group', id: 'g1' },
    sender: { id: 'u1', platform: { standing: 'member' as const, permissions: platformPermissions } },
  } as any;
}

describe('wecom platform-permit', () => {
  let host: PermissionHost;

  beforeEach(() => {
    host = new PermissionHost();
  });

  it('no longer exports the legacy permit resolver / checker (ADR 0056 §5 builtin evaluator only)', () => {
    expect(adapter).not.toHaveProperty('checkWecomPlatformPermit');
    expect(adapter).not.toHaveProperty('wecomGroupPermitResolver');
    expect(adapter).not.toHaveProperty('normalizeWecomSenderForPermit');
  });

  it('canAccessTool', async () => {
    const tool = {
      name: 't',
      description: 'd',
      parameters: { type: 'object' as const, properties: {} },
      permissions: [platformPermit('chat_admin')],
      execute: async () => '',
    };
    expect(await canAccessTool(tool, mockMsg([]), host)).toBe(false);
    expect(await canAccessTool(tool, mockMsg(['chat_admin']), host)).toBe(true);
  });
});
