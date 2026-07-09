/**
 * 压缩策略 — 委托 @zhin.js/ai autoCompactAgentMessagesIfNeeded（禁止双实现）。
 */
import {
  autoCompactAgentMessagesIfNeeded,
  createAgentCompactionState,
  estimateAgentMessagesTokens,
  type AgentCompactionConfig,
  type Model,
} from '@zhin.js/ai';
import type { CompactionStrategy, MemoryContext } from './contracts.js';

export class AiCompactionStrategy implements CompactionStrategy {
  private readonly state = createAgentCompactionState();

  constructor(
    private readonly model: Model,
    private readonly config: AgentCompactionConfig,
  ) {}

  shouldCompact(context: MemoryContext): boolean {
    const tokenCount = estimateAgentMessagesTokens(context.messages);
    return tokenCount > context.contextWindow * 0.6;
  }

  async compact(context: MemoryContext): Promise<MemoryContext> {
    const result = await autoCompactAgentMessagesIfNeeded({
      model: this.model,
      messages: context.messages,
      config: this.config,
      state: this.state,
      force: true,
    });
    return {
      messages: result.messages,
      contextWindow: context.contextWindow,
    };
  }
}
