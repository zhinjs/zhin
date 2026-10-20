import assert from 'node:assert/strict';
import { Registry } from '../../basic/database/lib/index.js';

const [phase, filename] = process.argv.slice(2);
assert.ok(filename && ['write', 'restart', 'lock-check'].includes(phase));
const db = Registry.create('sqlite', { filename, mode: 'wal' }, {
  acceptance_records: {
    id: { type: 'integer', primary: true },
    name: { type: 'string', nullable: false },
  },
});
await db.start();
try {
  const model = db.model('acceptance_records');
  if (phase === 'write') {
    await model.insert({ id: 1, name: 'persisted-by-process-a' });
    assert.equal(await db.healthCheck(), true);
  } else if (phase === 'restart') {
    assert.deepEqual(await model.select().orderBy('id'), [{ id: 1, name: 'persisted-by-process-a' }]);
    await assert.rejects(db.transaction(async tx => {
      await tx.insert('acceptance_records', { id: 2, name: 'must-rollback' });
      throw new Error('expected-fixture-rollback');
    }), /expected-fixture-rollback/);
    assert.deepEqual(await model.select().where({ id: 2 }), []);
    await db.transaction(async tx => { await tx.insert('acceptance_records', { id: 3, name: 'committed-after-rollback' }); });
  } else {
    assert.deepEqual(await model.select().orderBy('id'), [
      { id: 1, name: 'persisted-by-process-a' }, { id: 3, name: 'committed-after-rollback' },
    ]);
    // A new process acquires a SQLite write lock after both earlier closes.
    await db.query('BEGIN EXCLUSIVE'); await db.query('COMMIT');
  }
} finally { await db.stop(); }
assert.equal(db.isStarted, false);
console.log(JSON.stringify({ phase, databaseClosed: true, ok: true }));
// No process.exit(): a leaked resource must prevent natural exit and fail the parent timeout.
