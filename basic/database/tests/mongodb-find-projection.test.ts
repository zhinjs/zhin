import { describe, expect, it } from 'vitest';
import { MongoDBDialect } from '../src/dialects/mongodb.js';

/**
 * A stand-in for the driver's FindCursor: chainable `sort` / `skip` / `limit` / `project`, and no
 * `projection` method. Like the real driver, an inclusion projection keeps `_id`.
 */
function fakeDb(rows: Record<string, unknown>[]) {
  const calls: Array<[string, unknown]> = [];
  const cursor = {
    sort(value: unknown) { calls.push(['sort', value]); return cursor; },
    skip(value: unknown) { calls.push(['skip', value]); return cursor; },
    limit(value: unknown) { calls.push(['limit', value]); return cursor; },
    project(value: Record<string, number>) {
      calls.push(['project', value]);
      const keep = new Set(['_id', ...Object.keys(value)]);
      rows = rows.map(row => Object.fromEntries(Object.entries(row).filter(([key]) => keep.has(key))));
      return cursor;
    },
    async toArray() { return rows; },
  };
  const db = { collection: () => ({ find: (filter: unknown) => { calls.push(['find', filter]); return cursor; } }) };
  return { db, calls };
}

function dialectWith(rows: Record<string, unknown>[]) {
  const dialect = new MongoDBDialect({ url: 'mongodb://localhost:27017', dbName: 'unit' } as never);
  const fake = fakeDb(rows);
  (dialect as unknown as { db: unknown }).db = fake.db;
  return { dialect, calls: fake.calls };
}

describe('MongoDB find with selected fields', () => {
  it('a select with fields projects through the driver cursor (project, not projection)', async () => {
    const { dialect, calls } = dialectWith([{ _id: 'x', id: 'role-owner', name: 'owner' }]);
    const { query } = dialect.buildQuery({ type: 'select', tableName: 'console_roles', fields: ['id'], conditions: { id: 'role-owner' } } as never);
    expect(query.projection).toEqual({ id: 1 });
    // Inclusion projection: the driver also returns `_id`.
    expect(await dialect.query(query)).toEqual([{ _id: 'x', id: 'role-owner' }]);
    expect(calls).toContainEqual(['project', { id: 1 }]);
  });

  it('a select without fields does not project', async () => {
    const { dialect, calls } = dialectWith([{ id: 'a', name: 'b' }]);
    const { query } = dialect.buildQuery({ type: 'select', tableName: 'notes' } as never);
    expect(query.projection).toBeUndefined();
    expect(await dialect.query(query)).toEqual([{ id: 'a', name: 'b' }]);
    expect(await dialect.query({ ...query, projection: {} })).toEqual([{ id: 'a', name: 'b' }]);
    expect(calls.some(([name]) => name === 'project')).toBe(false);
  });
});
