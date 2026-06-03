/**
 * dangerous-tool-policy — 角色门控与 execAllowlist
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import * as core from '@zhin.js/core';
import type { ToolContext } from '@zhin.js/core';
import {
  checkDangerousToolAccess,
  checkFileToolAccess,
} from '../../src/security/dangerous-tool-policy.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('checkDangerousToolAccess', () => {
  it('无 IM 身份时放行（直连 Agent / 无 context）', () => {
    const d = checkDangerousToolAccess('web_fetch');
    expect(d.allowed).toBe(true);
    expect(d.role).toBe('unknown');
  });

  it('有身份但无法解析插件时 fail-closed', () => {
    vi.spyOn(core, 'getPlugin').mockImplementation(() => {
      throw new Error('no ALS');
    });
    const ctx = { platform: 'icqq', botId: 'b1', senderId: 'u1' } as ToolContext;
    const d = checkDangerousToolAccess('web_fetch', ctx);
    expect(d.allowed).toBe(false);
    expect(d.needsOwnerApproval).toBeUndefined();
  });

  it('有身份且 trusted 时未入 allowlist 需 Master 确认', () => {
    vi.spyOn(core, 'getPlugin').mockImplementation(() => {
      throw new Error('no ALS');
    });
    const ctx = {
      platform: 'icqq',
      botId: 'b1',
      senderId: 'admin1',
      roles: ['trusted'],
    } as ToolContext;
    const d = checkDangerousToolAccess('write_file', ctx);
    expect(d.allowed).toBe(false);
    expect(d.needsOwnerApproval).toBe(true);
  });

  it('普通用户（fileRole user）拒绝危险工具', () => {
    vi.spyOn(core, 'getPlugin').mockImplementation(() => {
      throw new Error('no ALS');
    });
    const ctx = {
      platform: 'icqq',
      botId: 'b1',
      senderId: 'user1',
      fileRole: 'user',
    } as ToolContext;
    const d = checkDangerousToolAccess('web_fetch', ctx);
    expect(d.allowed).toBe(false);
    expect(d.role).toBe('other');
  });
});

describe('checkFileToolAccess', () => {
  it('有身份但角色未知时拒绝写操作', () => {
    vi.spyOn(core, 'getPlugin').mockImplementation(() => {
      throw new Error('no ALS');
    });
    const ctx = { platform: 'icqq', botId: 'b1', senderId: 'x' } as ToolContext;
    const d = checkFileToolAccess('write_file', ctx);
    expect(d.allowed).toBe(false);
  });

  it('有身份但角色未知时仍允许读', () => {
    vi.spyOn(core, 'getPlugin').mockImplementation(() => {
      throw new Error('no ALS');
    });
    const ctx = { platform: 'icqq', botId: 'b1', senderId: 'x' } as ToolContext;
    const d = checkFileToolAccess('read_file', ctx);
    expect(d.allowed).toBe(true);
  });
});
