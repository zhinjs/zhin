import { describe, expect, it, vi } from 'vitest';
import { agentLoop, type AgentLoopConfig } from '../../src/llm/agent-loop.js';
import { LlmApiRuntime } from '../../src/llm/llm-api-runtime.js';
import { createUserMessage, EMPTY_TOKEN_USAGE, type AgentMessage, type AssistantMessage } from '../../src/llm/types/agent-message.js';
import type { AgentEvent } from '../../src/llm/types/agent-event.js';

function fixture() {
  const runtime = new LlmApiRuntime();
  runtime.registerProvider('test', { sdk: 'openai' }, ['mock']);
  const model = runtime.model('test', 'mock');
  const overflow = new Error('context_length_exceeded');
  const success: AssistantMessage = {
    role: 'assistant', content: [{ type: 'text', text: 'continued' }],
    api: model.api, provider: model.provider, model: model.id,
    usage: EMPTY_TOKEN_USAGE, stopReason: 'stop', timestamp: 1,
  };
  const transport = {
    complete: vi.fn().mockRejectedValueOnce(overflow).mockResolvedValue(success),
    completeSimple: vi.fn(),
  };
  const history = createUserMessage('Earlier context. '.repeat(100));
  const prompt = createUserMessage('Continue.');
  async function run(
    config: Pick<AgentLoopConfig, 'onContextOverflow' | 'convertToLlm'>,
    signal?: AbortSignal,
    messages: AgentMessage[] = [history],
  ) {
    const events: AgentEvent[] = [];
    for await (const event of agentLoop(prompt, { systemPrompt: 'sys', tools: [], messages }, {
      model, transport, maxIterations: 1, ...config,
    }, signal)) events.push(event);
    return events;
  }
  return { overflow, success, transport, history, prompt, run };
}

function assistantEnd(events: AgentEvent[]) {
  return events.find(event => event.type === 'message_end' && event.message.role === 'assistant');
}

describe('agentLoop context-overflow recovery', () => {
  it.each(['same array', 'equal copy', 'undefined', 'null', 'empty'])(
    'does not repeat the failed request when recovery returns %s', async (kind) => {
      const f = fixture();
      const recovery = vi.fn(async (messages: AgentMessage[]) => {
        switch (kind) {
          case 'same array': return messages;
          case 'equal copy': return [...messages];
          case 'empty': return [];
          case 'null': return null;
          default: return undefined;
        }
      });
      const events = await f.run({ onContextOverflow: recovery });
      expect(recovery).toHaveBeenCalledTimes(1);
      expect(f.transport.complete).toHaveBeenCalledTimes(1);
      expect(assistantEnd(events)).toMatchObject({ message: { stopReason: 'error', errorMessage: f.overflow.message } });
    },
  );

  it('preserves the original provider error when summarization fails', async () => {
    const f = fixture();
    const events = await f.run({ onContextOverflow: async () => { throw new Error('summary unavailable'); } });
    expect(f.transport.complete).toHaveBeenCalledTimes(1);
    expect(assistantEnd(events)).toMatchObject({ message: { stopReason: 'error', errorMessage: f.overflow.message } });
  });

  it('compares the projected request rather than a smaller raw message array', async () => {
    const f = fixture();
    const projected = [createUserMessage('Same provider-visible context. '.repeat(100))];
    const events = await f.run({
      convertToLlm: () => projected,
      onContextOverflow: async () => [createUserMessage('tiny')],
    });
    expect(f.transport.complete).toHaveBeenCalledTimes(1);
    expect(assistantEnd(events)).toMatchObject({ message: { stopReason: 'error', errorMessage: f.overflow.message } });
  });

  it('measures the failed request before recovery mutates the same messages', async () => {
    const f = fixture();
    const events = await f.run({
      onContextOverflow: async messages => {
        f.history.content = [{ type: 'text', text: 'concise history' }];
        return messages;
      },
    });
    expect(f.transport.complete).toHaveBeenCalledTimes(2);
    expect(assistantEnd(events)).toMatchObject({ message: f.success });
    expect(f.transport.complete.mock.calls[1]![1]).toMatchObject({ messages: [f.history, f.prompt] });
  });

  it('retries after useful tool-result-only reduction without a summary', async () => {
    const f = fixture();
    const call: AssistantMessage = {
      ...f.success,
      content: [{ type: 'toolCall', id: 'call-read', name: 'read_file', arguments: { path: '/synthetic/file' } }],
      stopReason: 'toolCalls',
    };
    const events = await f.run({
      onContextOverflow: async messages => messages.map(message => message.role === 'toolResult'
        ? { ...message, content: [{ type: 'text', text: '[old tool result cleared]' }] }
        : message),
    }, undefined, [f.history, call, {
      role: 'toolResult', toolCallId: 'call-read', toolName: 'read_file',
      content: [{ type: 'text', text: 'Long synthetic tool output. '.repeat(100) }],
      isError: false, timestamp: 2,
    }]);
    expect(f.transport.complete).toHaveBeenCalledTimes(2);
    expect(assistantEnd(events)).toMatchObject({ message: f.success });
    expect(f.transport.complete.mock.calls[1]![1].messages).toHaveLength(4);
  });

  it('does not start recovery after cancellation while the provider request fails', async () => {
    const f = fixture();
    const controller = new AbortController();
    f.transport.complete.mockReset().mockImplementationOnce(async () => {
      controller.abort();
      throw f.overflow;
    });
    const recovery = vi.fn(async () => [createUserMessage('summary')]);
    const events = await f.run({ onContextOverflow: recovery }, controller.signal);
    expect(recovery).not.toHaveBeenCalled();
    expect(f.transport.complete).toHaveBeenCalledTimes(1);
    expect(assistantEnd(events)).toMatchObject({ message: { stopReason: 'aborted' } });
  });

  it('does not retry when cancellation arrives during recovery', async () => {
    const f = fixture();
    const controller = new AbortController();
    const project = vi.fn((messages: AgentMessage[]) => messages);
    const events = await f.run({
      convertToLlm: project,
      onContextOverflow: async () => {
        controller.abort();
        return [createUserMessage('summary')];
      },
    }, controller.signal);
    expect(f.transport.complete).toHaveBeenCalledTimes(1);
    expect(project).toHaveBeenCalledTimes(1);
    expect(assistantEnd(events)).toMatchObject({ message: { stopReason: 'aborted' } });
  });

  it('reports the actual retry failure without starting another recovery', async () => {
    const f = fixture();
    const retryError = new Error('retry connection reset');
    f.transport.complete.mockRejectedValueOnce(retryError);
    const recovery = vi.fn(async () => [createUserMessage('summary')]);
    const events = await f.run({ onContextOverflow: recovery });
    expect(recovery).toHaveBeenCalledTimes(1);
    expect(f.transport.complete).toHaveBeenCalledTimes(2);
    expect(assistantEnd(events)).toMatchObject({ message: { stopReason: 'error', errorMessage: retryError.message } });
  });

  it('preserves the original error when preparing the recovered request fails', async () => {
    const f = fixture();
    let projections = 0;
    const events = await f.run({
      convertToLlm: messages => {
        if (projections++ > 0) throw new Error('projection failed');
        return messages;
      },
      onContextOverflow: async () => [createUserMessage('summary')],
    });
    expect(f.transport.complete).toHaveBeenCalledTimes(1);
    expect(assistantEnd(events)).toMatchObject({ message: { stopReason: 'error', errorMessage: f.overflow.message } });
  });

  it('does not retry when recovery expands the effective request', async () => {
    const f = fixture();
    const events = await f.run({ onContextOverflow: async messages => [createUserMessage('more context '.repeat(1000)), ...messages] });
    expect(f.transport.complete).toHaveBeenCalledTimes(1);
    expect(assistantEnd(events)).toMatchObject({ message: { stopReason: 'error', errorMessage: f.overflow.message } });
  });

  it('does not invoke compaction for unrelated provider failures', async () => {
    const f = fixture();
    f.transport.complete.mockReset().mockRejectedValueOnce(new Error('provider authentication failed'));
    const recovery = vi.fn(async () => [createUserMessage('summary')]);
    const events = await f.run({ onContextOverflow: recovery });
    expect(recovery).not.toHaveBeenCalled();
    expect(f.transport.complete).toHaveBeenCalledTimes(1);
    expect(assistantEnd(events)).toMatchObject({ message: { stopReason: 'error', errorMessage: 'provider authentication failed' } });
  });
});
