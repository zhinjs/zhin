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
