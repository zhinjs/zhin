/**
 * MemoryStore Port — 适配 ContextRepository，不重复实现持久化。
 */
import type { ContextRepository } from '@zhin.js/ai';
import type { MemoryContext, MemoryStore } from './contracts.js';

export class ContextRepositoryMemoryStore implements MemoryStore {
  constructor(
    private readonly repository: ContextRepository,
    private readonly defaultContextWindow: number,
  ) {}

  async load(sessionId: string): Promise<MemoryContext> {
    const loaded = await this.repository.loadContext(sessionId);
    return {
      messages: loaded.messages,
      contextWindow: this.defaultContextWindow,
    };
  }

  async save(_sessionId: string, _context: MemoryContext): Promise<void> {
    // Port：消息追加/压缩由 ContextRepository.appendMessages 与 compaction-runtime 负责。
  }

  async compact(_sessionId: string): Promise<void> {
    // Port：手动/自动压缩经 MemorySystem.compactSessionForCommMessage → manualCompactSession。
  }
}
