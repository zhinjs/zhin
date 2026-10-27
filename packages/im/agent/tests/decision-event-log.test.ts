import { describe, expect, it, vi } from 'vitest';
import { DECISION_EVENT_RECENT_LIMIT, DecisionEventLog } from '../src/decision-event-log.js';
import { DECISION_REASON_CODES, type DecisionEventInput } from '../src/decision-events.js';

const base: DecisionEventInput = {
  turnId: 't1', instanceId: '10000', platform: 'icqq', sceneId: 'group:g1',
  kind: 'speak_gate', outcome: 'deny', reasonCode: 'cannot_speak_muted', actor: 'policy',
};

describe('DecisionEventLog', () => {
  it('keeps recent records in memory before a database is attached', async () => {
    const log = new DecisionEventLog(() => 42);
    const record = await log.record(base);
    expect(record).toMatchObject({ kind: 'speak_gate', reasonCode: 'cannot_speak_muted', ts: 42 });
    expect(log.persistent).toBe(false);
    expect(log.recent()).toHaveLength(1);
  });

  it('appends rows to ai_decision_events once upgraded (create only)', async () => {
    const model = { create: vi.fn(async () => undefined) };
    const log = new DecisionEventLog();
    log.upgradeToDatabase(model);
    await log.record({ ...base, payload: { token: 'secret', events: 2 } });
    expect(model.create).toHaveBeenCalledTimes(1);
    const row = (model.create.mock.calls as unknown as [Record<string, unknown>][])[0]![0];
    expect(row).toMatchObject({ turn_id: 't1', scene_id: 'group:g1', kind: 'speak_gate', reason_code: 'cannot_speak_muted' });
    expect(JSON.parse(String(row.payload))).toEqual({ token: '[redacted]', events: 2 });
  });

  it('never rejects: write failures and invalid input only log', async () => {
    const log = new DecisionEventLog();
    log.upgradeToDatabase({ create: async () => { throw new Error('db down'); } });
    await expect(log.record(base)).resolves.toBeNull();
    await expect(log.record({ ...base, kind: 'nope' as never })).resolves.toBeNull();
    await expect(log.record({ ...base, turnId: '' })).resolves.toBeNull();
    await log.idle();
  });

  it('bounds the in-memory buffer', async () => {
    const log = new DecisionEventLog();
    for (let i = 0; i < DECISION_EVENT_RECENT_LIMIT + 5; i++) await log.record({ ...base, turnId: `t${i}` });
    const recent = log.recent();
    expect(recent).toHaveLength(DECISION_EVENT_RECENT_LIMIT);
    expect(recent.at(-1)?.turnId).toBe(`t${DECISION_EVENT_RECENT_LIMIT + 4}`);
  });

  it('write-path codes are part of the append-only table', () => {
    for (const code of [
      'inbound_addressed', 'ambient_engaged', 'scene_event_high_priority', 'scene_event_rate_limited',
      'scene_event_wake_failed', 'model_completed', 'model_failed', 'model_cancelled', 'model_superseded',
      'outbound_sent', 'outbound_suppressed', 'outbound_failed',
    ]) expect(DECISION_REASON_CODES).toContain(code);
  });
});

describe('DecisionEventLog reads (slice C)', () => {
  it('lists newest-first in memory, filters, and drills a turn oldest-first', async () => {
    let now = 1_000;
    const log = new DecisionEventLog(() => now);
    await log.record({ ...base, turnId: 'a', kind: 'inbound_wake', outcome: 'allow', reasonCode: 'inbound_addressed' });
    now = 2_000;
    await log.record({ ...base, turnId: 'a', kind: 'model_run', outcome: 'allow', reasonCode: 'model_completed', actor: 'model' });
    now = 3_000;
    await log.record({ ...base, turnId: 'b', platform: 'qq' });
    expect((await log.query()).map((r) => r.ts)).toEqual([3_000, 2_000, 1_000]);
    expect((await log.query({ order: 'asc', limit: 2 })).map((r) => r.ts)).toEqual([1_000, 2_000]);
    expect((await log.query({ platform: 'icqq' })).map((r) => r.turnId)).toEqual(['a', 'a']);
    expect((await log.query({ since: 2_000, before: 3_000 })).map((r) => r.ts)).toEqual([2_000]);
    expect((await log.query({ kind: 'model_run', outcome: 'allow' }))).toHaveLength(1);
    expect((await log.turn('a')).map((r) => r.kind)).toEqual(['inbound_wake', 'model_run']);
    expect(await log.turn('')).toEqual([]);
  });

  it('queries ai_decision_events through select().where().orderBy().limit() once upgraded', async () => {
    const calls: unknown[][] = [];
    const rows = [{ id: '1', ts: 5, turn_id: 't', instance_id: 'i', platform: 'icqq', scene_id: 'group:g', kind: 'speak_gate', outcome: 'deny', reason_code: 'cannot_speak_muted', payload: '{"n":1}', actor: 'policy' }];
    const chain: any = {
      where: (c: unknown) => { calls.push(['where', c]); return chain; },
      orderBy: (f: string, d: string) => { calls.push(['orderBy', f, d]); return chain; },
      limit: (n: number) => { calls.push(['limit', n]); return chain; },
      then: (resolve: (v: unknown) => unknown) => resolve(rows),
    };
    const log = new DecisionEventLog();
    log.upgradeToDatabase({ create: async () => undefined, select: () => chain });
    const listed = await log.query({ since: 1, before: 9, platform: 'icqq', sceneId: 'group:g', kind: 'speak_gate', limit: 99_999 });
    expect(listed[0]).toMatchObject({ turnId: 't', reasonCode: 'cannot_speak_muted', payload: { n: 1 } });
    expect(calls).toEqual([
      ['where', { ts: { $gte: 1, $lt: 9 }, platform: 'icqq', scene_id: 'group:g', kind: 'speak_gate' }],
      ['orderBy', 'ts', 'DESC'],
      ['limit', 10_000],
    ]);
    calls.length = 0;
    await log.turn('t');
    expect(calls).toEqual([['where', { turn_id: 't' }], ['orderBy', 'ts', 'ASC'], ['limit', 10_000]]);
    calls.length = 0;
    await log.query();
    expect(calls).toEqual([['orderBy', 'ts', 'DESC'], ['limit', 100]]);
  });

  it('prunes rows older than the retention window (default 14 days) and never rejects on db errors', async () => {
    const DAY = 86_400_000;
    let now = 0;
    const log = new DecisionEventLog(() => now);
    await log.record(base);
    now = 15 * DAY;
    await log.record({ ...base, turnId: 'fresh' });
    expect(await log.prune()).toBe(true);
    expect(log.recent().map((r) => r.turnId)).toEqual(['fresh']);
    const where = vi.fn(async () => 1);
    log.upgradeToDatabase({ create: async () => undefined, delete: () => ({ where, then: (r: any) => r(undefined) }) as never });
    await log.prune(7);
    expect(where).toHaveBeenCalledWith({ ts: { $lt: 15 * DAY - 7 * DAY } });
    log.upgradeToDatabase({ create: async () => undefined, delete: () => ({ where: async () => { throw new Error('locked'); } }) as never });
    await expect(log.prune()).resolves.toBe(false);
    await expect(log.prune(0)).rejects.toThrow(/retentionDays/);
  });
});
