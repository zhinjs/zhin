import { describe, expect, it, vi } from 'vitest';
import { AgentCore } from '../../src/core/agent-core.js';
import * as agentCoreRun from '../../src/core/agent-core-run.js';
import type { TurnEvent } from '../../src/event/turn-event.js';

describe('AgentCore', () => {
  it('runTextTurn collects generator and emits lifecycle events', async () => {
    const emit = vi.fn(async () => {});

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
    const result = await core.runTextTurn(input);
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 's1', core }));
    expect(result.reply).toBe('ok');
    expect(emit).toHaveBeenCalledWith('agent.turn.start', expect.objectContaining({ sessionId: 's1' }));
    expect(emit).toHaveBeenCalledWith('agent.turn.end', expect.objectContaining({ path: 'agent' }));
    spy.mockRestore();
  });
});
