import { describe, it, expect, beforeEach } from 'vitest';
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
} from '../../src/llm/index.js';
import { agentLoop as runLoop } from '../../src/llm/agent-loop.js';

describe('agentLoop', () => {
  const echoTool: LlmTool = {
    name: 'echo',
    description: 'echo',
    parameters: z.object({ message: z.string() }),
  };

  beforeEach(() => {
    clearApiRegistryForTests();
    registerProviderInstance('test', { sdk: 'openai' }, ['mock']);
    registerApiProvider({
      api: 'ai-sdk',
      stream(_model, context) {
        const last = context.messages.at(-1);
        const userText = last?.role === 'user'
          ? last.content.find((b) => b.type === 'text')?.text ?? ''
          : '';

        const hasToolResults = context.messages.some((m) => m.role === 'toolResult');
        if (!hasToolResults && context.tools?.length && userText.startsWith('tool:')) {
          const message: AssistantMessage = {
            role: 'assistant',
            content: [{
              type: 'toolCall',
              id: 'call_1',
              name: 'echo',
              arguments: { message: userText.slice(5) },
            }],
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
        }

        const reply = hasToolResults
          ? `done:${context.messages.filter((m) => m.role === 'toolResult').map((m) => m.role === 'toolResult' ? m.content[0]?.type === 'text' ? m.content[0].text : '' : '').join('')}`
          : userText;

        const message: AssistantMessage = {
          role: 'assistant',
          content: [{ type: 'text', text: reply }],
          api: 'mock',
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
      },
    });
  });

  it('single iteration when no tools (maxIterations=1)', async () => {
    const model = getLlmTransportModel('test', 'mock');
    const events = [];
    for await (const event of runLoop(
      createUserMessage('hello'),
      agentContextFrom({ systemPrompt: 'sys', messages: [], tools: [] }),
      { model, maxIterations: 1 },
    )) {
      events.push(event.type);
    }
    expect(events).toContain('agent_end');
    expect(events).toContain('turn_end');
  });

  it('executes tool call then completes', async () => {
    const model = getLlmTransportModel('test', 'mock');
    const events = [];
    for await (const event of runLoop(
      createUserMessage('tool:ping'),
      agentContextFrom({ systemPrompt: 'sys', messages: [], tools: [echoTool] }),
      {
        model,
        maxIterations: 4,
        executeTool: async (call) => ({
          role: 'toolResult',
          toolCallId: call.id,
          toolName: call.name,
          content: [{ type: 'text', text: call.arguments.message as string }],
          isError: false,
          timestamp: Date.now(),
        }),
      },
    )) {
      events.push(event.type);
    }
    expect(events.filter((t) => t === 'tool_execution_end')).toHaveLength(1);
    expect(events).toContain('agent_end');
  });
});
