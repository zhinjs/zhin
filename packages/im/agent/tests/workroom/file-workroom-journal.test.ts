import { mkdtemp, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  FileWorkroomJournal,
  MemoryWorkroomJournalPayloadPort,
} from '../../src/workroom/journal.js';

describe('FileWorkroomJournal durability boundary', () => {
  it('requires a pre-existing durable parent instead of recursively inventing state roots', async () => {
    const root = await mkdtemp(join(tmpdir(), 'zhin-workroom-journal-parent-'));
    const directory = join(root, 'missing-parent', 'journal');
    try {
      const journal = new FileWorkroomJournal(directory, new MemoryWorkroomJournalPayloadPort());
      await expect(journal.append('run', -1, [created()]))
        .rejects.toThrow('pre-existing durable parent');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('binds each immutable segment filename to its first persisted sequence', async () => {
    const root = await mkdtemp(join(tmpdir(), 'zhin-workroom-journal-segment-'));
    const directory = join(root, 'journal');
    await mkdir(directory);
    try {
      const payloads = new MemoryWorkroomJournalPayloadPort();
      const journal = new FileWorkroomJournal(directory, payloads);
      await journal.append('run', -1, [created()]);
      const [name] = (await readdir(directory)).filter(value => value.endsWith('.json'));
      expect(name).toBeDefined();
      const corrupted = name!.replace('.0000000000000000.json', '.0000000000000001.json');
      await rename(join(directory, name!), join(directory, corrupted));

      await expect(new FileWorkroomJournal(directory, payloads).read('run'))
        .rejects.toThrow('first sequence');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('detects a reserialized valid-looking payload drift through the segment digest', async () => {
    const root = await mkdtemp(join(tmpdir(), 'zhin-workroom-journal-digest-'));
    const directory = join(root, 'journal');
    await mkdir(directory);
    try {
      const payloads = new MemoryWorkroomJournalPayloadPort();
      const journal = new FileWorkroomJournal(directory, payloads);
      await journal.append('run', -1, [created()]);
      const [name] = (await readdir(directory)).filter(value => value.endsWith('.json'));
      const path = join(directory, name!);
      const stored = JSON.parse(await readFile(path, 'utf8')) as
        | Array<{ payload: { title: { contentHash: string } } }>
        | { events: Array<{ payload: { title: { contentHash: string } } }> };
      const events = Array.isArray(stored) ? stored : stored.events;
      events[0]!.payload.title.contentHash = `sha256:${'f'.repeat(64)}`;
      await writeFile(path, JSON.stringify(stored), 'utf8');

      await expect(new FileWorkroomJournal(directory, payloads).read('run'))
        .rejects.toThrow('digest');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

function created() {
  return Object.freeze({
    eventId: 'run-created',
    occurredAt: 100,
    type: 'run.created' as const,
    payload: Object.freeze({ projectId: 'project', title: 'Run' }),
  });
}
