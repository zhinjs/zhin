/**
 * L4 semantic memory — memory_entries repository + tools.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryMemoryEntryRepository } from '@zhin.js/ai';
import { setMemoryEntryRepository } from '../src/memory-entry-registry.js';
import { createMemorySearchTool } from '../src/builtin/memory-search-tool.js';
import { createMemoryUpsertTool } from '../src/builtin/memory-upsert-tool.js';

describe('MemoryEntryRepository', () => {
  let repo: InMemoryMemoryEntryRepository;

  beforeEach(() => {
    repo = new InMemoryMemoryEntryRepository();
    setMemoryEntryRepository(repo);
  });

  it('upsert and search recalls facts by key/content', async () => {
    await repo.upsert({
      scope: 'global',
      key: 'capability:hard_orchestration_v1',
      content: 'shipped',
      tags: ['l4', 'orchestration'],
    });

    const hits = await repo.search({ query: 'hard_orchestration', limit: 5 });
    expect(hits).toHaveLength(1);
    expect(hits[0]?.content).toBe('shipped');
  });

  it('memory_upsert + memory_search tools round-trip', async () => {
    const upsert = createMemoryUpsertTool();
    const search = createMemorySearchTool();

    const writeResult = await upsert.execute({
      key: 'capability:hard_orchestration_v1',
      content: 'shipped',
      scope: 'global',
    });
    expect(String(writeResult)).toContain('已写入记忆');

    const readResult = await search.execute({ query: 'hard_orchestration_v1' });
    expect(String(readResult)).toContain('shipped');
  });
});
