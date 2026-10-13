// Test boundary only: the real PluginStateStore runs over durable SQLite CAS;
// group statistics models are intentionally volatile here and are not a production database test.
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { createInMemoryGroupSuiteDb } from '../../../../plugins/utils/group-suite/src/memory-store.ts';

export function sqliteStateHost(path) {
  const sqlite = new DatabaseSync(path);
  sqlite.exec('CREATE TABLE IF NOT EXISTS test_state (id TEXT PRIMARY KEY, revision TEXT NOT NULL, value TEXT NOT NULL, expires_at INTEGER)');
  const stateKey = (owner, scope, key) => JSON.stringify([owner, scope, key]);
  const read = (owner, scope, key) => {
    const row = sqlite.prepare('SELECT revision,value,expires_at FROM test_state WHERE id=?').get(stateKey(owner,scope,key));
    return row ? {revision:row.revision,value:JSON.parse(row.value),expiresAt:row.expires_at} : undefined;
  };
  const state = {
    async read(owner,scope,key) { return read(owner,scope,key); },
    async compareExchange(owner,scope,key,revision,value,expiresAt) {
      const id=stateKey(owner,scope,key);
      if (value===undefined) return revision===undefined ? read(owner,scope,key)===undefined
        : Number(sqlite.prepare('DELETE FROM test_state WHERE id=? AND revision=?').run(id,revision).changes)===1;
      const next=randomUUID();
      return Number((revision===undefined
        ? sqlite.prepare('INSERT OR IGNORE INTO test_state(id,revision,value,expires_at) VALUES(?,?,?,?)').run(id,next,JSON.stringify(value),expiresAt)
        : sqlite.prepare('UPDATE test_state SET revision=?,value=?,expires_at=? WHERE id=? AND revision=?').run(next,JSON.stringify(value),expiresAt,id,revision)).changes)===1;
    },
  };
  const tables = new Map();
  const host = {state,dialect:'sqlite',started:true,
    define(name,schema) {
      if (tables.has(name)) return;
      const logical = 'question' in schema ? 'teach_qa' : 'count' in schema ? 'message_stats' : 'checkin_records';
      tables.set(name,createInMemoryGroupSuiteDb().models.get(logical));
    },
    tables:()=>[...tables.keys()], models:{get:name=>tables.get(name)},
    getRawDatabase:()=>undefined,start:async()=>undefined,stop:async()=>undefined,
  };
  return {host,close:()=>sqlite.close()};
}
