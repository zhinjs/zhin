import { describe, expect, it } from 'vitest';
import { AiControlPlane, AiSessionOps, DecisionEventLog } from '@zhin.js/agent';
import { COLD_FIELD_ACTOR_ID, ColdFieldMonitor, coldFieldKey } from '../../../../src/plugin-runtime/agent/turn/cold-field.js';

const g1 = { platform: 'icqq', conversationId: 'g1' };
const key = coldFieldKey(g1);

async function harness(coldField: Record<string, unknown> = { enabled: true, threshold: 3, durationMs: 60_000 }) {
  let now = 1_000;
  const clock = () => now;
  const ops = new AiSessionOps(clock);
  await ops.set({ expectedRevision: 0, actorId: 'console', sessions: [{ platform: 'icqq', sceneId: 'group:g1', coldField }] });
  const plane = new AiControlPlane(clock);
  const log = new DecisionEventLog(clock);
  const timers: Array<{ run: () => void; ms: number; cleared: boolean }> = [];
  const monitor = new ColdFieldMonitor({
    sessionOps: () => ops,
    controlPlane: () => plane,
    decisionEvents: () => log,
    setTimer: (run, ms) => { const timer = { run, ms, cleared: false }; timers.push(timer); return timer; },
    clearTimer: (handle) => { (handle as { cleared: boolean }).cleared = true; },
  });
  return { ops, plane, log, monitor, timers, advance: (ms: number) => { now += ms; }, now: () => now };
}

const unaddressed = { platform: 'icqq', sceneId: 'group:g1', addressed: false };

describe('ColdFieldMonitor (ADR 0037 §1.3, slice C)', () => {
  it('after N consecutive not-engaged group messages adds a policy mention_only and audits control_change', async () => {
    const h = await harness();
    expect(h.monitor.noteNotEngaged(g1)).toBeUndefined();
    expect(h.monitor.noteNotEngaged(g1)).toBeUndefined();
    expect(h.monitor.count(key)).toBe(2);
    expect(h.plane.gate(unaddressed)).toEqual({ blocked: false });
    const entry = h.monitor.noteNotEngaged(g1);
    expect(entry).toMatchObject({ platform: 'icqq', sceneId: 'group:g1', switch: 'mention_only', source: 'cold_field', actor: 'policy', expiresAt: 61_000 });
    expect(h.monitor.count(key)).toBe(0);
    expect(h.plane.gate(unaddressed)).toMatchObject({ blocked: true, level: 'policy', reasonCode: 'control_mention_only', outcome: 'skip' });
    expect(h.plane.gate({ ...unaddressed, addressed: true })).toEqual({ blocked: false });
    expect(h.plane.snapshot().revision).toBe(0);
    await h.log.idle();
    expect(h.log.recent().map((r) => [r.kind, r.outcome, r.reasonCode, r.actor, r.actorId, r.platform, r.sceneId])).toEqual([
      ['control_change', 'allow', 'cold_field_mention_only_on', 'policy', COLD_FIELD_ACTOR_ID, 'icqq', 'group:g1'],
    ]);
    expect(h.log.recent()[0]!.payload).toMatchObject({ level: 'policy', source: 'cold_field', threshold: 3, count: 3, durationMs: 60_000, expiresAt: 61_000 });
    expect(h.timers.map((timer) => timer.ms)).toEqual([60_001]);
  });

  it('auto-expires: the timer clears the override and audits cold_field_mention_only_expired', async () => {
    const h = await harness();
    for (let i = 0; i < 3; i += 1) h.monitor.noteNotEngaged(g1);
    h.advance(60_001);
    // The gate does not depend on the sweep: it already lets unaddressed messages through.
    expect(h.plane.gate(unaddressed)).toEqual({ blocked: false });
    h.timers[0]!.run();
    expect(h.plane.snapshot().temporary).toEqual([]);
    await h.log.idle();
    expect(h.log.recent().map((r) => [r.reasonCode, r.actor])).toEqual([
      ['cold_field_mention_only_on', 'policy'],
      ['cold_field_mention_only_expired', 'policy'],
    ]);
    expect(h.monitor.sweep()).toEqual([]);
  });

  it('resets on an addressed message, ambient engage, or the Bot speaking', async () => {
    const h = await harness();
    h.monitor.noteNotEngaged(g1);
    h.monitor.noteNotEngaged(g1);
    h.monitor.reset(key);
    h.monitor.noteNotEngaged(g1);
    h.monitor.noteNotEngaged(g1);
    expect(h.monitor.count(key)).toBe(2);
    expect(h.plane.snapshot().temporary).toEqual([]);
    // Other groups count separately.
    h.monitor.noteNotEngaged({ platform: 'icqq', conversationId: 'g2' });
    expect(h.monitor.count('icqq:g2')).toBe(0);
  });

  it('does nothing while coldField is off (default) and drops the counter', async () => {
    const h = await harness({ threshold: 1 });
    expect(h.ops.resolve('icqq', 'group:g1').coldField.enabled).toBe(false);
    for (let i = 0; i < 25; i += 1) expect(h.monitor.noteNotEngaged(g1)).toBeUndefined();
    expect(h.monitor.count(key)).toBe(0);
    expect(h.plane.snapshot().temporary).toEqual([]);
    await h.log.idle();
    expect(h.log.recent()).toEqual([]);
  });

  it('uses the ADR defaults (20 messages, 30 minutes) when only enabled is set', async () => {
    const h = await harness({ enabled: true });
    for (let i = 0; i < 19; i += 1) expect(h.monitor.noteNotEngaged(g1)).toBeUndefined();
    expect(h.monitor.noteNotEngaged(g1)).toMatchObject({ expiresAt: 1_000 + 1_800_000 });
  });

  it('never loosens or rewrites a manual mention_only; no audit when it is already on', async () => {
    const h = await harness({ enabled: true, threshold: 1 });
    await h.plane.set({ expectedRevision: 0, sessions: [{ platform: 'icqq', sceneId: 'group:g1', flags: { mention_only: true } }], actorId: 'op' });
    expect(h.monitor.noteNotEngaged(g1)).toBeUndefined();
    expect(h.plane.snapshot()).toMatchObject({ revision: 1, temporary: [], sessions: [{ flags: { mention_only: true } }] });
    await h.log.idle();
    expect(h.log.recent()).toEqual([]);
  });

  it('dispose clears pending timers and counters', async () => {
    const h = await harness();
    for (let i = 0; i < 3; i += 1) h.monitor.noteNotEngaged(g1);
    h.monitor.dispose();
    expect(h.timers[0]!.cleared).toBe(true);
    expect(h.monitor.noteNotEngaged(g1)).toBeUndefined();
  });

  it('is fail-open: a broken session-ops source never throws into the inbound path', () => {
    const monitor = new ColdFieldMonitor({
      sessionOps: () => { throw new Error('boom'); },
      controlPlane: () => undefined,
    });
    expect(monitor.noteNotEngaged(g1)).toBeUndefined();
  });
});
