import { describe, expect, it, vi } from 'vitest';
import type { TurnEvent } from '../../src/event/turn-event.js';
import * as agentCoreRun from '../../src/core/agent-core-run.js';
import { AgentCore } from '../../src/core/agent-core.js';

describe('AgentCore.runText', () => {
  it('collects TurnEvent stream and returns final AgentLoopTurnResult', async () => {
    const events: TurnEvent[] = [];
    async function* mockRun(): AsyncGenerator<TurnEvent, agentCoreRun.AgentLoopTurnResult> {
      yield { type: 'chunk', text: 'hi', accumulated: 'hi' };
      yield {
        type: 'turn_end',
        output: [{ type: 'text', content: 'hi' }],
        usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      };
      return {
        reply: 'hi',
        path: 'chat',
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        toolCalls: [],
        iterations: 1,
        model: 'm1',
      };
    }

    const spy = vi.spyOn(agentCoreRun, 'runAgentLoopTextTurnRun').mockReturnValue(mockRun() as any);
    const emit = vi.fn(async () => {});
    const core = new AgentCore(
      { maxIterations: 5, timeout: 1000, toolExecution: 'tiered' },
      {
        provider: {} as any,
        toolExecutor: { executeAll: async () => [] },
        contextManager: {
          prepare: async (input) => ({ messages: input.messages }),
          append: async () => {},
        },
        eventBus: { emit },
      },
    );

    const input = { host: {} as any, commMessage: {} as any, sessionId: 's1', modelId: 'm1' } as any;
    const gen = core.runText(input);
    for await (const event of gen) {
      events.push(event);
    }

    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 's1', core }));
    expect(events.some((e) => e.type === 'chunk')).toBe(true);
    expect(events.some((e) => e.type === 'turn_end')).toBe(true);
    spy.mockRestore();
  });

  it('runTextTurn collector delegates to runText and emits lifecycle events', async () => {
    const emit = vi.fn(async () => {});
    const core = new AgentCore(
      { maxIterations: 5, timeout: 1000, toolExecution: 'tiered' },
      {
        provider: {} as any,
        toolExecutor: { executeAll: async () => [] },
        contextManager: {
          prepare: async (input) => ({ messages: input.messages }),
          append: async () => {},
        },
        eventBus: { emit },
      },
    );

    async function* mockRun(): AsyncGenerator<TurnEvent, agentCoreRun.AgentLoopTurnResult> {
      yield {
        type: 'turn_end',
        output: [],
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      };
      return {
        reply: 'ok',
        path: 'agent',
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        toolCalls: [],
        iterations: 1,
        model: 'm1',
      };
    }

    const spy = vi.spyOn(agentCoreRun, 'runAgentLoopTextTurnRun').mockReturnValue(mockRun() as any);
    const input = { host: {} as any, commMessage: {} as any, sessionId: 's1', modelId: 'm1' } as any;
    const result = await core.runTextTurn(input);
    expect(result.reply).toBe('ok');
    expect(emit).toHaveBeenCalledWith('agent.turn.start', expect.objectContaining({ sessionId: 's1' }));
    expect(emit).toHaveBeenCalledWith('agent.turn.end', expect.objectContaining({ path: 'agent' }));
    spy.mockRestore();
  });
});
