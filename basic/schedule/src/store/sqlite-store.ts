import type { JobStore, StoredJob } from './types.js';
import { DEFAULT_JOBS_PATH } from './types.js';
import { migrateStoredJob } from './migrate.js';

export interface SqliteStoreOptions {
  path?: string;
}

type DatabaseSync = InstanceType<typeof import('node:sqlite').DatabaseSync>;

export class SqliteJobStore implements JobStore {
  private readonly path: string;
  private db: DatabaseSync | null = null;

  constructor(options: SqliteStoreOptions = {}) {
    this.path = options.path ?? DEFAULT_JOBS_PATH.replace(/\.json$/, '.db');
  }

  private async open(): Promise<DatabaseSync> {
    if (this.db) {
      return this.db;
    }

    let DatabaseSyncCtor: typeof import('node:sqlite').DatabaseSync;
    try {
      ({ DatabaseSync: DatabaseSyncCtor } = await import('node:sqlite'));
    } catch {
      throw new Error(
        'SQLite store requires Node.js 22.5+ with built-in node:sqlite. Upgrade Node or use LocalJsonJobStore.',
      );
    }

    const fs = await import('node:fs/promises');
    const nodePath = await import('node:path');
    if (this.path !== ':memory:') {
      await fs.mkdir(nodePath.dirname(this.path), { recursive: true });
    }

    this.db = new DatabaseSyncCtor(this.path);
    this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS jobs (
        id TEXT PRIMARY KEY,
        body TEXT NOT NULL
      );
    `);
    return this.db;
  }

  async load(): Promise<StoredJob[]> {
    const db = await this.open();
    const rows = db.prepare('SELECT body FROM jobs').all() as { body: string }[];
    return rows.map((row) => migrateStoredJob(JSON.parse(row.body) as StoredJob));
  }

  async upsert(job: StoredJob): Promise<void> {
    const db = await this.open();
    db.prepare(
      'INSERT INTO jobs (id, body) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET body = excluded.body',
    ).run(job.id, JSON.stringify(job));
  }

  async remove(id: string): Promise<void> {
    const db = await this.open();
    db.prepare('DELETE FROM jobs WHERE id = ?').run(id);
  }

  async listDue(before: Date, limit = 100): Promise<StoredJob[]> {
    const db = await this.open();
    const beforeIso = before.toISOString();
    const rows = db
      .prepare(
        `SELECT body FROM jobs
         WHERE json_extract(body, '$.cancelled') = 0
           AND json_extract(body, '$.nextRunAt') IS NOT NULL
           AND json_extract(body, '$.nextRunAt') <= ?
         ORDER BY json_extract(body, '$.nextRunAt')
         LIMIT ?`,
      )
      .all(beforeIso, limit) as { body: string }[];
    return rows.map((row) => migrateStoredJob(JSON.parse(row.body) as StoredJob));
  }
}

export function createSqliteStore(options?: SqliteStoreOptions): SqliteJobStore {
  return new SqliteJobStore(options);
}
