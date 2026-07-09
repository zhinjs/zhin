/**
 * Agent Core — 薄适配器，委托 agent-core-run AsyncGenerator（ADR 0009）。
 */

import type { TurnEvent } from '../event/turn-event.js';
import type { AgentCoreConfig, AgentCoreDependencies } from './contracts.js';
import {
  runAgentLoopTextTurnRun,
  runAgentLoopVisionTurnRun,
  collectAgentLoopTurnRun,
  type AgentLoopTurnInput,
  type AgentLoopTurnResult,
  type AgentLoopVisionTurnInput,
  type AgentLoopVisionTurnResult,
} from './agent-core-run.js';

export class AgentCore {
  constructor(
    readonly config: AgentCoreConfig,
    readonly deps: AgentCoreDependencies,
  ) {}

  runText(input: AgentLoopTurnInput): AsyncGenerator<TurnEvent, AgentLoopTurnResult> {
    return runAgentLoopTextTurnRun({ ...input, core: this });
  }

  runVision(input: AgentLoopVisionTurnInput): AsyncGenerator<TurnEvent, AgentLoopVisionTurnResult> {
    return runAgentLoopVisionTurnRun({ ...input, core: this });
  }

  /** Collector over `runText()` AsyncGenerator. */
  async runTextTurn(input: AgentLoopTurnInput): Promise<AgentLoopTurnResult> {
    const { eventBus } = this.deps;
    await eventBus.emit('agent.turn.start', {
      sessionId: input.sessionId,
      mode: 'text',
      modelId: input.modelId,
    });
    try {
      const result = await collectAgentLoopTurnRun(this.runText(input));
      await eventBus.emit('agent.turn.end', {
        sessionId: input.sessionId,
        mode: 'text',
        path: result.path,
        iterations: result.iterations,
      });
      return result;
    } catch (error) {
      await eventBus.emit('agent.turn.error', {
        sessionId: input.sessionId,
        mode: 'text',
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  async runVisionTurn(input: AgentLoopVisionTurnInput): Promise<AgentLoopVisionTurnResult> {
    const { eventBus } = this.deps;
    await eventBus.emit('agent.turn.start', {
      sessionId: input.sessionId,
      mode: 'vision',
    });
    try {
      const result = await collectAgentLoopTurnRun(this.runVision(input));
      await eventBus.emit('agent.turn.end', {
        sessionId: input.sessionId,
        mode: 'vision',
        path: result.path,
        iterations: result.iterations,
      });
      return result;
    } catch (error) {
      await eventBus.emit('agent.turn.error', {
        sessionId: input.sessionId,
        mode: 'vision',
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
}

export const defaultAgentCore = new AgentCore(
  {
    maxIterations: 15,
    timeout: 120_000,
    toolExecution: 'tiered',
  },
  {
    provider: {} as AgentCoreDependencies['provider'],
    toolExecutor: { executeAll: async () => [] },
    contextManager: {
      prepare: async (input) => ({ messages: input.messages }),
      append: async () => {},
    },
    eventBus: { emit: async () => {} },
  },
);
