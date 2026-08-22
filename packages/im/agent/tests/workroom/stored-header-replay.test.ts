import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ActivatableWorkroomJournal,
  DatabaseWorkroomJournal,
  FileWorkroomJournal,
  MemoryWorkroomJournal,
  MemoryWorkroomJournalPayloadPort,
  type WorkroomJournalPayloadReadInput,
} from '../../src/workroom/journal.js';
import { WorkroomKernel } from '../../src/workroom/workroom-kernel.js';

class ReadSpyPayloads extends MemoryWorkroomJournalPayloadPort {
  readCount = 0;

  override async read(input: WorkroomJournalPayloadReadInput): Promise<unknown> {
    this.readCount += 1;
    return await super.read(input);
  }
}

describe('content-free stored Workroom Journal header replay', () => {
  it('scans multiple Memory runs without materializing a governed payload', async () => {
    const payloads = new ReadSpyPayloads();
    const journal = new MemoryWorkroomJournal(payloads);
    await seedRun(journal, 'support', 'run-support', 'private support customer title');
    await seedRun(journal, 'content', 'run-content', 'unpublished editorial title');
    payloads.readCount = 0;

    const runs = await journal.scanStoredHeaders();
    expect(runs.map(run => run.runId)).toEqual(['run-content', 'run-support']);
    expect(runs.flatMap(run => run.events).map(event => event.type)).toContain('task.planned');
    expect(JSON.stringify(runs)).not.toContain('private support customer title');
    expect(JSON.stringify(runs)).not.toContain('unpublished editorial title');
    expect(JSON.stringify(runs)).not.toContain('task-1');
    expect(payloads.readCount).toBe(0);

    const latch = new ActivatableWorkroomJournal();
    latch.activate(journal);
    await expect(latch.readStoredHeaders('run-support')).resolves.toMatchObject({
      runId: 'run-support', events: [{ type: 'run.created' }, { type: 'task.planned' }],
    });
    expect(payloads.readCount).toBe(0);
  });

  it('replays File headers after restart with zero decrypt and fails closed on corruption', async () => {
    const root = await mkdtemp(join(tmpdir(), 'zhin-stored-headers-file-'));
    const directory = join(root, 'journal');
    await mkdir(directory);
    const payloads = new ReadSpyPayloads();
    try {
      await seedRun(new FileWorkroomJournal(directory, payloads),
        'support', 'run-file', 'private file title');
      payloads.readCount = 0;
      const restarted = new FileWorkroomJournal(directory, payloads);
      await expect(restarted.readStoredHeaders('run-file')).resolves.toMatchObject({
        runId: 'run-file', events: [{ type: 'run.created' }, { type: 'task.planned' }],
      });
      expect(payloads.readCount).toBe(0);

      const names = (await readdir(directory)).filter(name => name.endsWith('.json')).sort();
      const path = join(directory, names[0]!);
      const parsed = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>;
      await writeFile(path, JSON.stringify({ ...parsed, payloadDigest: `sha256:${'f'.repeat(64)}` }));
      await expect(new FileWorkroomJournal(directory, payloads).scanStoredHeaders())
        .rejects.toThrow('payload digest mismatch');
      expect(payloads.readCount).toBe(0);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('replays Database headers after restart with zero decrypt and rejects corrupt rows', async () => {
    const rows: Record<string, unknown>[] = [];
    const where = async (condition: Record<string, unknown>) => {
      const runId = condition.run_id;
      return runId === undefined ? [...rows] : rows.filter(row => row.run_id === runId);
    };
    const database = {
      transaction: async <T>(operation: (transaction: {
        select(table: string): { where(condition: Record<string, unknown>): Promise<Record<string, unknown>[]> };
        insertMany(table: string, inserted: Record<string, unknown>[]): Promise<void>;
      }) => Promise<T>) => await operation({
        select: () => ({ where }),
        insertMany: async (_table: string, inserted: Record<string, unknown>[]) => {
          rows.push(...inserted);
        },
      }),
    };
    const model = { select: () => ({ where }) };
    const payloads = new ReadSpyPayloads();
    await seedRun(new DatabaseWorkroomJournal(database, model, payloads),
      'support', 'run-db', 'private database title');
    payloads.readCount = 0;
    const restarted = new DatabaseWorkroomJournal(database, model, payloads);
    await expect(restarted.scanStoredHeaders()).resolves.toMatchObject([{
      runId: 'run-db', events: [{ type: 'run.created' }, { type: 'task.planned' }],
    }]);
    expect(payloads.readCount).toBe(0);

    rows[0] = { ...rows[0], payload_json: '{"eventId":' };
    await expect(new DatabaseWorkroomJournal(database, model, payloads).scanStoredHeaders())
      .rejects.toThrow();
    expect(payloads.readCount).toBe(0);
  });
});

async function seedRun(
  journal: MemoryWorkroomJournal | FileWorkroomJournal | DatabaseWorkroomJournal,
  projectId: string,
  runId: string,
  title: string,
): Promise<void> {
  let id = 0;
  const kernel = new WorkroomKernel({ journal, now: () => 100, createId: () => `${runId}:${++id}` });
  await kernel.createRun({ projectId, runId, title });
  await kernel.execute(projectId, runId, {
    type: 'plan_task', taskKey: 'task-1', title: `${title}: task`, required: true, maxAttempts: 2,
  });
}
