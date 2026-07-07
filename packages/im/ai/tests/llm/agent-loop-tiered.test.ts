import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  agentLoop,
  agentContextFrom,
  registerApiProvider,
  registerProviderInstance,
  getLlmTransportModel,
  createAssistantMessageEventStream,
  clearApiRegistryForTests,
  createUserMessage,
  EMPTY_TOKEN_USAGE,
  z,
  type AssistantMessage,
  type LlmTool,
  type AgentMessage,
} from '../../src/llm/index.js';

describe('agentLoop tiered execution', () => {
  let parallelStartOrder: string[] = [];
  let parallelEndOrder: string[] = [];

  const slowReadA: LlmTool = {
    name: 'read_file',
    description: 'read',
    parameters: z.object({ path: z.string() }),
  };

  const slowReadB: LlmTool = {
    name: 'grep',
    description: 'grep',
    parameters: z.object({ pattern: z.string() }),
  };

  beforeEach(() => {
    parallelStartOrder = [];
    parallelEndOrder = [];
    clearApiRegistryForTests();
    registerProviderInstance('test', { sdk: 'openai' }, ['mock']);
    registerApiProvider({
      api: 'ai-sdk',
      stream(_model, context) {
        const toolResults = context.messages.filter((m) => m.role === 'toolResult');
        if (toolResults.length >= 2) {
          const message: AssistantMessage = {
            role: 'assistant',
            content: [{ type: 'text', text: 'done' }],
            api: 'ai-sdk',
            provider: 'test',
            model: 'mock',
            usage: EMPTY_TOKEN_USAGE,
            stopReason: 'stop',
            timestamp: Date.now(),
          };
          return createAssistantMessageEventStream(async (push) => {
            push({ type: 'done', message });
            return message;
          });
        }

        const message: AssistantMessage = {
          role: 'assistant',
          content: [
            { type: 'toolCall', id: 'call_read', name: 'read_file', arguments: { path: 'a.txt' } },
            { type: 'toolCall', id: 'call_grep', name: 'grep', arguments: { pattern: 'foo' } },
          ],
          api: 'ai-sdk',
          provider: 'test',
          model: 'mock',
          usage: EMPTY_TOKEN_USAGE,
          stopReason: 'toolCalls',
          timestamp: Date.now(),
        };
        return createAssistantMessageEventStream(async (push) => {
          push({ type: 'done', message });
          return message;
        });
      },
    });
  });

  it('runs tiered parallel bucket concurrently before sequential tools', async () => {
    const model = getLlmTransportModel('test', 'mock');
    const delayMs = 40;

    const executeTool = vi.fn(async (toolCall): Promise<AgentMessage> => {
      parallelStartOrder.push(toolCall.name);
      await new Promise((r) => setTimeout(r, delayMs));
      parallelEndOrder.push(toolCall.name);
      return {
        role: 'toolResult',
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        content: [{ type: 'text', text: toolCall.name }],
        timestamp: Date.now(),
      };
    });

    const t0 = Date.now();
    for await (const _event of agentLoop(
      createUserMessage('tiered'),
      agentContextFrom({ systemPrompt: 'sys', messages: [], tools: [slowReadA, slowReadB] }),
      { model, maxIterations: 2, toolExecution: 'tiered', executeTool },
    )) {
      // drain
    }
    const elapsed = Date.now() - t0;

    expect(parallelStartOrder).toEqual(['read_file', 'grep']);
    expect(parallelEndOrder).toHaveLength(2);
    expect(elapsed).toBeLessThan(delayMs * 2 - 10);
    expect(executeTool).toHaveBeenCalledTimes(2);
  });
});
