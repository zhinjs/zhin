/**
 * Standalone loop 延迟加载回归：load_tool 之后目标工具必须真实可执行
 * （修复前：load_tool 只写 snapshot，executor 报 "Unknown tool"），
 * 且子 loop 的加载不污染父会话 snapshot。
 */
import { describe, expect, it } from 'vitest';
import type { AgentTool, AIProvider, ChatCompletionResponse, ChatMessage } from '@zhin.js/ai';
import { runAgentLoopStandaloneTurn } from '../../src/core/agent-loop-standalone.js';
import {
  LoadToolBuiltinTool,
  bindDeferredToolRuntime,
  type DeferredToolRuntime,
} from '../../src/builtin/deferred-tool-meta.js';
import { wireMockProviderToLlmApi } from '../helpers/mock-llm-api.js';

function completion(message: Partial<ChatMessage>): ChatCompletionResponse {
  return {
    id: 'mock',
    object: 'chat.completion',
    created: 0,
    model: 'mock',
    choices: [{
      index: 0,
      message: { role: 'assistant', content: null, ...message } as ChatMessage,
      finish_reason: message.tool_calls ? 'tool_calls' : 'stop',
    }],
  } as ChatCompletionResponse;
}

describe('standalone loop 延迟加载', () => {
  it('load_tool 后目标工具可执行，且父会话 snapshot 不被写入', async () => {
    const executed: string[] = [];
    const bashTool: AgentTool = {
      name: 'bash',
      description: 'run shell',
      parameters: { type: 'object', properties: {} },
      source: 'builtin',
      execute: async () => {
        executed.push('bash');
        return 'bash-ok';
      },
    } as unknown as AgentTool;
    const loadTool = new LoadToolBuiltinTool().toTool() as unknown as AgentTool;

    let phase = 0;
    const provider = {
      name: 'test',
      models: ['mock'],
      capabilities: { vision: false, streaming: false, toolCalling: true },
      async chat(): Promise<ChatCompletionResponse> {
        phase += 1;
        if (phase === 1) {
          return completion({
            tool_calls: [{ id: 't1', type: 'function', function: { name: 'load_tool', arguments: '{"name":"bash"}' } }],
          });
        }
        if (phase === 2) {
          return completion({
            tool_calls: [{ id: 't2', type: 'function', function: { name: 'bash', arguments: '{}' } }],
          });
        }
        return completion({ content: 'done' });
      },
      async *chatStream() {},
    } as unknown as AIProvider;
    wireMockProviderToLlmApi(provider);

    const parentSnapshot = { loadedTools: {} as Record<string, number> };
    const runtime: DeferredToolRuntime = {
      sessionId: 'parent',
      catalog: [
        { name: 'load_tool', brief: 'meta', fullTool: loadTool, source: 'meta', deferDefault: false },
        { name: 'bash', brief: 'shell', fullTool: bashTool, source: 'builtin', deferDefault: true },
      ],
      skillRegistry: null,
      snapshot: parentSnapshot as DeferredToolRuntime['snapshot'],
      maxLoadedPerSession: 12,
      discoverTopK: 5,
      persistSnapshot: async () => {},
      skillLoadOpts: {} as DeferredToolRuntime['skillLoadOpts'],
    };
    const commMessage = {} as never;
    bindDeferredToolRuntime(commMessage, runtime);

    const result = await runAgentLoopStandaloneTurn({
      provider,
      model: 'mock',
      systemPrompt: '',
      tools: [loadTool],
      userInput: '加载并运行 bash',
      maxIterations: 6,
      commMessage,
    });

    // 关键断言 1：bash 真正执行了（不再是 Unknown tool）
    expect(executed).toEqual(['bash']);
    expect(result.toolCalls.map((t) => t.tool)).toEqual(['load_tool', 'bash']);
    expect(result.toolCalls.find((t) => t.tool === 'bash')?.result).toContain('bash-ok');
    // 关键断言 2：父会话 snapshot 未被子 loop 写入
    expect(parentSnapshot.loadedTools).toEqual({});
  });
});
