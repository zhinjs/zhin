/**
 * ask_user 内置工具单测 — 错误路径与 formatOwnerResponse
 */
import { describe, it, expect } from 'vitest';
import { mockCommMessage } from '../helpers/mock-comm-message.js';

import {
  AskUserBuiltinTool,
  ASK_USER_PARAMETERS,
  createAskUserTool,
  formatOwnerResponse,
} from '../../src/builtin/ask-user-tool.js';
import { normalizeTool } from '../../src/orchestrator/tool-selection.js';
import type { Message } from '@zhin.js/core';

describe('ASK_USER_PARAMETERS', () => {
  it('options array has string items (OpenAI strict schema)', () => {
    const options = ASK_USER_PARAMETERS.properties!.options;
    expect(options?.type).toBe('array');
    expect(options?.items).toEqual({ type: 'string' });
  });
});

describe('AskUserBuiltinTool', () => {
  it('无 message 上下文返回错误', async () => {
    const inst = new AskUserBuiltinTool(undefined);
    const out = String(await inst.run({ question: 'q?' }, undefined));
    expect(out).toContain('没有消息来源');
  });

  it('无 plugin 返回错误', async () => {
    const inst = new AskUserBuiltinTool(undefined);
    const out = String(await inst.run(
      { question: 'q?' },
      mockCommMessage({ adapter: 'x', endpoint: 'b' }),
    ));
    expect(out).toContain('插件实例不可用');
  });

  it('createAskUserTool 无参仍注册工具名', () => {
    const t = createAskUserTool();
    expect(t.name).toBe('ask_user');
  });

  it('normalizeTool 执行无上下文时走错误分支', async () => {
    const tool = createAskUserTool();
    const agentTool = normalizeTool(tool);
    const out = String(await agentTool.execute({ question: 'hi' }));
    expect(out).toContain('消息来源');
  });

  it('normalizeTool 应保留 ask_user 长超时', () => {
    const tool = createAskUserTool();
    const agentTool = normalizeTool(tool, mockCommMessage({ adapter: 't' }));
    expect(agentTool.timeout).toBe(150_000);
  });
});

describe('formatOwnerResponse', () => {
  it('confirm 映射 yes/no', () => {
    expect(formatOwnerResponse(' YES ', 'confirm', {})).toBe('yes');
    expect(formatOwnerResponse('no', 'confirm', {})).toBe('no');
  });

  it('number 转为数字字符串', () => {
    expect(formatOwnerResponse('42', 'number', {})).toBe('42');
    expect(formatOwnerResponse('abc', 'number', {})).toBe('0');
  });

  it('pick 按 1-based 索引', () => {
    expect(formatOwnerResponse('2', 'pick', { options: ['a', 'b', 'c'] })).toBe('b');
    expect(formatOwnerResponse('9', 'pick', { options: ['a'] })).toBe('9');
  });

  it('text 原样返回', () => {
    expect(formatOwnerResponse('  x  ', 'text', {})).toBe('  x  ');
  });
});
