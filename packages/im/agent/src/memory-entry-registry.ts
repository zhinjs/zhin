/**
 * Global MemoryEntryRepository handle for builtin tools (L4 semantic memory).
 */
import type { MemoryEntryRepository } from '@zhin.js/ai';
import { createGenerationStore, type GenerationStoreContext, DisposeStack } from '@zhin.js/plugin-runtime';

const memoryRepoStore = createGenerationStore<MemoryEntryRepository>('zhin.agent.memory-entry-repository');

export function provideMemoryEntryRepository(context: GenerationStoreContext, repo: MemoryEntryRepository): void {
  memoryRepoStore.provide(context, repo);
}

let _ephemeralLifecycle: DisposeStack | null = null;

/**
 * Legacy setter — 内部通过一次性 lifecycle 桥接到 generation store。
 * 新代码应使用 provideMemoryEntryRepository。
 */
export function setMemoryEntryRepository(repo: MemoryEntryRepository | null): void {
  if (_ephemeralLifecycle) {
    void _ephemeralLifecycle.dispose();
    _ephemeralLifecycle = null;
  }
  if (repo) {
    _ephemeralLifecycle = new DisposeStack();
    memoryRepoStore.provide({ lifecycle: _ephemeralLifecycle }, repo);
  }
}

export function getMemoryEntryRepository(): MemoryEntryRepository | null {
  return memoryRepoStore.tryUse() ?? null;
}
