import { describe, expect, it, beforeEach } from 'vitest';
import {
  agentLoop,
  clearApiRegistryForTests,
  createAssistantMessageEventStream,
  registerApiProvider,
  registerProviderInstance,
  getLlmTransportModel,
  createUserMessage,
  EMPTY_TOKEN_USAGE,
  z,
  type AgentEvent,
  type AgentMessage,
  type AssistantMessage,
  type LlmTool,
} from '../../src/llm/index.js';
import {
  createIncrementalRepair,
  repairAgentMessagesForLlm,
} from '../../src/llm/repair-agent-messages.js';

const MODEL = { api: 'ai-sdk' as const, provider: 'test', id: 'mock' };

function assistantWithCalls(calls: Array<{ id: string; name: string }>): AssistantMessage {
  return {
    role: 'assistant',
    content: calls.map((c) => ({ type: 'toolCall', id: c.id, name: c.name, arguments: {} })),
    ...MODEL,
    model: MODEL.id,
    usage: EMPTY_TOKEN_USAGE,
    stopReason: 'toolCalls',
    timestamp: Date.now(),
  };
}

function assistantText(text: string): AssistantMessage {
  return {
    role: 'assistant',
    content: [{ type: 'text', text }],
    ...MODEL,
    model: MODEL.id,
    usage: EMPTY_TOKEN_USAGE,
    stopReason: 'stop',
    timestamp: Date.now(),
  };
}

describe('agentLoop harness 不变量', () => {
  beforeEach(() => {
    clearApiRegistryForTests();
    registerProviderInstance('test', { sdk: 'openai' }, ['mock']);
  });

  it('agent_end 事件快照在生成器结束后仍完整（不再被 finally 清空）', async () => {
    registerApiProvider({
      api: 'ai-sdk',
      stream() {
        const message = assistantText('done');
        return createAssistantMessageEventStream(async (push) => {
          push({ type: 'done', message });
          return message;
        });
      },
    } as never);
    let agentEnd: Extract<AgentEvent, { type: 'agent_end' }> | undefined;
    for await (const event of agentLoop(
      createUserMessage('hi'),
      { systemPrompt: '', messages: [], tools: [] },
      { model: getLlmTransportModel('test', 'mock') } as never,
    )) {
      if (event.type === 'agent_end') agentEnd = event;
    }
    // 生成器已完整结束：事件里的 messages 必须是当时的快照
    expect(agentEnd).toBeDefined();
    expect(agentEnd!.messages.length).toBeGreaterThan(0);
    expect(agentEnd!.messages.some((m) => m.role === 'assistant')).toBe(true);
  });

  it('并行工具结果按调用序落列（与完成先后无关）', async () => {
    const slow = 'read_file';
    const fast = 'web_search';
    registerApiProvider({
      api: 'ai-sdk',
      stream(_model: unknown, context: { messages: AgentMessage[] }) {
        const hasResults = context.messages.some((m) => m.role === 'toolResult');
        const message = hasResults
          ? assistantText('ok')
          : assistantWithCalls([
            { id: 'call_slow', name: slow },
            { id: 'call_fast', name: fast },
          ]);
        return createAssistantMessageEventStream(async (push) => {
          push({ type: 'done', message });
          return message;
        });
      },
    } as never);

    const tools: LlmTool[] = [
      { name: slow, description: '', parameters: z.object({}) },
      { name: fast, description: '', parameters: z.object({}) },
    ];
    const emitted: AgentMessage[] = [];
    for await (const event of agentLoop(
      createUserMessage('go'),
      { systemPrompt: '', messages: [], tools },
      {
        model: getLlmTransportModel('test', 'mock'),
        toolExecution: 'parallel',
        executeTool: async (call) => {
          if (call.name === slow) await new Promise((r) => setTimeout(r, 30));
          return {
            role: 'toolResult' as const,
            toolCallId: call.id,
            toolName: call.name,
            content: [{ type: 'text' as const, text: call.name }],
            isError: false,
            timestamp: Date.now(),
          };
        },
      } as never,
    )) {
      if (event.type === 'agent_end') emitted.push(...event.messages);
    }
    const resultIds = emitted.filter((m) => m.role === 'toolResult').map((m) => m.toolCallId);
    // slow 先声明但后完成：落列顺序仍是声明顺序
    expect(resultIds).toEqual(['call_slow', 'call_fast']);
  });
});

describe('createIncrementalRepair', () => {
  it('逐步追加与一次性全量修复结果一致', () => {
    const orphan: AgentMessage = {
      role: 'toolResult',
      toolCallId: 'ghost',
      toolName: 'ghost',
      content: [{ type: 'text', text: 'orphan' }],
      isError: false,
      timestamp: 1,
    };
    const u1 = createUserMessage('一', undefined, 2);
    const a1 = assistantWithCalls([{ id: 'c1', name: 'echo' }]);
    const r1: AgentMessage = {
      role: 'toolResult', toolCallId: 'c1', toolName: 'echo',
      content: [{ type: 'text', text: 'r1' }], isError: false, timestamp: 4,
    };
    const u2 = createUserMessage('二', undefined, 5);
    const a2 = assistantWithCalls([{ id: 'c2', name: 'echo' }]);

    const repairer = createIncrementalRepair();
    const history: AgentMessage[] = [orphan, u1];
    repairer.repair(history);
    history.push(a1, r1);
    repairer.repair(history);
    history.push(u2, a2);
    const incremental = repairer.repair(history);
    const full = repairAgentMessagesForLlm(history);

    expect(incremental.map((m) => m.role)).toEqual(full.map((m) => m.role));
    // 孤儿 toolResult 被丢弃；c1 有真实结果；c2 尾部注入占位结果
    expect(incremental.some((m) => m.role === 'toolResult' && m.toolCallId === 'ghost')).toBe(false);
    expect(incremental.filter((m) => m.role === 'toolResult')).toHaveLength(2);
    expect(incremental.at(-1)).toMatchObject({ role: 'toolResult', toolCallId: 'c2', isError: true });
  });

  it('历史被替换（边界回退）时自动重置', () => {
    const repairer = createIncrementalRepair();
    const long: AgentMessage[] = [createUserMessage('a', undefined, 1), assistantText('x')];
    repairer.repair(long);
    const short: AgentMessage[] = [assistantText('fresh')];
    const repaired = repairer.repair(short);
    expect(repaired).toHaveLength(1);
    expect(repaired[0]).toMatchObject({ role: 'assistant' });
  });
});
