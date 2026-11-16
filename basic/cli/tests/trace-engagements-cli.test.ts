/**
 * `zhin trace --engagements` against a real SQLite project database (#1250 b35):
 * - trace-engagements-crash: the command must read `engagement_events` (1.5.0 failed with
 *   `this[#db].select is not a function`);
 * - engagement-id-reused-across-restarts: the command never splits pre-b35 rows that reuse `m1`
 *   (only the instance does, in the background); it shows them as they are, with a notice.
 * Runs the CLI command itself; the project resolves `zhin.js/instance/cli` from its own
 * node_modules (a link to the workspace package), as an installed project does.
 */
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
let sqlite: typeof import('node:sqlite') | undefined;
try {
  sqlite = require('node:sqlite');
} catch {
  sqlite = undefined;
}

const zhinPackage = resolve(dirname(fileURLToPath(import.meta.url)), '../../../packages/im/zhin');
const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
  process.exitCode = undefined;
});

function project(): string {
  const root = mkdtempSync(join(tmpdir(), 'zhin-trace-cli-'));
  dirs.push(root);
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'trace-fixture', type: 'module', private: true }));
  writeFileSync(join(root, 'zhin.config.yml'), 'database:\n  dialect: sqlite\n  filename: ./data/bot.db\n');
  mkdirSync(join(root, 'node_modules'), { recursive: true });
  symlinkSync(zhinPackage, join(root, 'node_modules', 'zhin.js'), 'junction');
  mkdirSync(join(root, 'data'));
  const db = new sqlite!.DatabaseSync(join(root, 'data', 'bot.db'));
  db.exec('CREATE TABLE engagement_events (id TEXT PRIMARY KEY NOT NULL, engagement_id TEXT NOT NULL, seq INTEGER NOT NULL, at BIGINT NOT NULL, type TEXT NOT NULL, data TEXT NOT NULL)');
  const insert = db.prepare('INSERT INTO engagement_events (id, engagement_id, seq, at, type, data) VALUES (?, ?, ?, ?, ?, ?)');
  const events: Array<[number, string, Record<string, unknown>]> = [
    [1_000, 'engagement_opened', { rootMailId: 'm2', rootGrantId: 'g1', entry: 'zhin', initiator: { kind: 'human', id: 'alice', trust: 'master' } }],
    [1_010, 'mail_admitted', { mailId: 'm2', grantId: 'g1', kind: 'human', from: 'human:alice', to: 'zhin', causationId: null }],
    [1_020, 'engagement_closed', { status: 'completed' }],
    // instance restarted: the counter handed out m1 / m2 / g1 again
    [9_000, 'engagement_opened', { rootMailId: 'm2', rootGrantId: 'g1', entry: 'zhin', initiator: { kind: 'human', id: 'bob', trust: 'master' } }],
    [9_010, 'mail_admitted', { mailId: 'm2', grantId: 'g1', kind: 'human', from: 'human:bob', to: 'zhin', causationId: null }],
    [9_020, 'mail_admitted', { mailId: 'm3', grantId: 'g2', kind: 'ask', from: 'zhin', to: 'planner', causationId: 'm2' }],
    [9_030, 'engagement_closed', { status: 'completed' }],
  ];
  events.forEach(([at, type, data], seq) => insert.run(`m1:${seq}`, 'm1', seq, at, type, JSON.stringify(data)));
  db.close();
  return root;
}

async function trace(args: string[]): Promise<{ out: string; first: string; err: string; exitCode: number | undefined }> {
  vi.resetModules();
  const { traceCommand } = await import('../src/commands/trace.js');
  const out: string[] = [];
  const err: string[] = [];
  vi.spyOn(console, 'log').mockImplementation((...values: unknown[]) => { out.push(values.join(' ')); });
  vi.spyOn(console, 'error').mockImplementation((...values: unknown[]) => { err.push(values.join(' ')); });
  process.exitCode = undefined;
  await traceCommand.parseAsync(['node', 'trace', ...args]);
  const exitCode = process.exitCode as number | undefined;
  vi.restoreAllMocks();
  return { out: out.join('\n'), first: out[0] ?? '', err: err.join('\n'), exitCode };
}

function snapshot(root: string): { tables: string[]; rows: unknown[] } {
  const db = new sqlite!.DatabaseSync(join(root, 'data', 'bot.db'));
  try {
    const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as Array<{ name: string }>).map(row => row.name);
    const rows = db.prepare('SELECT id, engagement_id, seq, at, type, data FROM engagement_events ORDER BY id').all();
    return { tables, rows };
  } finally {
    db.close();
  }
}

const NOTICE = '旧版协作记录尚未拆分，重启实例后会自动整理';

describe.skipIf(!sqlite)('zhin trace --engagements on a real SQLite data/bot.db (#1250 b35)', () => {
  it('reads pre-b35 records as they are, never migrates them, and says the instance will split them', { timeout: 60_000 }, async () => {
    const root = project();
    const strayFile = join(process.cwd(), 'data', 'bot.db');
    const strayExisted = existsSync(strayFile);
    const before = snapshot(root);

    const listed = await trace(['--engagements', '--list', '-n', '100', '--json', '--cwd', root]);
    expect(listed.err).not.toMatch(/select is not a function/);
    expect(listed.exitCode ?? 0).toBe(0);
    // The notice goes to stderr: --json output stays parseable.
    expect(listed.err).toContain(NOTICE);
    const summaries = JSON.parse(listed.first) as Array<{ engagementId: string; initiator?: { id: string } }>;
    expect(summaries.map(summary => summary.engagementId)).toEqual(['m1']);
    // `--cwd` reads <root>/data/bot.db, not a new file next to the process cwd.
    expect(existsSync(strayFile)).toBe(strayExisted);

    const shown = await trace(['--engagements', 'm1', '--cwd', root]);
    expect(shown.exitCode ?? 0).toBe(0);
    expect(shown.out).toContain('Engagement m1');
    expect(shown.err).toContain(NOTICE);

    // Read-only as far as the id split goes: same rows, no marker table.
    const after = snapshot(root);
    expect(after.rows).toEqual(before.rows);
    expect(after.tables).not.toContain('engagement_event_migrations');
  });

  it('checks the marker first and reads split ids exactly before by prefix', { timeout: 60_000 }, async () => {
    const root = project();
    const db = new sqlite!.DatabaseSync(join(root, 'data', 'bot.db'));
    db.exec('CREATE TABLE engagement_event_migrations (id INTEGER PRIMARY KEY NOT NULL, version INTEGER NOT NULL, applied_at BIGINT NOT NULL, detail TEXT)');
    db.exec('INSERT INTO engagement_event_migrations (id, version, applied_at, detail) VALUES (1, 1, 0, NULL)');
    const insert = db.prepare('INSERT INTO engagement_events (id, engagement_id, seq, at, type, data) VALUES (?, ?, ?, ?, ?, ?)');
    insert.run('m-run-1:0', 'm-run-1', 0, 20_000, 'engagement_opened', JSON.stringify({ entry: 'zhin', initiator: { kind: 'human', id: 'carol', trust: 'master' } }));
    insert.run('m-run-17:0', 'm-run-17', 0, 30_000, 'engagement_opened', JSON.stringify({ entry: 'zhin', initiator: { kind: 'human', id: 'dave', trust: 'master' } }));
    db.close();
    const before = snapshot(root);

    // The marker exists, so no notice even though the seeded `m1` still holds two openings.
    const listed = await trace(['--engagements', '--list', '-n', '100', '--json', '--cwd', root]);
    expect(listed.err).not.toContain(NOTICE);
    expect((JSON.parse(listed.first) as Array<{ engagementId: string }>).map(summary => summary.engagementId).sort()).toEqual(['m-run-1', 'm-run-17', 'm1']);

    // `m-run-1` is also a prefix of `m-run-17` (the more recent one): exact match first.
    const shown = await trace(['--engagements', 'm-run-1', '--cwd', root]);
    expect(shown.out).toContain('Engagement m-run-1  [');
    expect(shown.out).toContain('Initiator: carol');
    expect(snapshot(root).rows).toEqual(before.rows);
  });
});
