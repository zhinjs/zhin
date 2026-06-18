/**
 * dangerous-tool-policy — 角色门控与 execAllowlist
 */
import { describe, it, expect, afterEach } from 'vitest';
import { setHostRootPlugin } from '../../../core/src/host-plugin-registry.js';
import type { Plugin } from '@zhin.js/core';
import { mockCommMessage } from '../helpers/mock-comm-message.js';
import {
  checkDangerousToolAccess,
  checkFileToolAccess,
  checkSensitiveFilePathAccess,
  checkBashSensitiveReadAccess,
} from '../../src/security/dangerous-tool-policy.js';

afterEach(() => {
  setHostRootPlugin(null);
});

function makeHostPlugin(overrides: Partial<{ execAllowlist: string[]; endpointConfig: unknown }> = {}): Plugin {
  const plugin = {
    inject: (name: string) => {
      if (name === 'ai') {
        return { getAgentConfig: () => ({ execAllowlist: overrides.execAllowlist ?? [] }) };
      }
      if (name === 'icqq') {
        return {
          endpoints: new Map([
            ['b1', { $config: overrides.endpointConfig ?? { master: 'owner1', trusted: ['admin1'] } }],
          ]),
        };
      }
      return undefined;
    },
    root: undefined as unknown,
  } as unknown as Plugin;
  (plugin as { root: typeof plugin }).root = plugin;
  return plugin;
}

describe('checkDangerousToolAccess', () => {
  it('无 IM 身份时放行（直连 Agent / 无 context）', () => {
    const d = checkDangerousToolAccess('web_fetch');
    expect(d.allowed).toBe(true);
    expect(d.role).toBe('master');  // 无身份 = 直接调用 = 全权
  });

  it('有身份但无法解析 host root 时 fail-closed', () => {
    setHostRootPlugin(null);
    const ctx = mockCommMessage({ adapter: 'icqq', endpoint: 'b1', senderId: 'u1' });
    const d = checkDangerousToolAccess('web_fetch', ctx);
    expect(d.allowed).toBe(false);
    expect(d.needsOwnerApproval).toBeUndefined();
  });

  it('trusted 且 execAllowlist 含工具名时直接放行', () => {
    setHostRootPlugin(makeHostPlugin({ execAllowlist: ['write_file'] }));
    const ctx = mockCommMessage({
      adapter: 'icqq',
      endpoint: 'b1',
      senderId: 'admin1',
      sender_roles: ['trusted'],
      extra: { execAllowlist: ['write_file'] },
    });
    const d = checkDangerousToolAccess('write_file', ctx);
    expect(d.allowed).toBe(true);
    expect(d.role).toBe('trusted');
  });

  it('有身份且 trusted 时未入 allowlist 需 Master 确认', () => {
    setHostRootPlugin(makeHostPlugin());
    const ctx = mockCommMessage({
      adapter: 'icqq',
      endpoint: 'b1',
      senderId: 'admin1',
      sender_roles: ['trusted'],
    });
    const d = checkDangerousToolAccess('write_file', ctx);
    expect(d.allowed).toBe(false);
    expect(d.needsOwnerApproval).toBe(true);
  });

  it('普通用户拒绝危险工具', () => {
    setHostRootPlugin(null);
    const ctx = mockCommMessage({
      adapter: 'icqq',
      endpoint: 'b1',
      senderId: 'user1',
      sender_roles: ['user'],
    });
    const d = checkDangerousToolAccess('web_fetch', ctx);
    expect(d.allowed).toBe(false);
    expect(d.role).toBe('other');
  });
});

describe('checkFileToolAccess', () => {
  it('master 读写均放行', () => {
    const ctx = mockCommMessage({ sender_roles: ['master'] });
    expect(checkFileToolAccess('read_file', ctx).allowed).toBe(true);
    expect(checkFileToolAccess('write_file', ctx).allowed).toBe(true);
  });

  it('有身份但角色未知时拒绝写操作', () => {
    setHostRootPlugin(null);
    const ctx = mockCommMessage({ adapter: 'icqq', endpoint: 'b1', senderId: 'x' });
    const d = checkFileToolAccess('write_file', ctx);
    expect(d.allowed).toBe(false);
  });

  it('有身份但角色未知时仍允许读', () => {
    setHostRootPlugin(null);
    const ctx = mockCommMessage({ adapter: 'icqq', endpoint: 'b1', senderId: 'x' });
    const d = checkFileToolAccess('read_file', ctx);
    expect(d.allowed).toBe(true);
  });
});

describe('checkSensitiveFilePathAccess', () => {
  it('普通用户读取 .env 被拒绝', () => {
    setHostRootPlugin(null);
    const ctx = mockCommMessage({
      adapter: 'icqq',
      endpoint: 'b1',
      senderId: 'user1',
      sender_roles: ['user'],
    });
    const d = checkSensitiveFilePathAccess('read_file', '/app/.env', ctx);
    expect(d.allowed).toBe(false);
    expect(d.role).toBe('other');
  });

  it('master 读取 .env 需确认', () => {
    const ctx = mockCommMessage({ sender_roles: ['master'] });
    const d = checkSensitiveFilePathAccess('read_file', '/app/.env', ctx);
    expect(d.allowed).toBe(false);
    expect(d.needsOwnerApproval).toBe(true);
    expect(d.role).toBe('master');
  });
});

describe('checkBashSensitiveReadAccess', () => {
  it('普通用户 bash head .env 被拒绝', () => {
    setHostRootPlugin(null);
    const ctx = mockCommMessage({
      adapter: 'icqq',
      endpoint: 'b1',
      senderId: 'user1',
      sender_roles: ['user'],
    });
    const d = checkBashSensitiveReadAccess('head .env', ctx);
    expect(d.allowed).toBe(false);
    expect(d.role).toBe('other');
  });
});
