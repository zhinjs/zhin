/**
 * Owner 确认信号与硬编排（#398）
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { Plugin } from '@zhin.js/core';
import * as utils from '../src/discovery/utils.js';
import { addOwnerApproveAlways } from '../src/security/owner-approve-always-store.js';
import {
  ZHIN_NEEDS_OWNER_FIRST_LINE,
  parseNeedsOwnerSignal,
  shouldHardOrchestrateOwnerConfirm,
  createOwnerOrchestratedToolResultTransform,
} from '../src/orchestrator/owner-confirm-orchestration.js';
import { AskUserBuiltinTool } from '../src/builtin/ask-user-tool.js';

/** 满足 AskUserBuiltinTool 构造即可；真实 `run` 由 spy 拦截 */
const stubPlugin = {
  inject: vi.fn(() => undefined),
  addMiddleware: vi.fn(() => vi.fn()),
} as unknown as Plugin;

describe('owner-confirm-orchestration', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhin-oc-'));
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

  it('parseNeedsOwnerSignal：首行须精确匹配且不含前导空白', () => {
    expect(parseNeedsOwnerSignal('x').hasSignal).toBe(false);
    expect(parseNeedsOwnerSignal(` ${ZHIN_NEEDS_OWNER_FIRST_LINE}\nbody`).hasSignal).toBe(false);
    const r = parseNeedsOwnerSignal(`${ZHIN_NEEDS_OWNER_FIRST_LINE}\nline2\nline3`);
    expect(r.hasSignal).toBe(true);
    expect(r.body).toContain('line2');
  });

  it('shouldHardOrchestrateOwnerConfirm：白名单', () => {
    const s = `${ZHIN_NEEDS_OWNER_FIRST_LINE}\nhello`;
    expect(shouldHardOrchestrateOwnerConfirm('bash', s)).toBe(true);
    expect(shouldHardOrchestrateOwnerConfirm('write_file', s)).toBe(true);
    expect(shouldHardOrchestrateOwnerConfirm('read_file', s)).toBe(false);
  });

  it('子 Agent 禁用 B 时不调用 ask_user', async () => {
    const spy = vi.spyOn(AskUserBuiltinTool.prototype, 'run').mockResolvedValue('yes');
    const t = createOwnerOrchestratedToolResultTransform({
      toolContext: { platform: 'test' },
      plugin: stubPlugin,
      disableHardOrchestration: true,
    });
    const raw = `${ZHIN_NEEDS_OWNER_FIRST_LINE}\nreason`;
    const out = await t({ toolName: 'bash', toolCallId: '1', args: {}, result: raw });
    expect(out).toBe(raw);
    expect(spy).not.toHaveBeenCalled();
  });

  it('硬编排成功时附加 Owner 答复块', async () => {
    vi.spyOn(AskUserBuiltinTool.prototype, 'run').mockResolvedValue('yes');
    const t = createOwnerOrchestratedToolResultTransform({
      toolContext: { platform: 'test', message: {} },
      plugin: stubPlugin,
    });
    const raw = `${ZHIN_NEEDS_OWNER_FIRST_LINE}\nreason`;
    const out = await t({ toolName: 'bash', toolCallId: '1', args: {}, result: raw });
    expect(out).toContain('[Owner confirmation (orchestrated)]');
    expect(out).toContain('yes');
  });

  it('ask_user 返回 Error 时软降级且不消耗自动确认次数', async () => {
    const spy = vi.spyOn(AskUserBuiltinTool.prototype, 'run').mockResolvedValue('Error: 当前 Bot 未配置 owner');
    const t = createOwnerOrchestratedToolResultTransform({
      toolContext: { platform: 'test', message: {} },
      plugin: stubPlugin,
      maxAutoOwnerAsk: 1,
    });
    const raw = `${ZHIN_NEEDS_OWNER_FIRST_LINE}\nreason`;
    const o1 = await t({ toolName: 'bash', toolCallId: '1', args: {}, result: raw });
    expect(o1).toContain('无法自动收集 Owner');
    spy.mockResolvedValueOnce('yes');
    const o2 = await t({ toolName: 'bash', toolCallId: '2', args: {}, result: raw });
    expect(o2).toContain('[Owner confirmation (orchestrated)]');
    const o3 = await t({ toolName: 'bash', toolCallId: '3', args: {}, result: raw });
    expect(o3).toContain('已达上限');
  });

  it('达到 maxAutoOwnerAsk 后不再调用 ask', async () => {
    const spy = vi.spyOn(AskUserBuiltinTool.prototype, 'run').mockResolvedValue('yes');
    const t = createOwnerOrchestratedToolResultTransform({
      toolContext: { platform: 'test', message: {} },
      plugin: stubPlugin,
      maxAutoOwnerAsk: 2,
    });
    const raw = `${ZHIN_NEEDS_OWNER_FIRST_LINE}\nx`;
    await t({ toolName: 'bash', toolCallId: '1', args: {}, result: raw });
    await t({ toolName: 'bash', toolCallId: '2', args: {}, result: raw });
    const o3 = await t({ toolName: 'bash', toolCallId: '3', args: {}, result: raw });
    expect(o3).toContain('已达上限');
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('approve-always 白名单命中时不再调用 ask_user', async () => {
    const bots = new Map([['bot1', { $config: { owner: 'O1' } }]]);
    const pluginWithAdapter = {
      inject: vi.fn((name: string) => {
        if (name === 'icqq') return { bots };
        return undefined;
      }),
    } as unknown as Plugin;
    (pluginWithAdapter as unknown as { root: Plugin }).root = pluginWithAdapter;

    addOwnerApproveAlways(pluginWithAdapter, { platform: 'icqq', botId: 'bot1' }, 'bash');

    const spy = vi.spyOn(AskUserBuiltinTool.prototype, 'run');
    const t = createOwnerOrchestratedToolResultTransform({
      toolContext: { platform: 'icqq', botId: 'bot1', message: {} },
      plugin: pluginWithAdapter,
    });
    const raw = `${ZHIN_NEEDS_OWNER_FIRST_LINE}\nreason`;
    const out = await t({ toolName: 'bash', toolCallId: '1', args: {}, result: raw });
    expect(spy).not.toHaveBeenCalled();
    expect(out).toContain('[Owner confirmation (orchestrated)]');
    expect(out).toContain('yes');
  });
});
