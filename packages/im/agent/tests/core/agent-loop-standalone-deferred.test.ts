/**
 * Standalone loop 延迟加载回归：load_tool 之后目标工具必须真实可执行
 * （修复前：load_tool 只写 snapshot，executor 报 "Unknown tool"），
 * 且子 loop 的加载不污染父会话 snapshot。
 */
import { describe, expect, it } from 'vitest';
import type { AgentTool, AIProvider } from '@zhin.js/ai';
import { runAgentLoopStandaloneTurn } from '../../src/core/agent-loop-standalone.js';
import {
  createDeferredTurnController,
  runWithDeferredTurnController,
} from '../../src/tool-catalog/deferred-turn-controller.js';
import { wireMockLlmApi, assistantTextReply, assistantToolCallReply } from '../helpers/mock-llm-api.js';

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
    let phase = 0;
    const llm = wireMockLlmApi({
      name: 'test',
      models: ['mock'],
      responder: () => {
        phase += 1;
        if (phase === 1) {
          return assistantToolCallReply([{ id: 't1', name: 'load_tool', arguments: { name: 'bash' } }]);
        }
        if (phase === 2) {
          return assistantToolCallReply([{ id: 't2', name: 'bash', arguments: {} }]);
        }
        return assistantTextReply('done');
      },
    });
    const provider = Object.assign(llm.provider, {
      capabilities: { vision: false, streaming: false, toolCalling: true },
    }) as unknown as AIProvider;

    const parentSnapshot = { loadedTools: {} as Record<string, number> };
    const controller = createDeferredTurnController({
      sessionId: 'parent',
      catalog: [
        { name: 'bash', brief: 'shell', fullTool: bashTool, source: 'builtin', deferDefault: true },
      ],
      skillRegistry: null,
      snapshot: { ...parentSnapshot, loadedSkills: [] },
      maxLoadedPerSession: 12,
      discoverTopK: 5,
      persistSnapshot: async () => {},
      skillLoadOpts: { skillDirList: () => [], skillMaxChars: 4_000 },
    });
    const commMessage = {} as never;

    const result = await runWithDeferredTurnController(controller, () => runAgentLoopStandaloneTurn({
      provider,
      model: 'mock',
      systemPrompt: '',
      tools: [],
      userInput: '加载并运行 bash',
      maxIterations: 6,
      commMessage,
    }));

    // 关键断言 1：bash 真正执行了（不再是 Unknown tool）
    expect(executed).toEqual(['bash']);
    expect(result.toolCalls.map((t) => t.tool)).toEqual(['load_tool', 'bash']);
    expect(result.toolCalls.find((t) => t.tool === 'bash')?.result).toContain('bash-ok');
    // 关键断言 2：父会话 snapshot 未被子 loop 写入
    expect(parentSnapshot.loadedTools).toEqual({});
  });
});
