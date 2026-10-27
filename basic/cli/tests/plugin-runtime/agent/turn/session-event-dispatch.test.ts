import { describe, expect, it, vi } from 'vitest';
import { AiControlPlane, AiSessionEvents, DecisionEventLog, type SessionEventTimer, type SessionProfileStore } from '@zhin.js/agent';
import { SessionEventDispatcher } from '../../../../src/plugin-runtime/agent/turn/session-event-dispatch.js';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
// 2026-10-27T10:00:00Z = 18:00 Asia/Shanghai
const START = Date.UTC(2026, 9, 27, 10, 0, 0);

function fakeTimer() {
  const armed: Array<{ id: string; at: number; run: () => void | Promise<void> }> = [];
  const timer: SessionEventTimer = {
    at: (id, at, run) => {
      const entry = { id, at, run };
      armed.push(entry);
      return () => { const index = armed.indexOf(entry); if (index >= 0) armed.splice(index, 1); };
    },
    dispose: () => { armed.splice(0); },
  };
  return { timer, armed };
}

function harness(options: { control?: AiControlPlane; sessions?: SessionProfileStore; send?: () => Promise<any>; graceMs?: number } = {}) {
  let now = START;
  const log = new DecisionEventLog(() => now);
  const store = new AiSessionEvents({ now: () => now, audit: () => log });
  const send = vi.fn(options.send ?? (async () => ({ status: 'sent' as const })));
  const onSpoke = vi.fn();
  const { timer, armed } = fakeTimer();
  const dispatcher = new SessionEventDispatcher({
    events: () => store,
    controlPlane: () => options.control,
    sessions: () => options.sessions,
    decisionEvents: () => log,
    send,
    onSpoke,
    now: () => now,
    timer,
    timezone: 'Asia/Shanghai',
    ...(options.graceMs !== undefined ? { graceMs: options.graceMs } : {}),
  });
  const codes = async () => {
    await log.idle();
    return log.recent().map((row) => `${row.kind}:${row.outcome}:${row.reasonCode}`);
  };
  const create = (input: { at: number; remindBefore?: number[]; title?: string; sceneId?: string; template?: string }) => store.create({
    platform: 'icqq', sceneId: input.sceneId ?? 'group:123', title: input.title ?? '社团周会', at: input.at,
    ...(input.remindBefore ? { remindBefore: input.remindBefore } : {}),
    ...(input.template ? { template: input.template } : {}),
    createdBy: 'op', createdVia: 'console', endpoint: '10086',
  });
  return { log, store, send, onSpoke, dispatcher, armed, codes, create, setNow: (ms: number) => { now = ms; }, now: () => now };
}

describe('SessionEventDispatcher (ADR 0037 slice D)', () => {
  it('reminds once before and once at the start with the default template, without a model', async () => {
    const h = harness();
    const { record } = await h.create({ at: START + 2 * HOUR, remindBefore: [HOUR] });
    await h.dispatcher.tick();
    expect(h.send).not.toHaveBeenCalled();
    // One timer armed for the next reminder minute.
    expect(h.armed.map((entry) => entry.at)).toEqual([START + HOUR]);

    h.setNow(START + HOUR);
    await h.dispatcher.tick();
    expect(h.send).toHaveBeenCalledTimes(1);
    expect(h.send).toHaveBeenLastCalledWith({ platform: 'icqq', endpoint: '10086', scope: 'group', id: '123' }, '【日程提醒】社团周会：2026-10-27 20:00（1 小时后）');
    expect(h.onSpoke).toHaveBeenCalledWith('icqq:123');
    expect(h.armed.map((entry) => entry.at)).toEqual([START + 2 * HOUR]);

    h.setNow(START + 2 * HOUR);
    await h.dispatcher.tick();
    expect(h.send).toHaveBeenCalledTimes(2);
    expect(h.send).toHaveBeenLastCalledWith(expect.anything(), '【日程提醒】社团周会：2026-10-27 20:00（现在）');
    expect((await h.store.get(record.id))!.status).toBe('done');
    expect(h.armed).toEqual([]);

    // Ticking again never resends.
    await h.dispatcher.tick();
    expect(h.send).toHaveBeenCalledTimes(2);
    const rows = await h.codes();
    expect(rows.filter((row) => row === 'inbound_wake:allow:schedule_wake_fired')).toHaveLength(2);
    expect(rows.filter((row) => row === 'schedule:allow:schedule_wake_fired')).toHaveLength(2);
    expect(rows.filter((row) => row === 'outbound:allow:outbound_sent')).toHaveLength(2);
  });

  it('fires through the armed timer (ScheduleEngine port) and re-arms on changes', async () => {
    const h = harness();
    h.dispatcher.start();
    const { record } = await h.create({ at: START + HOUR });
    await h.dispatcher.tick();
    expect(h.armed.map((entry) => entry.at)).toEqual([START + HOUR]);
    await h.store.update({ id: record.id, expectedRevision: record.revision, actorId: 'op', at: START + 3 * HOUR });
    await h.dispatcher.tick();
    expect(h.armed.map((entry) => entry.at)).toEqual([START + 3 * HOUR]);
    h.setNow(START + 3 * HOUR);
    await h.armed[0]!.run();
    await h.dispatcher.tick();
    expect(h.send).toHaveBeenCalledTimes(1);
    h.dispatcher.dispose();
  });

  it('muted / emergency_stop: skips, records the offset as fired, never resends', async () => {
    const control = new AiControlPlane();
    await control.set({ expectedRevision: 0, actorId: 'op', sessions: [{ platform: 'icqq', sceneId: 'group:123', flags: { muted: true } }] });
    const h = harness({ control });
    const { record } = await h.create({ at: START + HOUR });
    h.setNow(START + HOUR);
    const [result] = await h.dispatcher.tick();
    expect(result).toMatchObject({ kind: 'skipped', reason: 'control:muted' });
    expect(h.send).not.toHaveBeenCalled();
    expect((await h.store.get(record.id))!).toMatchObject({ status: 'done', fired: [0] });
    // Unmute: no catch-up.
    await control.set({ expectedRevision: 1, actorId: 'op', sessions: [{ platform: 'icqq', sceneId: 'group:123', flags: { muted: false } }] });
    await h.dispatcher.tick();
    expect(h.send).not.toHaveBeenCalled();
    const rows = await h.codes();
    expect(rows).toContain('inbound_wake:allow:schedule_wake_fired');
    expect(rows).toContain('control_gate:deny:control_muted_session');
    expect(rows).toContain('schedule:skip:control_muted_session');

    const stop = new AiControlPlane();
    await stop.set({ expectedRevision: 0, actorId: 'op', instance: { emergency_stop: true } });
    const h2 = harness({ control: stop });
    await h2.create({ at: START + HOUR });
    h2.setNow(START + HOUR);
    await h2.dispatcher.tick();
    expect(h2.send).not.toHaveBeenCalled();
    expect(await h2.codes()).toContain('schedule:skip:control_emergency_stop');
  });

  it('mention_only (incl. cold-field) does not block a schedule reminder (addressed)', async () => {
    const control = new AiControlPlane();
    await control.set({ expectedRevision: 0, actorId: 'op', sessions: [{ platform: 'icqq', sceneId: 'group:123', flags: { mention_only: true } }] });
    const h = harness({ control });
    await h.create({ at: START + HOUR });
    h.setNow(START + HOUR);
    await h.dispatcher.tick();
    expect(h.send).toHaveBeenCalledTimes(1);
  });

  it('session-gate: skips when the bot cannot speak, after the control plane', async () => {
    const sessions = { get: async () => ({ restriction: '', restrictionUntil: 0, muteUntil: START + 2 * HOUR, mutedAll: false, botRole: 'member' }) } as unknown as SessionProfileStore;
    const h = harness({ sessions });
    await h.create({ at: START + HOUR });
    h.setNow(START + HOUR);
    const [result] = await h.dispatcher.tick();
    expect(result).toMatchObject({ kind: 'skipped', reason: 'cannot_speak:muted' });
    expect(h.send).not.toHaveBeenCalled();
    const rows = await h.codes();
    expect(rows.indexOf('inbound_wake:allow:schedule_wake_fired')).toBeLessThan(rows.indexOf('speak_gate:deny:cannot_speak_muted'));
    expect(rows).toContain('schedule:skip:cannot_speak_muted');
  });

  it('crash grace: missed beyond 10 minutes → schedule_wake_missed, within grace → sent', async () => {
    const h = harness();
    expect(h.dispatcher.graceMs).toBe(10 * MINUTE);
    await h.create({ at: START + HOUR, title: '早到的' });
    await h.create({ at: START + 2 * HOUR, title: '晚到的', sceneId: 'group:456' });
    // "Restart" 2h05m later: the first is 65 minutes late, the second 5 minutes late.
    h.setNow(START + 2 * HOUR + 5 * MINUTE);
    const results = await h.dispatcher.tick();
    expect(results.map((result) => result.kind).sort()).toEqual(['missed', 'sent']);
    expect(h.send).toHaveBeenCalledTimes(1);
    expect(h.send).toHaveBeenCalledWith(expect.objectContaining({ id: '456' }), expect.stringContaining('晚到的'));
    const rows = await h.codes();
    expect(rows).toContain('schedule:skip:schedule_wake_missed');
    expect(rows).toContain('schedule:allow:schedule_wake_fired');
  });

  it('merges reminders for the same session in the same minute into one message', async () => {
    const h = harness();
    await h.create({ at: START + HOUR, title: '活动 A' });
    await h.create({ at: START + HOUR + 30_000, title: '活动 B' });
    await h.create({ at: START + HOUR, title: '别的群', sceneId: 'group:456' });
    h.setNow(START + HOUR);
    await h.dispatcher.tick();
    expect(h.send).toHaveBeenCalledTimes(2);
    const merged = h.send.mock.calls.find((call) => (call[0] as { id: string }).id === '123')!;
    expect(merged[1]).toBe('【日程提醒】活动 A：2026-10-27 19:00（现在）\n【日程提醒】活动 B：2026-10-27 19:00（现在）');
    const rows = await h.codes();
    expect(rows.filter((row) => row === 'schedule:allow:schedule_wake_merged')).toHaveLength(2);
    expect(rows.filter((row) => row === 'outbound:allow:outbound_sent')).toHaveLength(2);
  });

  it('does not retry a failed send', async () => {
    const h = harness({ send: async () => { throw new Error('endpoint offline'); } });
    const { record } = await h.create({ at: START + HOUR });
    h.setNow(START + HOUR);
    const [result] = await h.dispatcher.tick();
    expect(result).toMatchObject({ kind: 'failed' });
    h.setNow(START + HOUR + 5 * MINUTE);
    await h.dispatcher.tick();
    expect(h.send).toHaveBeenCalledTimes(1);
    expect((await h.store.get(record.id))!.status).toBe('done');
    expect(await h.codes()).toContain('schedule:error:outbound_failed');
  });

  it('never double-sends when two route generations tick concurrently', async () => {
    const h = harness();
    await h.create({ at: START + HOUR });
    const other = new SessionEventDispatcher({ events: () => h.store, send: h.send, now: h.now, timer: fakeTimer().timer });
    h.setNow(START + HOUR);
    await Promise.all([h.dispatcher.tick(), other.tick()]);
    expect(h.send).toHaveBeenCalledTimes(1);
  });

  it('skips cancelled events', async () => {
    const h = harness();
    const { record } = await h.create({ at: START + HOUR });
    await h.store.cancel({ id: record.id, expectedRevision: record.revision, actorId: 'op' });
    h.setNow(START + HOUR);
    await h.dispatcher.tick();
    expect(h.send).not.toHaveBeenCalled();
  });
});
