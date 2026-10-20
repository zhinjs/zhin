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

export type { CompactionContextHost, CompactionRuntimeOptions } from './compaction-runtime.js';
export { AgentCompactionRuntime } from './compaction-runtime.js';
export {
  SessionToldLedger,
  extractToldEntries,
  normalizeToldText,
  TOLD_LEDGER_HEADING,
} from './told-ledger.js';
export type { ToldEntry, ToldEntryKind, ToldLedgerOptions } from './told-ledger.js';

export type { ContextRepository } from '@zhin.js/ai';
