import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ZhinAgent } from '@zhin.js/agent';
import type { Tool } from '@zhin.js/core';
import type { FixtureTextProvider } from '../../../ai/tests/helpers/text-provider-fixture.js';
import { createTestZhinAgent } from '../helpers/scoped-agent.js';
import { assistantTextReply, assistantToolCallReply, wireMockLlmApi, type MockLlmApi } from '../helpers/mock-llm-api.js';
import { mockCommMessage } from '../helpers/mock-comm-message.js';
import { DEFAULT_ALWAYS_LOADED_TOOLS } from '../../src/tool-catalog/types.js';
import {
  formatUnexecutedNotice,
  formatUnexecutedToolResult,
  unresolvedSideEffectFailures,
} from '../../src/core/unexecuted-tool-notice.js';

describe('unexecuted tool notice helpers (#1250)', () => {
  it('marks denied and failed results as not executed, with the reason', () => {
    const denied = formatUnexecutedToolResult('memory_upsert', 'denied', 'approval required but ApprovalPort unavailable', true);
    expect(denied).toContain('未执行');
    expect(denied).toContain('approval required but ApprovalPort unavailable');
    expect(denied).toContain('不要说已经完成');
    const failed = formatUnexecutedToolResult('read_file', 'failed', 'ENOENT', false);
    expect(failed).toContain('未执行成功');
    expect(failed).not.toContain('不要说已经完成');
  });

  it('keeps only side-effect failures that were not completed later', () => {
    expect(unresolvedSideEffectFailures([
      { tool: 'memory_upsert', result: 'x', status: 'denied', sideEffect: true },
      { tool: 'read_file', result: 'x', status: 'failed', sideEffect: false },
      { tool: 'discover', result: 'x', status: 'failed', sideEffect: true },
      { tool: 'write_file', result: 'x', status: 'failed', sideEffect: true },
      { tool: 'write_file', result: 'ok', status: 'completed' },
    ]).map(call => call.tool)).toEqual(['memory_upsert']);
  });

  it('names the action kinds in one deterministic line', () => {
    const call = (tool: string) => ({ tool, result: 'x', status: 'denied' as const, sideEffect: true });
    expect(formatUnexecutedNotice([call('memory_upsert')])).toBe('（记忆操作未执行）');
    expect(formatUnexecutedNotice([call('schedule_add'), call('memory_upsert')])).toBe('（提醒、记忆等操作未执行）');
    expect(formatUnexecutedNotice([call('memory_upsert'), call('memory_delete')])).toBe('（记忆操作未执行）');
    expect(formatUnexecutedNotice([call('save_pref')])).toBe('（「save_pref」操作未执行）');
    expect(formatUnexecutedNotice([call('write_file'), call('bash')], 'en')).toBe('(Not done: files, commands.)');
  });
});

function createAgent(llm: MockLlmApi, extraTools: readonly string[]): ZhinAgent {
  const provider = Object.assign(llm.provider, { listModels: vi.fn(async () => ['mock-model']) }) as unknown as FixtureTextProvider;
  return createTestZhinAgent({ runtime: llm.runtime, alias: provider.name, model: provider.models[0], config: {
    persona: '测试助手',
    deferredTools: { alwaysLoadedTools: [...DEFAULT_ALWAYS_LOADED_TOOLS, ...extraTools] },
  }, events: undefined });
}

function failingTool(name: string, readOnly: boolean): Tool {
  return {
    name,
    description: 'Save one preference',
    parameters: { type: 'object', properties: {} },
    ...(readOnly ? { isReadOnly: true } : {}),
    execute: vi.fn(async () => { throw new Error('semantic memory database is not active'); }),
  } as Tool;
}

function scripted(llm: MockLlmApi, toolName: string, finalText: string): void {
  let step = 0;
  llm.respondWith(() => {
    step += 1;
    return step === 1
      ? assistantToolCallReply([{ id: 'call-1', name: toolName, arguments: {} }])
      : assistantTextReply(JSON.stringify({ segments: [{ type: 'text', data: { text: finalText } }] }));
  });
}

describe('final reply after a failed side-effect tool (#1250)', () => {
  let agent: ZhinAgent | undefined;
  afterEach(() => { agent?.dispose(); agent = undefined; });
  const message = () => mockCommMessage({ adapter: 'test', endpoint: 'bot1', senderId: 'u1', scope: 'private', sceneId: 's1' });

  it('appends an honest line when the reply claims success', async () => {
    const llm = wireMockLlmApi();
    scripted(llm, 'save_pref', '记住啦，以后不放香菜～');
    agent = createAgent(llm, ['save_pref']);
    const output = JSON.stringify(await agent.process('记住：我不吃香菜', message(), [failingTool('save_pref', false)]));
    expect(output).toContain('记住啦');
    expect(output).toContain('（「save_pref」操作未执行）');
    const toolResult = JSON.stringify(llm.calls.at(-1)?.context.messages);
    expect(toolResult).toContain('未执行成功');
  });

  it('appends the line even when the reply already says it was not done (no keyword guessing)', async () => {
    const llm = wireMockLlmApi();
    scripted(llm, 'save_pref', '抱歉，这次没能记住，记忆功能暂时不可用。');
    agent = createAgent(llm, ['save_pref']);
    const output = JSON.stringify(await agent.process('记住：我不吃香菜', message(), [failingTool('save_pref', false)]));
    expect(output).toContain('没能记住');
    expect(output).toContain('（「save_pref」操作未执行）');
  });

  it('appends the line when the reply merely contains a refusal word (#1250 counterexample)', async () => {
    const llm = wireMockLlmApi();
    scripted(llm, 'memory_save', '记住啦，你不能吃香菜');
    agent = createAgent(llm, ['memory_save']);
    const output = JSON.stringify(await agent.process('记住：我不吃香菜', message(), [failingTool('memory_save', false)]));
    expect(output).toContain('记住啦，你不能吃香菜');
    expect(output).toContain('（记忆操作未执行）');
  });

  it('adds nothing for a failed read-only tool', async () => {
    const llm = wireMockLlmApi();
    scripted(llm, 'peek_pref', '好的～');
    agent = createAgent(llm, ['peek_pref']);
    const output = JSON.stringify(await agent.process('看看我的偏好', message(), [failingTool('peek_pref', true)]));
    expect(output).not.toContain('操作未执行');
  });
});
