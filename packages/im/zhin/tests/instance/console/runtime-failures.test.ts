import { existsSync, lstatSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { RUNTIME_FAILURES_FILE } from '@zhin.js/console-protocol';
import { pruneInferenceFailures } from '@zhin.js/agent/runtime';
import {
  MAX_RUNTIME_FAILURES,
  RUNTIME_FAILURE_ABSENT_GRACE_MS,
  RuntimeFailureJournal,
  readRuntimeFailureFile,
  syncEndpointFailures,
  syncMcpFailures,
  syncRuntimeFailures,
} from '../../../src/instance/console/runtime-failures.js';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const project = () => { const root = mkdtempSync(join(tmpdir(), 'runtime-failures-')); roots.push(root); return root; };

describe('RuntimeFailureJournal (#1270)', () => {
  it('records, counts, clears and writes the file atomically', async () => {
    const root = project();
    let clock = 1_000;
    const journal = RuntimeFailureJournal.open(root, { now: () => clock });
    journal.record({ source: 'account', subject: 'accounts:a', code: 'project-unavailable', category: 'preparation',
      message: 'Account preparation failed: code=project-unavailable token=secret-value', step: 'onboard-operation',
      reason: 'UNSUPPORTED_CLIENT', upstreamStatus: 200, credentialRevision: 4 });
    clock = 2_000;
    journal.record({ source: 'account', subject: 'accounts:a', code: 'project-unavailable', category: 'preparation',
      message: 'again', credentialRevision: 4 });
    await journal.flush();
    const file = join(root, RUNTIME_FAILURES_FILE);
    const stored = JSON.parse(readFileSync(file, 'utf8'));
    expect(stored.version).toBe(1);
    expect(stored.entries).toEqual([expect.objectContaining({ source: 'account', subject: 'accounts:a', firstAt: 1_000, lastAt: 2_000, count: 2, credentialRevision: 4 })]);
    expect(readdirSync(join(root, '.zhin')).filter(name => name.endsWith('.tmp'))).toEqual([]);
    // A new credential revision starts a new run.
    journal.record({ source: 'account', subject: 'accounts:a', code: 'project-unavailable', category: 'preparation', message: 'x', credentialRevision: 5 });
    expect(journal.get('account', 'accounts:a')).toMatchObject({ count: 1, credentialRevision: 5 });
    journal.clear('account', 'accounts:a');
    await journal.flush();
    expect(existsSync(file)).toBe(false);
  });

  it('redacts messages and marks entries loaded from the file as restored until observed again', async () => {
    const root = project();
    const first = RuntimeFailureJournal.open(root, { now: () => 10 });
    first.record({ source: 'mcp', subject: 'github', code: 'connect-failed', category: 'auth',
      message: 'failed at /home/me/secret/project with Bearer abc123' });
    await first.close();
    const second = RuntimeFailureJournal.open(root, { now: () => 20 });
    const restored = second.get('mcp', 'github');
    expect(restored).toMatchObject({ restored: true, message: 'failed at …/project with Bearer ***' });
    second.record({ source: 'mcp', subject: 'github', code: 'connect-failed', category: 'auth', message: 'again', at: 20 });
    expect(second.get('mcp', 'github')?.restored).toBeUndefined();
    expect(second.get('mcp', 'github')?.count).toBe(2);
  });

  it('drops malformed entries and unreadable files instead of trusting them', () => {
    const root = project();
    mkdirSync(join(root, '.zhin'), { recursive: true });
    const file = join(root, RUNTIME_FAILURES_FILE);
    writeFileSync(file, JSON.stringify({ version: 1, entries: [
      { source: 'account', subject: 'ok', code: 'x', category: 'preparation', message: 'm', firstAt: 1, lastAt: 2, count: 1 },
      { source: 'evil', subject: 'x', code: 'x', category: 'y', message: 'm', firstAt: 1, lastAt: 1, count: 1 },
      { source: 'mcp', subject: 'x', code: 'bad code!', category: 'y', message: 'm', firstAt: 1, lastAt: 1, count: 1 },
    ] }));
    expect(readRuntimeFailureFile(file).map(entry => entry.subject)).toEqual(['ok']);
    writeFileSync(file, '{not json');
    expect(readRuntimeFailureFile(file)).toEqual([]);
  });

  it('bounds the number of entries', () => {
    const journal = new RuntimeFailureJournal(join(project(), RUNTIME_FAILURES_FILE));
    for (let index = 0; index <= MAX_RUNTIME_FAILURES; index += 1) {
      journal.record({ source: 'model', subject: `accounts:${index}`, code: 'server', category: 'server', message: 'x' });
    }
    expect(journal.list()).toHaveLength(MAX_RUNTIME_FAILURES);
    expect(journal.get('model', 'accounts:0')).toBeUndefined();
  });

  it('mirrors Endpoint and MCP rows: one observation per failed attempt, cleared on success, forgotten when gone', () => {
    const journal = new RuntimeFailureJournal(join(project(), RUNTIME_FAILURES_FILE), { now: () => 100 });
    const failed = { adapter: 'github', name: 'zhin-dev', connected: false, lastError: { category: 'auth', message: 'Bad credentials', at: 50 } };
    syncEndpointFailures(journal, [failed]);
    syncEndpointFailures(journal, [failed]);
    expect(journal.get('endpoint', 'github/zhin-dev')).toMatchObject({ code: 'start-failed', category: 'auth', count: 1, lastAt: 50 });
    syncEndpointFailures(journal, [{ ...failed, lastError: { ...failed.lastError, at: 70 } }]);
    expect(journal.get('endpoint', 'github/zhin-dev')?.count).toBe(2);
    // Offline without a new failure keeps the latest reason.
    syncEndpointFailures(journal, [{ adapter: 'github', name: 'zhin-dev', connected: false }]);
    expect(journal.get('endpoint', 'github/zhin-dev')).toBeDefined();
    syncEndpointFailures(journal, [{ adapter: 'github', name: 'zhin-dev', connected: true }]);
    expect(journal.get('endpoint', 'github/zhin-dev')).toBeUndefined();

    syncMcpFailures(journal, [{ name: 'search', connected: false, lastError: { category: 'network', message: 'ECONNREFUSED', at: 10 } }]);
    expect(journal.get('mcp', 'search')).toMatchObject({ code: 'connect-failed', category: 'network' });
    syncMcpFailures(journal, [{ name: 'search', connected: true }]);
    expect(journal.get('mcp', 'search')).toBeUndefined();
    // A source that cannot be read (the Root is starting) is skipped.
    expect(() => syncRuntimeFailures({ journal, endpoints: () => { throw new Error('not ready'); } })).not.toThrow();
  });

  it('keeps the entry of a subject that only briefly drops out of its list (hot reload), restored ones included', async () => {
    const root = project();
    let clock = 1_000;
    const before = RuntimeFailureJournal.open(root, { now: () => clock });
    before.record({ source: 'mcp', subject: 'github', code: 'connect-failed', category: 'auth', message: 'HTTP 401', at: 900 });
    before.record({ source: 'endpoint', subject: 'qq/bot', code: 'start-failed', category: 'network', message: 'ECONNRESET', at: 950 });
    await before.close();
    const journal = RuntimeFailureJournal.open(root, { now: () => clock });
    // A generation switch: the lists are empty for a moment.
    syncMcpFailures(journal, []);
    syncEndpointFailures(journal, []);
    expect(journal.get('mcp', 'github')).toMatchObject({ restored: true });
    expect(journal.get('endpoint', 'qq/bot')).toMatchObject({ restored: true });
    // Back within the grace period: nothing is lost, and a later absence starts a new period.
    clock += RUNTIME_FAILURE_ABSENT_GRACE_MS - 1;
    syncMcpFailures(journal, [{ name: 'github', connected: false }]);
    expect(journal.get('mcp', 'github')?.restored).toBe(true);
    clock += 10;
    syncMcpFailures(journal, []);
    expect(journal.get('mcp', 'github')).toBeDefined();
    // Gone for longer than the grace period: forgotten.
    clock += RUNTIME_FAILURE_ABSENT_GRACE_MS;
    syncEndpointFailures(journal, []);
    syncMcpFailures(journal, []);
    expect(journal.get('endpoint', 'qq/bot')).toBeUndefined();
    expect(journal.get('mcp', 'github')).toBeUndefined();
  });

  it('drops account and model entries that are no longer current (deleted, signed out, another credential revision)', () => {
    const journal = new RuntimeFailureJournal(join(project(), RUNTIME_FAILURES_FILE));
    const preparation = (subject: string, credentialRevision: number) => journal.record({ source: 'account', subject, code: 'project-unavailable',
      category: 'preparation', message: 'x', credentialRevision });
    const model = (subject: string) => journal.record({ source: 'model', subject, code: 'rate-limit', category: 'rate-limit', message: 'x' });
    preparation('current', 2); model('current');
    preparation('deleted', 1); model('deleted');
    preparation('relogged', 2);
    preparation('disconnected', 3); model('disconnected');
    pruneInferenceFailures(journal, {
      current: { status: 'authenticated', preparation: 'required', revision: 2 },
      relogged: { status: 'authenticated', preparation: 'required', revision: 4 },
      disconnected: { status: 'disconnected', revision: 4 },
    });
    expect(journal.list().map(entry => `${entry.source}:${entry.subject}`).sort()).toEqual(['account:current', 'model:current']);
  });

  it('never writes through a symbolic link and uses an exclusive, unpredictable temporary file', async () => {
    const root = project();
    mkdirSync(join(root, '.zhin'), { recursive: true });
    const target = join(root, 'elsewhere.json');
    writeFileSync(target, 'untouched');
    symlinkSync(target, join(root, RUNTIME_FAILURES_FILE));
    const warnings: string[] = [];
    const journal = RuntimeFailureJournal.open(root, { warn: message => warnings.push(message) });
    expect(journal.list()).toEqual([]);
    journal.record({ source: 'mcp', subject: 'x', code: 'connect-failed', category: 'network', message: 'down' });
    await journal.flush();
    expect(readFileSync(target, 'utf8')).toBe('untouched');
    expect(lstatSync(join(root, RUNTIME_FAILURES_FILE)).isSymbolicLink()).toBe(true);
    expect(warnings).toEqual([expect.stringContaining('symbolic link refused')]);
    rmSync(join(root, RUNTIME_FAILURES_FILE));
    // A pre-placed `<file>.<pid>.tmp` no longer matters: the name is random and created with `wx`.
    writeFileSync(join(root, `${RUNTIME_FAILURES_FILE}.${process.pid}.tmp`), 'planted');
    journal.record({ source: 'mcp', subject: 'y', code: 'connect-failed', category: 'network', message: 'down again' });
    await journal.flush();
    expect(JSON.parse(readFileSync(join(root, RUNTIME_FAILURES_FILE), 'utf8')).entries).toHaveLength(2);
    expect(readFileSync(join(root, `${RUNTIME_FAILURES_FILE}.${process.pid}.tmp`), 'utf8')).toBe('planted');
    expect(lstatSync(join(root, RUNTIME_FAILURES_FILE)).mode & 0o777).toBe(0o600);
  });
});
