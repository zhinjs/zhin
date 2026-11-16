import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { openProjectEngagementJournal } from '../../../src/instance/cli/trace.js';
import { createCliProjectDatabaseHost, resolveCliProjectDatabaseConfig } from '../../../src/instance/cli/project-database.js';

describe('zhin trace --engagements (#1250 trace-engagements-crash)', () => {
  it('opens the project journal over the database models and lists, reads and summarizes engagements', async () => {
    const root = await mkdtemp(join(tmpdir(), 'zhin-trace-engagements-'));
    try {
      // The project's default database exists (an empty SQLite file); the CLI never creates one.
      await mkdir(join(root, '.zhin'));
      await writeFile(join(root, '.zhin', 'data.sqlite'), '');
      const opened = await openProjectEngagementJournal(root);
      expect(opened).not.toBeNull();
      try {
        // Empty before any collaboration: no `this[#db].select is not a function`.
        await expect(opened!.journal.listEngagements(50)).resolves.toEqual([]);
        await opened!.journal.append({ engagementId: 'eng-1', type: 'engagement_opened', at: 1_000,
          data: { initiator: { kind: 'human', id: 'alice', trust: 'master' }, entry: 'zhin' } });
        await opened!.journal.append({ engagementId: 'eng-1', type: 'mail_sent', at: 1_100,
          data: { mailId: 'm1', kind: 'delegate', from: 'zhin', to: 'planner' } });
        await expect(opened!.journal.listEngagements(50)).resolves.toEqual(['eng-1']);
        const events = await opened!.journal.read('eng-1');
        expect(events.map(event => event.type)).toEqual(['engagement_opened', 'mail_sent']);
        const summary = await opened!.journal.summarize('eng-1');
        expect(summary?.engagementId).toBe('eng-1');
        expect(summary?.mailCount).toBe(1);
      } finally {
        await opened!.close();
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('never creates the database file it was asked to read (#1250 b35 review)', async () => {
    const root = await mkdtemp(join(tmpdir(), 'zhin-trace-missing-'));
    try {
      // A project that never started: no `.zhin/data.sqlite`.
      await expect(openProjectEngagementJournal(root)).resolves.toBeNull();
      expect(existsSync(join(root, '.zhin', 'data.sqlite'))).toBe(false);
      // A typo'd relative filename.
      await mkdir(join(root, 'data'));
      await writeFile(join(root, 'zhin.config.yml'), 'database:\n  dialect: sqlite\n  filename: ./data/bto.db\n');
      await expect(openProjectEngagementJournal(root)).resolves.toBeNull();
      await expect(createCliProjectDatabaseHost(root)).rejects.toMatchObject({ code: 'project_database_missing', filename: join(root, 'data', 'bto.db') });
      expect(existsSync(join(root, 'data', 'bto.db'))).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('anchors only plain relative SQLite files at the project root', async () => {
    const root = await mkdtemp(join(tmpdir(), 'zhin-trace-config-'));
    const config = async (database: string) => {
      await writeFile(join(root, 'zhin.config.yml'), `database:\n${database}`);
      return resolveCliProjectDatabaseConfig(root) as Promise<Record<string, unknown>>;
    };
    try {
      await expect(config('  dialect: sqlite\n  filename: ./data/bot.db\n')).resolves.toMatchObject({ filename: join(root, 'data', 'bot.db') });
      const absolute = join(tmpdir(), 'elsewhere', 'bot.db');
      await expect(config(`  dialect: sqlite\n  filename: ${absolute}\n`)).resolves.toMatchObject({ filename: absolute });
      await expect(config('  dialect: sqlite\n  filename: ":memory:"\n')).resolves.toMatchObject({ filename: ':memory:' });
      await expect(config('  dialect: sqlite\n  filename: "file:data/bot.db?mode=ro"\n')).resolves.toMatchObject({ filename: 'file:data/bot.db?mode=ro' });
      const mysql = await config('  dialect: mysql\n  host: 127.0.0.1\n  database: zhin\n');
      expect(mysql).toMatchObject({ dialect: 'mysql', host: '127.0.0.1' });
      expect(mysql.filename).toBeUndefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
