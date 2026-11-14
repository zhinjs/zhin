import { describe, expect, it } from 'vitest';
import { MongoDBDialect } from '../src/dialects/mongodb.js';

/** A stand-in for the driver's FindCursor: chainable `sort` / `skip` / `limit` / `project`, no `projection`. */
function fakeDb(rows: Record<string, unknown>[]) {
  const calls: Array<[string, unknown]> = [];
  const cursor = {
    sort(value: unknown) { calls.push(['sort', value]); return cursor; },
    skip(value: unknown) { calls.push(['skip', value]); return cursor; },
    limit(value: unknown) { calls.push(['limit', value]); return cursor; },
    project(value: Record<string, number>) {
      calls.push(['project', value]);
      const keep = Object.keys(value);
      rows = rows.map(row => Object.fromEntries(Object.entries(row).filter(([key]) => keep.includes(key))));
      return cursor;
    },
    async toArray() { return rows; },
  };
  const db = { collection: () => ({ find: (filter: unknown) => { calls.push(['find', filter]); return cursor; } }) };
  return { db, calls };
}

describe('MongoDB find with selected fields', () => {
  it('projects through the driver cursor (project, not projection)', async () => {
    const dialect = new MongoDBDialect({ url: 'mongodb://localhost:27017', dbName: 'unit' } as never);
    const { db, calls } = fakeDb([{ _id: 'x', id: 'role-owner', name: 'owner' }]);
    (dialect as unknown as { db: unknown }).db = db;
    const rows = await dialect.query({ collection: 'console_roles', operation: 'find', filter: { id: 'role-owner' }, projection: { id: 1 } } as never);
    expect(rows).toEqual([{ id: 'role-owner' }]);
    expect(calls).toContainEqual(['project', { id: 1 }]);
  });

  it('leaves the cursor unprojected when no fields are selected', async () => {
    const dialect = new MongoDBDialect({ url: 'mongodb://localhost:27017', dbName: 'unit' } as never);
    const { db, calls } = fakeDb([{ id: 'a', name: 'b' }]);
    (dialect as unknown as { db: unknown }).db = db;
    expect(await dialect.query({ collection: 'notes', operation: 'find', filter: {}, projection: {} } as never)).toEqual([{ id: 'a', name: 'b' }]);
    expect(calls.some(([name]) => name === 'project')).toBe(false);
  });
});
