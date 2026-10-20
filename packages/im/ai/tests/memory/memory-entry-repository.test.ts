import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Registry } from '@zhin.js/database';
import {
  MEMORY_ENTRY_ADDED_COLUMNS,
  MEMORY_ENTRY_HISTORY_LIMIT,
  MEMORY_ENTRY_MODEL,
  parseMemoryHistory,
  renderMemoryEntriesMarkdown,
} from '../../src/memory/memory-entry-models.js';
import {
  DatabaseMemoryEntryRepository,
  ensureMemoryEntryColumns,
  InMemoryMemoryEntryRepository,
} from '../../src/memory/memory-entry-repository.js';

type Schema = { memory_entries: Record<string, unknown> };

const LEGACY_MODEL = Object.fromEntries(
  Object.entries(MEMORY_ENTRY_MODEL).filter(([column]) => !(column in MEMORY_ENTRY_ADDED_COLUMNS)),
);

describe('memory entry repository', () => {
  let dir: string | undefined;
  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it('migrates a pre-#733 sqlite table without losing rows', async () => {
    dir = await mkdtemp(join(tmpdir(), 'zhin-memory-'));
    const filename = join(dir, 'memory.db');

    const legacy = Registry.create<Schema, 'sqlite'>('sqlite', { filename });
    legacy.define('memory_entries', LEGACY_MODEL as never);
    await legacy.start();
    await legacy.models.get('memory_entries')!.create({
      id: 'legacy-1', scope: 'global', scope_key: '', key: 'owner:city', content: 'Manila',
      tags: '["home"]', source: 'tool:memory_upsert', confidence: 0.9, created_at: 10, updated_at: 20, expires_at: null,
    });
    await legacy.stop();

    const db = Registry.create<Schema, 'sqlite'>('sqlite', { filename });
    db.define('memory_entries', MEMORY_ENTRY_MODEL as never);
    await db.start();
    const model = db.models.get('memory_entries')! as never;
    const added = await ensureMemoryEntryColumns(db as never, model);
    expect(added.sort()).toEqual(Object.keys(MEMORY_ENTRY_ADDED_COLUMNS).sort());
    expect(await ensureMemoryEntryColumns(db as never, model)).toEqual([]);

    const repository = new DatabaseMemoryEntryRepository(model);
    const migrated = await repository.get('legacy-1');
    expect(migrated).toMatchObject({
      key: 'owner:city', content: 'Manila', tags: '["home"]', source: 'tool:memory_upsert',
      confidence: 0.9, created_at: 10, updated_at: 20, expires_at: null,
      kind: 'user_fact', trust_level: '', task_id: '', last_used_at: null, history: '[]',
    });
    expect(await repository.search({ query: 'Manila' })).toHaveLength(1);

    const updated = await repository.upsert({
      scope: 'global', key: 'owner:city', content: 'Cebu', trust_level: 'owner', source_turn: 't2',
    });
    expect(updated.content).toBe('Cebu');
    expect(parseMemoryHistory(updated.history)[0]).toMatchObject({ content: 'Manila', source: 'tool:memory_upsert' });
    expect((await repository.get('legacy-1'))?.trust_level).toBe('owner');

    await repository.delete('legacy-1');
    expect(await repository.search({ query: 'Cebu' })).toEqual([]);
    expect(await repository.list({ scope: 'global' })).toEqual([]);
    expect(await repository.find({ scope: 'global', key: 'owner:city' })).toBeNull();
    await db.stop();
  });

  it('keeps a bounded history, newest first, only when content changes', async () => {
    const repository = new InMemoryMemoryEntryRepository();
    for (let index = 0; index <= MEMORY_ENTRY_HISTORY_LIMIT + 1; index += 1) {
      await repository.upsert({ scope: 'user', scope_key: 'u1', key: 'drink', content: `v${index}` });
    }
    const same = await repository.upsert({ scope: 'user', scope_key: 'u1', key: 'drink', content: `v${MEMORY_ENTRY_HISTORY_LIMIT + 1}` });
    const history = parseMemoryHistory(same.history);
    expect(history).toHaveLength(MEMORY_ENTRY_HISTORY_LIMIT);
    expect(history[0]!.content).toBe(`v${MEMORY_ENTRY_HISTORY_LIMIT}`);
  });

  it('hides expired entries from find and search, and records recall', async () => {
    const repository = new InMemoryMemoryEntryRepository();
    const expired = await repository.upsert({
      scope: 'session', scope_key: 's1', key: 'task', content: 'deploy pending', kind: 'task_state', expires_at: Date.now() - 1,
    });
    const live = await repository.upsert({ scope: 'session', scope_key: 's1', key: 'note', content: 'deploy done' });
    expect(await repository.find({ scope: 'session', scope_key: 's1', key: 'task' })).toBeNull();
    expect((await repository.search({ query: 'deploy' })).map((entry) => entry.id)).toEqual([live.id]);

    await repository.markUsed([live.id], 1234);
    expect((await repository.get(live.id))?.last_used_at).toBe(1234);
    expect((await repository.get(expired.id))?.last_used_at).toBeNull();
  });

  it('renders a readable Markdown export', async () => {
    const repository = new InMemoryMemoryEntryRepository();
    const record = await repository.upsert({ scope: 'user', scope_key: 'u1', key: 'drink', content: 'tea', kind: 'preference', tags: ['food'] });
    expect(renderMemoryEntriesMarkdown([record])).toContain('- **drink** (preference, user:u1): tea — tags: food');
  });
});
