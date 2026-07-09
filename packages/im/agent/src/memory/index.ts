/**
 * Memory System — Port + MemorySystem + compaction（契约见 contracts.ts）。
 */

export type {
  MemoryContext,
  MemoryStore,
  CompactionStrategy,
  MemorySystemConfig,
} from './contracts.js';

export { ContextRepositoryMemoryStore } from './context-repository-store.js';
export { AiCompactionStrategy } from './ai-compaction-strategy.js';
export {
  MemorySystem,
  createMemorySystemForHost,
  defaultMemorySystem,
} from './memory-system.js';

export type { CompactionRuntimeOptions } from './compaction-runtime.js';

export {
  getCompactionStateCount,
  evictCompactionStatesIfOverPressure,
  clearCompactionStates,
  touchCompactionState,
  transformContextWithCompaction,
  manualCompactSession,
} from './compaction-runtime.js';

export type {
  ContextRepository,
  ConversationMemory,
} from '@zhin.js/ai';
