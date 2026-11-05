import { createRequire } from 'node:module';
import { Registry, Sqlite } from '@zhin.js/database';
import { JournalFullError, type EngagementJournal, type JournalRetention } from '../src/contracts.js';
import {
  DatabaseEngagementJournal,
  InMemoryEngagementJournal,
  defineEngagementEventModel,
  type EngagementJournalDatabase,
} from '../src/journal.js';

const require = createRequire(import.meta.url);
let sqliteAvailable = false;
try {
  const { DatabaseSync } = require('node:sqlite');
  new DatabaseSync(':memory:').close();
  sqliteAvailable = true;
} catch {
  // node:sqlite missing: database suite is skipped.
}
Registry.register('sqlite', Sqlite);

const DAY = 24 * 60 * 60 * 1000;
const ev = (engagementId: string, at = 1000, data: Record<string, unknown> = {}) =>
  ({ engagementId, at, type: 'mail_admitted', data }) as const;

type Factory = (retention?: JournalRetention) => Promise<EngagementJournal>;

function behaviour(name: string, make: Factory, skip = false) {
  describe.skipIf(skip)(`EngagementJournal: ${name}`, () => {
    it('assigns contiguous seq from 0 per engagement', async () => {
      const j = await make();
      expect((await j.append(ev('a'))).seq).toBe(0);
      expect((await j.append(ev('a'))).seq).toBe(1);
      expect((await j.append(ev('b'))).seq).toBe(0);
      expect((await j.append(ev('a'))).seq).toBe(2);
    });

    it('serializes concurrent appends in call order', async () => {
      const j = await make();
      const results = await Promise.all(
        Array.from({ length: 20 }, (_, i) => j.append(ev('a', 1000, { i }))),
      );
      expect(results.map(r => r.seq)).toEqual(Array.from({ length: 20 }, (_, i) => i));
      const read = await j.read('a');
      expect(read.map(r => r.data.i)).toEqual(Array.from({ length: 20 }, (_, i) => i));
      const [x, y] = await Promise.all([j.append(ev('x')), j.append(ev('y'))]);
      expect([x.seq, y.seq]).toEqual([0, 0]);
    });

    it('stores deep-frozen copies', async () => {
      const j = await make();
      const data = { nested: { list: [1, 2] } };
      const stored = await j.append(ev('a', 1000, data));
      data.nested.list.push(3);
      (data.nested as Record<string, unknown>).extra = true;
      expect(Object.isFrozen(stored)).toBe(true);
      expect(Object.isFrozen(stored.data)).toBe(true);
      expect(Object.isFrozen(stored.data.nested)).toBe(true);
      const [read] = await j.read('a');
      expect(read.data).toEqual({ nested: { list: [1, 2] } });
      expect(Object.isFrozen(read)).toBe(true);
      expect(Object.isFrozen(await j.read('a'))).toBe(true);
    });

    it('rejects non-serializable data with TypeError', async () => {
      const j = await make();
      const cyclic: Record<string, unknown> = {};
      cyclic.self = cyclic;
      for (const data of [
        { f: () => 1 },
        { n: 10n },
        cyclic,
        { u: undefined },
        { n: Number.NaN },
        { d: new Date() },
        { s: Symbol('x') },
      ]) {
        await expect(j.append(ev('a', 1000, data as Record<string, unknown>))).rejects.toBeInstanceOf(TypeError);
      }
      // Rejected appends must not consume a seq.
      expect((await j.append(ev('a'))).seq).toBe(0);
    });

    it('rejects with journal_full at the per-engagement limit', async () => {
      const j = await make({ maxAgeMs: DAY, maxEventsPerEngagement: 3 });
      for (let i = 0; i < 3; i++) await j.append(ev('a'));
      const error = await j.append(ev('a')).catch(e => e);
      expect(error).toBeInstanceOf(JournalFullError);
      expect(error.code).toBe('journal_full');
      expect((await j.read('a')).length).toBe(3);
      expect((await j.append(ev('b'))).seq).toBe(0);
    });

    it('reads in seq order; unknown engagement is empty', async () => {
      const j = await make();
      for (let i = 0; i < 12; i++) await j.append(ev('a', 1000 + i, { i }));
      expect((await j.read('a')).map(e => e.seq)).toEqual(Array.from({ length: 12 }, (_, i) => i));
      expect(await j.read('nope')).toEqual([]);
    });

    it('prunes by last-event age and returns the count', async () => {
      const j = await make({ maxAgeMs: 100, maxEventsPerEngagement: 100 });
      await j.append(ev('old', 100));
      await j.append(ev('old', 150));
      await j.append(ev('mixed', 50));
      await j.append(ev('mixed', 950)); // old first event, recent last event
      await j.append(ev('fresh', 990));
      expect(await j.prune(1000)).toBe(1); // cutoff 900: only "old" (last at 150)
      expect(await j.read('old')).toEqual([]);
      expect((await j.read('mixed')).length).toBe(2);
      expect((await j.read('fresh')).length).toBe(1);
      expect(await j.prune(1000)).toBe(0);
      expect(await j.prune(2000)).toBe(2);
    });

    it('lists engagements ordered by latest activity descending with optional limit', async () => {
      const j = await make();
      await j.append(ev('e1', 100));
      await j.append(ev('e2', 200));
      await j.append(ev('e3', 150));
      await j.append(ev('e1', 300)); // e1 now has the latest event
      expect(await j.listEngagements()).toEqual(['e1', 'e2', 'e3']);
      expect(await j.listEngagements(2)).toEqual(['e1', 'e2']);
    });

    it('summarizes engagement collaboration graph, blackboard, budget, blocks, escalations and projections', async () => {
      const j = await make();
      expect(await j.summarize('missing')).toBeUndefined();

      await j.append({
        engagementId: 'eng-1',
        at: 100,
        type: 'engagement_opened',
        data: {
          initiator: { kind: 'human', id: 'u1', trust: 'master' },
          venue: { kind: 'group', id: 'g1' },
          entry: 'zhin',
        },
      });
      await j.append({
        engagementId: 'eng-1',
        at: 110,
        type: 'mail_sent',
        data: { mailId: 'm1', kind: 'human', from: 'human:u1', to: 'zhin' },
      });
      await j.append({
        engagementId: 'eng-1',
        at: 120,
        type: 'mail_delivered',
        data: { mailId: 'm1', actor: 'zhin' },
      });
      await j.append({
        engagementId: 'eng-1',
        at: 130,
        type: 'tool_called',
        data: { actor: 'zhin', tool: 'read_file' },
      });
      await j.append({
        engagementId: 'eng-1',
        at: 140,
        type: 'board_written',
        data: { actor: 'zhin', key: 'plan', kind: 'todo', content: 'step 1', status: 'in_progress', version: 1 },
      });
      await j.append({
        engagementId: 'eng-1',
        at: 150,
        type: 'venue_projected',
        data: { venue: { kind: 'group', id: 'g1' }, actor: 'zhin', mailId: 'm1', mode: 'visible' },
      });
      await j.append({
        engagementId: 'eng-1',
        at: 160,
        type: 'guard_blocked',
        data: { from: 'zhin', to: 'ops', reason: { code: 'contact_not_allowed', detail: 'no ops' } },
      });
      await j.append({
        engagementId: 'eng-1',
        at: 170,
        type: 'budget_charged',
        data: { usage: { modelCalls: 2, tokens: 500, wallMs: 120, sideEffects: 1 } },
      });
      await j.append({
        engagementId: 'eng-1',
        at: 180,
        type: 'mail_completed',
        data: { mailId: 'm1', actor: 'zhin', status: 'completed' },
      });
      await j.append({
        engagementId: 'eng-1',
        at: 200,
        type: 'engagement_closed',
        data: { status: 'completed' },
      });

      const summary = await j.summarize('eng-1');
      expect(summary).toMatchObject({
        engagementId: 'eng-1',
        initiator: { kind: 'human', id: 'u1', trust: 'master' },
        venue: { kind: 'group', id: 'g1' },
        startedAt: 100,
        endedAt: 200,
        status: 'completed',
        actors: ['zhin', 'ops'],
        mailCount: 1,
        toolCallCount: 1,
        boardEntries: [
          {
            key: 'plan',
            kind: 'todo',
            content: 'step 1',
            author: 'zhin',
            updatedAt: 140,
            version: 1,
            status: 'in_progress',
          },
        ],
        guardBlocks: [
          {
            from: 'zhin',
            to: 'ops',
            reason: { code: 'contact_not_allowed', detail: 'no ops' },
            at: 160,
          },
        ],
        projections: [
          {
            venue: { kind: 'group', id: 'g1' },
            actor: 'zhin',
            mailId: 'm1',
            mode: 'visible',
            at: 150,
          },
        ],
        consumed: { modelCalls: 2, tokens: 500, wallMs: 120, sideEffects: 1 },
        hops: [
          { mailId: 'm1', kind: 'human', from: 'human:u1', to: 'zhin', status: 'completed' },
        ],
      });
    });

    it('compacts intermediate events for completed engagements >20 records while keeping summarize lossless, and preserves blocked/escalated engagements intact', async () => {
      const j = await make();
      await j.append({ engagementId: 'c1', at: 10, type: 'engagement_opened', data: { entry: 'zhin' } });
      await j.append({
        engagementId: 'c1',
        at: 11,
        type: 'mail_sent',
        data: { mailId: 'm1', kind: 'ask', from: 'zhin', to: 'researcher' },
      });
      await j.append({ engagementId: 'c1', at: 12, type: 'mail_delivered', data: { mailId: 'm1', actor: 'researcher' } });
      for (let i = 0; i < 20; i++) {
        await j.append({
          engagementId: 'c1',
          at: 20 + i,
          type: 'budget_charged',
          data: { usage: { modelCalls: 1, tokens: 10, wallMs: 5, sideEffects: 0 } },
        });
      }
      await j.append({
        engagementId: 'c1',
        at: 50,
        type: 'board_written',
        data: { actor: 'researcher', key: 'finding', kind: 'artifact', content: 'result', version: 1 },
      });
      await j.append({
        engagementId: 'c1',
        at: 60,
        type: 'mail_completed',
        data: { mailId: 'm1', actor: 'researcher', status: 'completed' },
      });
      await j.append({
        engagementId: 'c1',
        at: 70,
        type: 'engagement_closed',
        data: { status: 'completed' },
      });

      const beforeSummary = await j.summarize('c1');
      const beforeCount = (await j.read('c1')).length;
      expect(beforeCount).toBeGreaterThan(20);

      await j.compact('c1');
      const afterRecords = await j.read('c1');
      expect(afterRecords.length).toBeLessThan(beforeCount);
      expect(afterRecords.map((r) => r.seq)).toEqual(Array.from({ length: afterRecords.length }, (_, i) => i));
      const afterSummary = await j.summarize('c1');
      expect(afterSummary).toEqual(beforeSummary);

      // Engagement with guard_blocked or escalated must NOT be compacted
      await j.append({ engagementId: 'c2', at: 10, type: 'engagement_opened', data: { entry: 'zhin' } });
      for (let i = 0; i < 22; i++) {
        await j.append({
          engagementId: 'c2',
          at: 20 + i,
          type: 'budget_charged',
          data: { usage: { modelCalls: 1, tokens: 10, wallMs: 5, sideEffects: 0 } },
        });
      }
      await j.append({
        engagementId: 'c2',
        at: 50,
        type: 'escalated',
        data: { by: 'zhin', reason: 'loop' },
      });
      await j.append({
        engagementId: 'c2',
        at: 60,
        type: 'engagement_closed',
        data: { status: 'escalated' },
      });
      const c2Before = (await j.read('c2')).length;
      await j.compact('c2');
      expect((await j.read('c2')).length).toBe(c2Before);
    });
  });
}

behaviour('in-memory', async retention => new InMemoryEngagementJournal({ retention }));

async function sqliteJournal(retention?: JournalRetention): Promise<EngagementJournal> {
  const db = Registry.create<Record<string, object>, 'sqlite'>('sqlite', { filename: ':memory:' });
  defineEngagementEventModel(db);
  await db.start();
  return new DatabaseEngagementJournal(db as unknown as EngagementJournalDatabase, { retention });
}

behaviour('database (sqlite)', sqliteJournal, !sqliteAvailable);

describe.skipIf(!sqliteAvailable)('DatabaseEngagementJournal cross-process safety', () => {
  it('retries on a unique-key conflict and takes the next seq', async () => {
    const db = Registry.create<Record<string, object>, 'sqlite'>('sqlite', { filename: ':memory:' });
    defineEngagementEventModel(db);
    await db.start();
    const raw = db as unknown as EngagementJournalDatabase;
    let injected = false;
    // Simulates another process inserting seq 0 between our read and our insert.
    const racing: EngagementJournalDatabase = {
      select: (t, f) => raw.select(t, f),
      delete: (t, c) => raw.delete(t, c),
      insert: async (t, row) => {
        if (!injected) {
          injected = true;
          await raw.insert(t, { ...row, type: 'engagement_opened' });
        }
        return raw.insert(t, row);
      },
    };
    const j = new DatabaseEngagementJournal(racing);
    const stored = await j.append(ev('a'));
    expect(stored.seq).toBe(1);
    const read = await j.read('a');
    expect(read.map(e => [e.seq, e.type])).toEqual([[0, 'engagement_opened'], [1, 'mail_admitted']]);
  });

  it('gives up after bounded retries and rethrows non-conflict errors', async () => {
    const failing: EngagementJournalDatabase = {
      select: () => ({ where: async () => [] }),
      delete: async () => undefined,
      insert: async () => {
        throw new Error('disk gone');
      },
    };
    await expect(new DatabaseEngagementJournal(failing).append(ev('a'))).rejects.toThrow('disk gone');
  });
});
