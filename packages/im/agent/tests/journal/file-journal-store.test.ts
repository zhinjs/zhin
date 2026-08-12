import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { appendFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { AgentRunEvent } from '@zhin.js/ai/agent-stream';
import { FileJournalStore } from '../../src/journal/file-journal-store.js';

function event(sequence: number, sessionId = 'sess1', turnId = 'turn1'): AgentRunEvent {
  return {
    type: 'tool_call',
    version: 1,
    run: { sessionId, turnId },
    sequence,
    timestamp: sequence,
  } as AgentRunEvent;
}

describe('FileJournalStore', () => {
  let directory: string;

  beforeEach(() => {
    directory = join(tmpdir(), `journal-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  });
  afterEach(() => rm(directory, { recursive: true, force: true }));

  it('appends, filters replay, and lists run summaries', async () => {
    const store = new FileJournalStore(directory);
    await store.append(event(1), 0);
    await store.append(event(2), 1);
    await store.append(event(1, 'sess1', 'turn2'), 0);

    await expect(store.replay(event(1).run, 1)).resolves.toEqual([event(2)]);
    await expect(store.listRuns('sess1')).resolves.toMatchObject([
      { run: { turnId: 'turn1' }, eventCount: 2 },
      { run: { turnId: 'turn2' }, eventCount: 1 },
    ]);
  });

  it('keeps formerly ambiguous identities distinct', async () => {
    const store = new FileJournalStore(directory);
    await store.append(event(1, 'a_b', 'c'), 0);
    await store.append(event(1, 'a', 'b_c'), 0);
    await expect(store.replay({ sessionId: 'a_b', turnId: 'c' })).resolves.toHaveLength(1);
    await expect(store.replay({ sessionId: 'a', turnId: 'b_c' })).resolves.toHaveLength(1);
  });

  it('atomically rejects stale writers across store instances', async () => {
    const left = new FileJournalStore(directory);
    const right = new FileJournalStore(directory);
    const results = await Promise.allSettled([
      left.append(event(1), 0),
      right.append(event(1), 0),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual(['fulfilled', 'rejected']);
    await expect(left.replay(event(1).run)).resolves.toHaveLength(1);
  });

  it('fails closed on corrupt claimed event files', async () => {
    const store = new FileJournalStore(directory);
    await store.append(event(1), 0);
    const [session] = await readdir(directory);
    const [turn] = await readdir(join(directory, session!));
    const file = join(directory, session!, turn!, '0000000000000002.json');
    await appendFile(file, 'not-json', 'utf8');
    await expect(store.replay(event(1).run)).rejects.toThrow('Corrupt Agent Journal');
  });

  it('returns empty only for a missing run', async () => {
    const store = new FileJournalStore(directory);
    await expect(store.replay({ sessionId: 'missing', turnId: 'missing' })).resolves.toEqual([]);
    await expect(store.listRuns('missing')).resolves.toEqual([]);
  });
});
