/**
 * Global MemoryEntryRepository handle for builtin tools (L4 semantic memory).
 */
import type { MemoryEntryRepository } from '@zhin.js/ai';

let globalRepo: MemoryEntryRepository | null = null;

export function setMemoryEntryRepository(repo: MemoryEntryRepository | null): void {
  globalRepo = repo;
}

export function getMemoryEntryRepository(): MemoryEntryRepository | null {
  return globalRepo;
}
