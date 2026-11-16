/**
 * `zhin trace --engagements` against a real SQLite project database (#1250 b35):
 * - trace-engagements-crash: the command must read `engagement_events` (1.5.0 failed with
 *   `this[#db].select is not a function`);
 * - engagement-id-reused-across-restarts: pre-b35 rows that reuse `m1` across restarts are split
 *   into distinct engagements once, and the command reads them by their new ids.
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

describe.skipIf(!sqlite)('zhin trace --engagements on a real SQLite data/bot.db (#1250 b35)', () => {
  it('lists, splits and reads engagements whose ids were reused across restarts', { timeout: 60_000 }, async () => {
    const root = project();
    const strayFile = join(process.cwd(), 'data', 'bot.db');
    const strayExisted = existsSync(strayFile);

    const listed = await trace(['--engagements', '--list', '-n', '100', '--json', '--cwd', root]);
    expect(listed.err).not.toMatch(/select is not a function/);
    expect(listed.exitCode ?? 0).toBe(0);
    const summaries = JSON.parse(listed.first) as Array<{ engagementId: string; status: string; mailCount: number; initiator?: { id: string } }>;
    expect(summaries).toHaveLength(2);
    const ids = summaries.map(summary => summary.engagementId);
    expect(new Set(ids).size).toBe(2);
    expect(ids).not.toContain('m1');
    for (const id of ids) expect(id).toMatch(/^m-[0-9a-z]+-1$/);
    expect(summaries.map(summary => summary.initiator?.id).sort()).toEqual(['alice', 'bob']);
    expect(summaries.every(summary => summary.status === 'completed')).toBe(true);
    // `--cwd` reads <root>/data/bot.db, not a new file next to the process cwd.
    expect(existsSync(strayFile)).toBe(strayExisted);

    const bob = summaries.find(summary => summary.initiator?.id === 'bob')!;
    expect(bob.mailCount).toBe(2);
    const shown = await trace(['--engagements', bob.engagementId, '--cwd', root]);
    expect(shown.exitCode ?? 0).toBe(0);
    expect(shown.out).toContain(`Engagement ${bob.engagementId}`);
    expect(shown.out).toContain('Initiator: bob');
    expect(shown.out).not.toContain('alice');

    // The migration ran once: a second run sees the same ids.
    const again = await trace(['--engagements', '--list', '-n', '100', '--json', '--cwd', root]);
    expect((JSON.parse(again.first) as Array<{ engagementId: string }>).map(summary => summary.engagementId).sort()).toEqual([...ids].sort());
  });
});
