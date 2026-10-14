import { mkdtemp, readdir, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createTurnTraceArchive, dayKey, resolveTraceArchiveOptions } from '../../src/trace/turn-trace-archive.js';
import type { TurnTrace } from '../../src/trace/turn-trace.js';

const DAY = 86_400_000;
const NOW = Date.parse('2026-10-14T12:00:00Z');
const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))); });
const tempDir = async () => { const dir = await mkdtemp(join(tmpdir(), 'trace-archive-')); dirs.push(dir); return dir; };

function trace(turnId: string, sessionKey: string, startedAt: number, extra: Partial<TurnTrace> = {}): TurnTrace {
  return {
    version: 1, turn_id: turnId, session_key: sessionKey, started_at: startedAt, duration_ms: 5,
    model_calls: [], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }, tool_calls: [],
    budget: { extensions: [], continuations: 0 }, subagent_tasks: [], subagents: [], timeline: [],
    termination: { status: 'completed' }, dropped: 0, ...extra,
  };
}

describe('TurnTrace archive (#728)', () => {
  it('appends one JSONL file per UTC day and filters by session and time', async () => {
    const dir = await tempDir();
    const archive = createTurnTraceArchive(dir, { now: () => NOW, secrets: [] });
    await archive.save(trace('a1', 's:a', NOW - 2 * DAY));
    await archive.save(trace('b1', 's:b', NOW - DAY));
    await archive.save(trace('a2', 's:a', NOW));
    expect((await readdir(dir)).sort()).toEqual([dayKey(NOW - 2 * DAY), dayKey(NOW - DAY), dayKey(NOW)].map((d) => `${d}.jsonl`));
    expect((await archive.query({ sessionKey: 's:a' })).map((t) => t.turn_id)).toEqual(['a1', 'a2']);
    expect((await archive.query({ since: NOW - DAY - 1 })).map((t) => t.turn_id)).toEqual(['b1', 'a2']);
    expect((await archive.query({ until: NOW })).map((t) => t.turn_id)).toEqual(['a1', 'b1']);
    expect((await archive.query({ limit: 1 })).map((t) => t.turn_id)).toEqual(['a2']);
    expect((await archive.latest())?.turn_id).toBe('a2');
    expect((await archive.find('b'))?.turn_id).toBe('b1');
    expect(await archive.find('a')).toBeUndefined(); // ambiguous prefix
    expect((await archive.sessions()).map((s) => [s.session_key, s.turns])).toEqual([['s:a', 2], ['s:b', 1]]);
  });

  it('prunes day files past the retention period', async () => {
    const dir = await tempDir();
    const archive = createTurnTraceArchive(dir, { now: () => NOW, retentionDays: 7, secrets: [] });
    // Files written by an earlier process; this archive has not pruned yet.
    for (const [id, at] of [['old', NOW - 9 * DAY], ['edge', NOW - 7 * DAY], ['new', NOW]] as const) {
      await writeFile(join(dir, `${dayKey(at)}.jsonl`), `${JSON.stringify(trace(id, 's', at))}\n`);
    }
    const deleted = await archive.prune();
    expect(deleted).toEqual([`${dayKey(NOW - 9 * DAY)}.jsonl`]);
    // Saving also prunes (at most hourly), so an old day never lingers.
    await writeFile(join(dir, `${dayKey(NOW - 30 * DAY)}.jsonl`), `${JSON.stringify(trace('ancient', 's', NOW - 30 * DAY))}\n`);
    const fresh = createTurnTraceArchive(dir, { now: () => NOW, retentionDays: 7, secrets: [] });
    await fresh.save(trace('later', 's', NOW));
    expect((await fresh.list()).map((t) => t.turn_id)).not.toContain('ancient');
    await rm(join(dir, `${dayKey(NOW)}.jsonl`));
    await writeFile(join(dir, `${dayKey(NOW)}.jsonl`), `${JSON.stringify(trace('new', 's', NOW))}\n`);
    expect((await archive.list()).map((t) => t.turn_id)).toEqual(['edge', 'new']);
  });

  it('enforces the size cap by deleting the oldest days, never today', async () => {
    const dir = await tempDir();
    const archive = createTurnTraceArchive(dir, { now: () => NOW, maxBytes: 600, secrets: [] });
    for (let day = 3; day >= 0; day--) await archive.save(trace(`d${day}`, 's', NOW - day * DAY));
    await archive.prune();
    const left = (await archive.list()).map((t) => t.turn_id);
    expect(left).toContain('d0');
    expect(left).not.toContain('d3');
    const tiny = createTurnTraceArchive(dir, { now: () => NOW, maxBytes: 1, secrets: [] });
    await tiny.prune();
    expect((await tiny.list()).map((t) => t.turn_id)).toEqual(['d0']);
  });

  it('redacts inline credentials and exact secret values on write', async () => {
    const dir = await tempDir();
    const archive = createTurnTraceArchive(dir, { now: () => NOW, secrets: ['hunter2-super-secret'] });
    await archive.save(trace('r', 's', NOW, {
      timeline: [{ at_ms: 1, kind: 'tool_failed', detail: 'auth failed: Bearer abcdefghijklmnop, pw hunter2-super-secret, key sk-proj-AbCdEfGhIjKlMnOp' }],
    }));
    const raw = await readFile(join(dir, `${dayKey(NOW)}.jsonl`), 'utf8');
    expect(raw).not.toContain('abcdefghijklmnop');
    expect(raw).not.toContain('hunter2-super-secret');
    expect(raw).not.toContain('sk-proj-AbCdEfGhIjKlMnOp');
    expect(raw).toContain('[redacted]');
  });

  it('survives a torn line, keeps the latest record of a re-saved turn, and reads the legacy file', async () => {
    const dir = await tempDir();
    const legacy = join(dir, 'recent.json');
    await writeFile(legacy, JSON.stringify({ version: 1, traces: [trace('legacy', 's', NOW - DAY)] }));
    const archive = createTurnTraceArchive(dir, { now: () => NOW, secrets: [], legacyFile: legacy });
    await archive.save(trace('t', 's', NOW, { termination: { status: 'running' } }));
    await archive.save(trace('t', 's', NOW, { termination: { status: 'failed' } }));
    await writeFile(join(dir, `${dayKey(NOW)}.jsonl`), '{"turn_id": "torn', { flag: 'a' });
    const all = await archive.list();
    expect(all.map((t) => [t.turn_id, t.termination.status])).toEqual([['legacy', 'completed'], ['t', 'failed']]);
  });

  it('returns nothing for a missing directory and reads env overrides', async () => {
    const dir = join(await tempDir(), 'missing');
    expect(await createTurnTraceArchive(dir, { secrets: [] }).list()).toEqual([]);
    await mkdir(dir);
    expect(resolveTraceArchiveOptions({ ZHIN_TRACE_RETENTION_DAYS: '3', ZHIN_TRACE_MAX_MB: '2' })).toEqual({ retentionDays: 3, maxBytes: 2 * 1024 * 1024 });
    expect(resolveTraceArchiveOptions({ ZHIN_TRACE_RETENTION_DAYS: 'x' })).toEqual({});
  });
});
