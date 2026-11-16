import {
  createHarness,
  createRunId,
  createRunScopedIdFactory,
  ENGAGEMENT_EVENT_MIGRATIONS_TABLE,
  ENGAGEMENT_EVENTS_TABLE,
  isLegacyCounterId,
  migrateEngagementEventIds,
  planEngagementIdMigration,
  type EngagementEventRow,
  type EngagementMigrationDatabase,
} from '../src/index.js';

function row(engagementId: string, seq: number, at: number, type: string, data: Record<string, unknown> = {}): EngagementEventRow {
  return { id: `${engagementId}:${seq}`, engagement_id: engagementId, seq, at, type, data: JSON.stringify(data) };
}

/** Rows of two restarts that both counted `m1` (engagement) / `m2` (root mail) / `g1` (grant). */
function duplicatedRows(): EngagementEventRow[] {
  return [
    row('m1', 0, 1_000, 'engagement_opened', { rootMailId: 'm2', rootGrantId: 'g1', entry: 'zhin', initiator: { kind: 'human', id: 'alice', trust: 'master' } }),
    row('m1', 1, 1_010, 'mail_admitted', { mailId: 'm2', grantId: 'g1', from: 'human:alice', to: 'zhin', kind: 'human', causationId: null }),
    row('m1', 2, 1_020, 'mail_admitted', { mailId: 'm3', grantId: 'g2', from: 'zhin', to: 'planner', kind: 'ask', causationId: 'm2' }),
    row('m1', 3, 1_030, 'budget_granted', { grantId: 'g2', parentId: 'g1' }),
    row('m1', 4, 1_040, 'turn_finished', { actor: 'planner', mails: ['m3'], status: 'completed' }),
    row('m1', 5, 1_050, 'engagement_closed', { status: 'completed' }),
    // restart: the counter starts again
    row('m1', 6, 9_000, 'engagement_opened', { rootMailId: 'm2', rootGrantId: 'g1', entry: 'zhin', initiator: { kind: 'human', id: 'bob', trust: 'master' } }),
    row('m1', 7, 9_010, 'mail_admitted', { mailId: 'm2', grantId: 'g1', from: 'human:bob', to: 'zhin', kind: 'human', causationId: null }),
    row('m1', 8, 9_020, 'board_written', { key: 'note', content: 'm2 stays text', actor: 'zhin' }),
    // a third run, still open
    row('m1', 9, 20_000, 'engagement_opened', { rootMailId: 'm2', rootGrantId: 'g1', entry: 'zhin' }),
    // a legacy id that holds one engagement only
    row('m4', 0, 1_100, 'engagement_opened', { rootMailId: 'm5', rootGrantId: 'g3', entry: 'zhin' }),
    row('m4', 1, 1_110, 'turn_finished', { actor: 'zhin', mails: ['m5'], status: 'completed', carriedBy: 'm1' }),
  ];
}

/** In-memory tables behind the transaction port; a throwing callback discards its writes. */
function memoryDatabase(initial: EngagementEventRow[]) {
  let tables: Record<string, Record<string, unknown>[]> = {
    [ENGAGEMENT_EVENTS_TABLE]: initial.map(r => ({ ...r })),
    [ENGAGEMENT_EVENT_MIGRATIONS_TABLE]: [],
  };
  /** Every condition the migration used on `engagement_events`, by statement kind. */
  const conditions: Array<{ readonly kind: 'select' | 'delete' | 'update'; readonly condition: Record<string, unknown> }> = [];
  let transactions = 0;
  const matches = (r: Record<string, unknown>, c: Record<string, unknown>) => Object.entries(c).every(([k, v]) =>
    v !== null && typeof v === 'object' && Array.isArray((v as { $in?: unknown }).$in) ? ((v as { $in: unknown[] }).$in).includes(r[k]) : r[k] === v);
  const database: EngagementMigrationDatabase = {
    async transaction(callback) {
      transactions++;
      const draft = structuredClone(tables);
      const note = (name: string, kind: 'select' | 'delete' | 'update', condition: Record<string, unknown>) => {
        if (name === ENGAGEMENT_EVENTS_TABLE) conditions.push({ kind, condition });
      };
      const result = await callback({
        model: (name: string) => ({
          select: (...fields: string[]) => ({
            where: async (c: Record<string, unknown>) => {
              note(name, 'select', c);
              return draft[name]!.filter(r => matches(r, c)).map(r => Object.fromEntries(fields.map(f => [f, r[f]])));
            },
          }),
          insert: async (r: Record<string, unknown>) => {
            if (draft[name]!.some(existing => existing.id === r.id)) throw Object.assign(new Error('duplicate'), { code: 'SQLITE_CONSTRAINT_PRIMARYKEY' });
            draft[name]!.push({ ...r });
          },
          update: (patch: Record<string, unknown>) => ({
            where: async (c: Record<string, unknown>) => {
              note(name, 'update', c);
              for (const r of draft[name]!) if (matches(r, c)) Object.assign(r, patch);
            },
          }),
          delete: () => ({
            where: async (c: Record<string, unknown>) => {
              note(name, 'delete', c);
              draft[name] = draft[name]!.filter(r => !matches(r, c));
            },
          }),
        }),
      });
      tables = draft;
      return result;
    },
  };
  return {
    database,
    rows: () => tables[ENGAGEMENT_EVENTS_TABLE] as unknown as EngagementEventRow[],
    markers: () => tables[ENGAGEMENT_EVENT_MIGRATIONS_TABLE]!,
    conditions: () => conditions,
    transactions: () => transactions,
  };
}

/** Three legacy ids reused by three runs, with `carriedBy` references between them. */
function threeReusedIds(): EngagementEventRow[] {
  const rows: EngagementEventRow[] = [];
  const seqOf = new Map<string, number>();
  const add = (id: string, at: number, type: string, data: Record<string, unknown> = {}) => {
    const seq = seqOf.get(id) ?? 0;
    seqOf.set(id, seq + 1);
    rows.push(row(id, seq, at, type, data));
  };
  for (const [run, base] of [[1, 1_000], [2, 50_000], [3, 90_000]] as const) {
    add('m1', base, 'engagement_opened', { rootMailId: 'm2', rootGrantId: 'g1', run });
    add('m3', base + 1, 'engagement_opened', { rootMailId: 'm4', rootGrantId: 'g2', run });
    add('m5', base + 2, 'engagement_opened', { rootMailId: 'm6', rootGrantId: 'g3', run });
    // a merged batch: m5's turn carried the mails of m1 and m3
    add('m1', base + 10, 'turn_finished', { mails: ['m2'], carriedBy: 'm5', status: 'completed' });
    add('m3', base + 11, 'turn_finished', { mails: ['m4'], carriedBy: 'm1', status: 'completed' });
    add('m5', base + 12, 'turn_finished', { mails: ['m6'], status: 'completed' });
  }
  rows.push(row('m7', 0, 50_005, 'engagement_opened', { rootMailId: 'm8' }));
  rows.push(row('m7', 1, 50_006, 'turn_finished', { mails: ['m8'], carriedBy: 'm3' }));
  return rows;
}

/** Fails the `n`th insert into `engagement_events` (a crash, a ready timeout, a lost connection). */
function failingAt(database: EngagementMigrationDatabase, n: number): EngagementMigrationDatabase {
  let inserts = 0;
  return {
    transaction: (callback) => database.transaction!(tx => callback({
      model: (name) => {
        const model = tx.model(name);
        return { ...model, insert: async (r) => { if (name === ENGAGEMENT_EVENTS_TABLE && ++inserts === n) throw new Error('disk gone'); return model.insert(r); } };
      },
    })),
  };
}

const sortById = (rows: readonly EngagementEventRow[]) => [...rows].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

describe('engagement ids (#1250 b35 engagement-id-reused-across-restarts)', () => {
  it('never repeats engagement, mail or grant ids across a simulated restart', () => {
    const first = createRunScopedIdFactory('m', createRunId(1_000));
    const second = createRunScopedIdFactory('m', createRunId(1_000)); // same start millisecond
    const a = [first(), first(), first()];
    const b = [second(), second(), second()];
    expect(new Set([...a, ...b]).size).toBe(6);
    for (const id of [...a, ...b]) {
      expect(id).toMatch(/^m-[0-9a-z]+-\d+$/);
      expect(id).not.toContain(':');
      expect(isLegacyCounterId(id, 'm')).toBe(false);
    }
    expect(isLegacyCounterId('m17', 'm')).toBe(true);
    expect(isLegacyCounterId('g3', 'g')).toBe(true);
  });

  it('default harness instances (one per process) open engagements with distinct ids', async () => {
    const opened: string[] = [];
    for (let run = 0; run < 2; run++) {
      const harness = createHarness({
        guard: { admitMail: () => ({ allow: true }) } as never,
        ledger: { openRoot: () => 'g', close: () => ({ ok: false }), snapshot: () => undefined } as never,
        journal: { append: async (event: { engagementId: string; type: string }) => { if (event.type === 'engagement_opened') opened.push(event.engagementId); return event; } } as never,
        createMailbox: () => ({ post: () => ({ accepted: false, code: 'mailbox_closed', message: 'closed' }), cancel: () => false, close: async () => undefined, idle: async () => undefined }) as never,
        ceilingOf: () => ({}) as never,
        rootAuthority: () => ({ tools: { kind: 'all' }, trust: 'master' }) as never,
        attenuate: (() => undefined) as never,
        runTurn: async () => ({ status: 'completed' }) as never,
      } as never);
      await harness.deliver({ entry: 'zhin', principal: { kind: 'human', id: 'a', trust: 'master' }, budget: {}, body: { kind: 'human', text: 'hi' } } as never).catch(() => undefined);
    }
    expect(opened).toHaveLength(2);
    expect(opened[0]).not.toBe(opened[1]);
  });

  it('plans one engagement per engagement_opened and rewrites its mail and grant ids', () => {
    const plan = planEngagementIdMigration(duplicatedRows());
    expect(plan.splits).toHaveLength(1);
    const [split] = plan.splits;
    expect(split!.oldId).toBe('m1');
    expect(split!.newIds).toHaveLength(3);
    expect(new Set(split!.newIds).size).toBe(3);
    expect(plan.rows).toHaveLength(10);

    const parts = split!.newIds.map(id => plan.rows.filter(r => r.engagement_id === id));
    expect(parts.map(p => p.length)).toEqual([6, 3, 1]);
    for (const part of parts) {
      expect(part[0]!.type).toBe('engagement_opened');
      expect(part.map(r => r.seq)).toEqual(part.map((_, i) => i));
      expect(part.every(r => r.id === `${r.engagement_id}:${r.seq}`)).toBe(true);
    }
    const first = parts[0]!.map(r => JSON.parse(r.data));
    const token = /^m-(x[0-9a-z]+)-1$/.exec(split!.newIds[0]!)![1];
    expect(first[0]).toMatchObject({ rootMailId: `m-${token}-2`, rootGrantId: `g-${token}-1` });
    expect(first[2]).toMatchObject({ mailId: `m-${token}-3`, grantId: `g-${token}-2`, causationId: `m-${token}-2` });
    expect(first[3]).toMatchObject({ grantId: `g-${token}-2`, parentId: `g-${token}-1` });
    expect(first[4]).toMatchObject({ mails: [`m-${token}-3`] });
    const second = parts[1]!.map(r => JSON.parse(r.data));
    expect(second[1].mailId).not.toBe(first[1].mailId);
    expect(second[2]).toMatchObject({ content: 'm2 stays text' });
  });

  it('migrates a database with duplicated ids without losing rows, then is a no-op', async () => {
    const before = duplicatedRows();
    const db = memoryDatabase(before);
    const applied = await migrateEngagementEventIds(db.database, { now: () => 42 });
    expect(applied.status).toBe('applied');
    expect(applied.rows).toBe(before.length);
    const after = db.rows();
    expect(after).toHaveLength(before.length);
    expect(after.filter(r => r.engagement_id === 'm1')).toEqual([]);
    expect(new Set(after.filter(r => r.type === 'engagement_opened').map(r => r.engagement_id)).size).toBe(4);
    // single-engagement legacy id untouched, its carriedBy reference resolves to the part active then
    const m4 = after.filter(r => r.engagement_id === 'm4');
    expect(m4).toHaveLength(2);
    expect(JSON.parse(m4[1]!.data).carriedBy).toBe(applied.splits[0]!.newIds[0]);
    expect(db.markers()).toEqual([expect.objectContaining({ id: 1, version: 1, applied_at: 42 })]);

    const snapshot = structuredClone(after);
    await expect(migrateEngagementEventIds(db.database)).resolves.toMatchObject({ status: 'already_applied' });
    expect(db.rows()).toEqual(snapshot);
  });

  it('marks an already-unique database as migrated without touching rows', async () => {
    const rows = [row('m-abc-1', 0, 1, 'engagement_opened'), row('m-abc-1', 1, 2, 'engagement_closed'), row('m-def-1', 0, 3, 'engagement_opened')];
    const db = memoryDatabase(rows);
    await expect(migrateEngagementEventIds(db.database)).resolves.toMatchObject({ status: 'applied', splits: [] });
    expect(db.rows()).toEqual(rows);
    await expect(migrateEngagementEventIds(db.database)).resolves.toMatchObject({ status: 'already_applied' });
  });

  it('rolls back a failed batch: no legacy id is ever half split and no row is lost', async () => {
    const db = memoryDatabase(duplicatedRows());
    await expect(migrateEngagementEventIds(failingAt(db.database, 3))).rejects.toThrow('disk gone');
    expect(sortById(db.rows().filter(r => r.engagement_id === 'm1'))).toEqual(sortById(duplicatedRows().filter(r => r.engagement_id === 'm1')));
    expect(db.rows()).toHaveLength(duplicatedRows().length);
    expect(db.markers()).toEqual([]);
  });

  it('keeps the batches an interrupted run committed and resumes to the same result (#1250 b35 review)', async () => {
    const reference = memoryDatabase(threeReusedIds());
    await migrateEngagementEventIds(reference.database, { batchRows: 6, now: () => 1 });

    const db = memoryDatabase(threeReusedIds());
    // The first split batch (m1, 6 rows) commits; the second dies on its first insert.
    await expect(migrateEngagementEventIds(failingAt(db.database, 7), { batchRows: 6, now: () => 1 })).rejects.toThrow('disk gone');
    const partial = db.rows();
    expect(partial).toHaveLength(threeReusedIds().length);
    expect(partial.some(r => r.engagement_id === 'm1')).toBe(false);
    for (const legacy of ['m3', 'm5']) expect(partial.filter(r => r.engagement_id === legacy)).toHaveLength(6);
    expect(db.markers()).toEqual([]);

    await expect(migrateEngagementEventIds(db.database, { batchRows: 6, now: () => 1 })).resolves.toMatchObject({ status: 'applied' });
    expect(sortById(db.rows())).toEqual(sortById(reference.rows()));
    // carriedBy points at the part that was open then, also for ids split by the earlier run
    const after = db.rows();
    const ids = new Set(after.map(r => r.engagement_id));
    for (const r of after) {
      const carriedBy = JSON.parse(r.data).carriedBy as string | undefined;
      if (carriedBy !== undefined) expect(ids.has(carriedBy)).toBe(true);
    }
    expect(db.markers()).toEqual([expect.objectContaining({ id: 1, version: 1 })]);
  });

  it('addresses rows by primary key in bounded transactions, never by engagement_id (#1250 b35 review)', async () => {
    const rows = threeReusedIds();
    const db = memoryDatabase(rows);
    await migrateEngagementEventIds(db.database, { batchRows: 6 });
    const scans = db.conditions().filter(({ condition }) => 'engagement_id' in condition);
    expect(scans).toEqual([]);
    // read + reference batches + one batch per 6-row legacy id + marker
    expect(db.transactions()).toBeGreaterThan(3);
  });

  it('finishes without error when a concurrent runner split the ids after it planned', async () => {
    const reference = memoryDatabase(threeReusedIds());
    await migrateEngagementEventIds(reference.database, { batchRows: 6, now: () => 1 });

    const db = memoryDatabase(threeReusedIds());
    let calls = 0;
    const late: EngagementMigrationDatabase = {
      async transaction(callback) {
        // After this runner read and planned, the other one (the instance or `zhin trace`) runs to the end.
        if (++calls === 2) await migrateEngagementEventIds(db.database, { batchRows: 6, now: () => 1 });
        return db.database.transaction!(callback);
      },
    };
    await expect(migrateEngagementEventIds(late, { batchRows: 6, now: () => 1 })).resolves.toMatchObject({ status: 'applied' });
    expect(sortById(db.rows())).toEqual(sortById(reference.rows()));
  });

  it('a batch that loses the primary-key race to an identical batch is not an error', async () => {
    const reference = memoryDatabase(threeReusedIds());
    await migrateEngagementEventIds(reference.database, { batchRows: 6, now: () => 1 });

    const db = memoryDatabase(threeReusedIds());
    let raced = false;
    const racing: EngagementMigrationDatabase = {
      transaction: (callback) => db.database.transaction!(tx => callback({
        model: (name) => {
          const model = tx.model(name);
          return {
            ...model,
            insert: async (r) => {
              if (name === ENGAGEMENT_EVENTS_TABLE && !raced) {
                // The other runner commits the same rows between this batch's checks and its writes.
                raced = true;
                await migrateEngagementEventIds(db.database, { batchRows: 6, now: () => 1 });
                throw Object.assign(new Error('duplicate'), { code: 'SQLITE_CONSTRAINT_PRIMARYKEY' });
              }
              return model.insert(r);
            },
          };
        },
      })),
    };
    await expect(migrateEngagementEventIds(racing, { batchRows: 6, now: () => 1 })).resolves.toMatchObject({ status: 'applied' });
    expect(sortById(db.rows())).toEqual(sortById(reference.rows()));
  });

  it('stops between batches when aborted and leaves no partial id', async () => {
    const db = memoryDatabase(threeReusedIds());
    const controller = new AbortController();
    let inserts = 0;
    const aborting: EngagementMigrationDatabase = {
      transaction: (callback) => db.database.transaction!(tx => callback({
        model: (name) => {
          const model = tx.model(name);
          return { ...model, insert: async (r) => { if (name === ENGAGEMENT_EVENTS_TABLE && ++inserts === 6) controller.abort(); return model.insert(r); } };
        },
      })),
    };
    await expect(migrateEngagementEventIds(aborting, { batchRows: 6, signal: controller.signal })).rejects.toThrow();
    for (const legacy of ['m1', 'm3', 'm5']) expect([0, 6]).toContain(db.rows().filter(r => r.engagement_id === legacy).length);
    expect(db.rows()).toHaveLength(threeReusedIds().length);
    expect(db.markers()).toEqual([]);
  });

  it('reports unsupported for a database without transactions', async () => {
    await expect(migrateEngagementEventIds({})).resolves.toMatchObject({ status: 'unsupported' });
  });
});
