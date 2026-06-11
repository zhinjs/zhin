/**
 * Owner approve-always 持久化键与读写
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mockCommMessage } from '../helpers/mock-comm-message.js';
import type { Plugin } from '@zhin.js/core';
import * as utils from '../../src/discovery/utils.js';
import {
  addBashApproveRule,
  addOwnerApproveAlways,
  hasOwnerApproveAlways,
  listOwnerApproveAlways,
  matchesBashOwnerExecBypass,
  removeOwnerApproveAlways,
} from '../../src/security/owner-approve-always-store.js';

function makeRootPlugin(adapterName: string): Plugin {
  const endpoints = new Map([['bot1', { $config: { master: 'owner99' } }]]);
  const p = {
    inject: vi.fn((name: string) => {
      if (name === adapterName) return { endpoints };
      return undefined;
    }),
  } as unknown as Plugin;
  (p as unknown as { root: Plugin }).root = p;
  return p;
}

describe('owner-approve-always-store', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhin-oa-'));
    vi.spyOn(utils, 'getDataDir').mockReturnValue(tmpDir);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it('add / has / list / remove 按 adapter+bot+owner+tool 隔离', () => {
    const plugin = makeRootPlugin('icqq');
    const ctx = mockCommMessage({ adapter: 'icqq', endpoint: 'bot1' });
    expect(hasOwnerApproveAlways(plugin, ctx, 'bash')).toBe(false);
    expect(addOwnerApproveAlways(plugin, ctx, 'bash').ok).toBe(true);
    expect(hasOwnerApproveAlways(plugin, ctx, 'bash')).toBe(true);
    expect(listOwnerApproveAlways(plugin, ctx).some((x) => x === 'bash')).toBe(true);
    expect(removeOwnerApproveAlways(plugin, ctx, 'bash').ok).toBe(true);
    expect(hasOwnerApproveAlways(plugin, ctx, 'bash')).toBe(false);
  });

  it('拒绝非 bash 的永久放行请求', () => {
    const plugin = makeRootPlugin('icqq');
    const ctx = mockCommMessage({ adapter: 'icqq', endpoint: 'bot1' });
    const r = addOwnerApproveAlways(plugin, ctx, 'write_file');
    expect(r.ok).toBe(false);
  });

  it('approve rule 用正则匹配整段子命令（不固化 uid）', () => {
    const plugin = makeRootPlugin('icqq');
    const ctx = mockCommMessage({ adapter: 'icqq', endpoint: 'bot1' });
    expect(addBashApproveRule(plugin, ctx, '^icqq\\s+friend\\s+like\\b').ok).toBe(true);
    expect(matchesBashOwnerExecBypass(plugin, ctx, 'icqq friend like 999')).toBe(true);
    expect(matchesBashOwnerExecBypass(plugin, ctx, 'icqq friend like 111')).toBe(true);
    expect(matchesBashOwnerExecBypass(plugin, ctx, 'icqq group kick 1 2')).toBe(false);
  });
});
