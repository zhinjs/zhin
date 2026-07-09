/**
 * Memory System — 模块契约（与实现同步）。
 *
 * 实现：`registerStore` / `registerContextRepository` Port 适配 `ContextRepository`；
 * 压缩委托 `@zhin.js/ai` compaction（`AiCompactionStrategy`），禁止双实现。
 */

import type { AgentMessage } from '@zhin.js/ai';

export interface MemoryContext {
  messages: AgentMessage[];
  contextWindow: number;
}

export interface MemoryStore {
  load(sessionId: string): Promise<MemoryContext>;
  save(sessionId: string, context: MemoryContext): Promise<void>;
  compact(sessionId: string): Promise<void>;
}

export interface CompactionStrategy {
  shouldCompact(context: MemoryContext): boolean;
  compact(context: MemoryContext): Promise<MemoryContext>;
}

export interface MemorySystemConfig {
  compactionStrategy: CompactionStrategy;
}
