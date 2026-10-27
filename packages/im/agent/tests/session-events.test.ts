import { describe, expect, it } from 'vitest';
import {
  AI_SESSION_EVENT_MODEL,
  AiSessionEvents,
  DEFAULT_SESSION_EVENT_GRACE_MS,
  DEFAULT_SESSION_EVENT_TEMPLATE,
  SessionEventRevisionConflictError,
  SessionEventStateError,
  SessionEventUnavailableError,
  SessionEventValidationError,
  formatSessionEventAt,
  formatSessionEventIn,
  pendingSessionEventReminders,
  renderSessionEventTemplate,
  sessionEventFromRow,
  sessionEventOffsets,
  type SessionEventModel,
} from '../src/session-events.js';
import type { DecisionEventInput } from '../src/decision-events.js';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
// 2026-10-27T10:00:00Z
const NOW = Date.UTC(2026, 9, 27, 10, 0, 0);

function harness() {
  let now = NOW;
  const events: DecisionEventInput[] = [];
  const store = new AiSessionEvents({
    now: () => now,
    audit: () => ({ record: (input) => { events.push(input); } }),
  });
  return { store, events, advance: (ms: number) => { now += ms; }, now: () => now };
}

const base = { platform: 'icqq', sceneId: 'group:123', title: '社团周会', createdBy: 'op-1', createdVia: 'console' as const };

function memoryModel() {
  const rows: Record<string, unknown>[] = [];
  let failReads = false;
  const matches = (row: Record<string, unknown>, where: Record<string, unknown>) =>
    Object.entries(where).every(([key, value]) => row[key] === value);
  const model: SessionEventModel = {
    select: () => ({
      where: async (where) => {
        if (failReads) throw new Error('db down');
        return rows.filter((row) => matches(row, where)).map((row) => ({ ...row }));
      },
    }),
    create: async (row) => { rows.push({ ...row }); },
    update: (row) => ({
      where: async (where) => {
        for (const item of rows) if (matches(item, where)) Object.assign(item, row);
      },
    }),
  };
  return { model, rows, failReads: (value: boolean) => { failReads = value; } };
}

describe('ai_session_events schema', () => {
  it('has the ADR 0037 §2 columns and defaults', () => {
    for (const column of ['id', 'platform', 'scene_id', 'title', 'at', 'remind_before', 'template', 'status', 'fired', 'created_by', 'revision']) {
      expect(AI_SESSION_EVENT_MODEL).toHaveProperty(column);
    }
    expect(AI_SESSION_EVENT_MODEL.id).toMatchObject({ type: 'text', primary: true });
    expect(AI_SESSION_EVENT_MODEL.at.type).toBe('bigint');
    expect(DEFAULT_SESSION_EVENT_GRACE_MS).toBe(10 * 60 * 1000);
  });
});

describe('AiSessionEvents', () => {
  it('creates a scheduled event, always reminds at `at`, and audits schedule_event_created', async () => {
    const { store, events } = harness();
    const { record } = await store.create({ ...base, at: NOW + 2 * DAY, remindBefore: [HOUR, DAY, HOUR] });
    expect(record).toMatchObject({ status: 'scheduled', revision: 1, remindBefore: [DAY, HOUR], fired: [] });
    expect(sessionEventOffsets(record)).toEqual([DAY, HOUR, 0]);
    expect(pendingSessionEventReminders(record).map((item) => item.fireAt)).toEqual([NOW + DAY, NOW + 2 * DAY - HOUR, NOW + 2 * DAY]);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: 'schedule', outcome: 'allow', reasonCode: 'schedule_event_created', actor: 'operator', actorId: 'op-1', platform: 'icqq', sceneId: 'group:123' });
    expect(events[0]!.payload).toMatchObject({ eventId: record.id, from: null, to: 'scheduled' });
  });

  it('marks offsets that are already in the past as fired at creation (no send, no missed)', async () => {
    const { store, events } = harness();
    const { record } = await store.create({ ...base, at: NOW + 30 * 60 * 1000, remindBefore: [DAY] });
    expect(record.fired).toEqual([DAY]);
    expect(pendingSessionEventReminders(record).map((item) => item.offset)).toEqual([0]);
    expect(events[0]!.payload).toMatchObject({ skippedOffsets: [DAY] });
  });

  it('validates title, time, offsets and scene', async () => {
    const { store } = harness();
    await expect(store.create({ ...base, title: 'x'.repeat(61), at: NOW + HOUR })).rejects.toBeInstanceOf(SessionEventValidationError);
    await expect(store.create({ ...base, at: NOW - 1 })).rejects.toBeInstanceOf(SessionEventValidationError);
    await expect(store.create({ ...base, at: NOW + 400 * DAY })).rejects.toBeInstanceOf(SessionEventValidationError);
    await expect(store.create({ ...base, at: NOW + HOUR, remindBefore: [-1] })).rejects.toBeInstanceOf(SessionEventValidationError);
    await expect(store.create({ ...base, at: NOW + HOUR, remindBefore: [1, 2, 3, 4, 5, 6] })).rejects.toBeInstanceOf(SessionEventValidationError);
    await expect(store.create({ ...base, sceneId: 'private:1', at: NOW + HOUR })).rejects.toBeInstanceOf(SessionEventValidationError);
  });

  it('updates with revision checks, recomputes fired on timing changes, and refuses terminal events', async () => {
    const { store, events } = harness();
    const { record } = await store.create({ ...base, at: NOW + DAY, remindBefore: [HOUR] });
    await store.markFired({ id: record.id, offsets: [HOUR] });
    const fired = (await store.get(record.id))!;
    expect(fired.fired).toEqual([HOUR]);
    await expect(store.update({ id: record.id, expectedRevision: 1, actorId: 'op-2', title: 'x' })).rejects.toBeInstanceOf(SessionEventRevisionConflictError);
    const { record: moved } = await store.update({ id: record.id, expectedRevision: fired.revision, actorId: 'op-2', at: NOW + 2 * DAY });
    expect(moved).toMatchObject({ at: NOW + 2 * DAY, fired: [], updatedBy: 'op-2' });
    expect(events.at(-1)).toMatchObject({ kind: 'schedule', reasonCode: 'schedule_event_updated', actorId: 'op-2' });
    const { record: cancelled } = await store.cancel({ id: record.id, expectedRevision: moved.revision, actorId: 'op-2' });
    expect(cancelled.status).toBe('cancelled');
    expect(events.at(-1)).toMatchObject({ reasonCode: 'schedule_event_cancelled', payload: expect.objectContaining({ from: 'scheduled', to: 'cancelled' }) });
    await expect(store.update({ id: record.id, expectedRevision: cancelled.revision, actorId: 'op-2', title: 'y' })).rejects.toBeInstanceOf(SessionEventStateError);
    expect(pendingSessionEventReminders(cancelled)).toEqual([]);
  });

  it('marks the event done once every offset fired, and never resurrects a cancelled event', async () => {
    const { store } = harness();
    const { record } = await store.create({ ...base, at: NOW + DAY, remindBefore: [HOUR] });
    expect(await store.markFired({ id: record.id, offsets: [HOUR] })).toMatchObject({ record: { status: 'scheduled' }, claimed: [HOUR] });
    // 同一偏移只能认领一次（至多发一次）。
    expect((await store.markFired({ id: record.id, offsets: [HOUR] })).claimed).toEqual([]);
    expect(await store.markFired({ id: record.id, offsets: [0, 12345] })).toMatchObject({ record: { status: 'done' }, claimed: [0] });
    expect(await store.listScheduled()).toEqual([]);
    const other = (await store.create({ ...base, at: NOW + DAY })).record;
    await store.cancel({ id: other.id, expectedRevision: other.revision, actorId: 'op' });
    expect(await store.markFired({ id: other.id, offsets: [0] })).toMatchObject({ record: { status: 'cancelled' }, claimed: [] });
  });

  it('notifies subscribers on create / update / cancel / database upgrade', async () => {
    const { store } = harness();
    let calls = 0;
    const off = store.subscribe(() => { calls += 1; });
    const { record } = await store.create({ ...base, at: NOW + DAY });
    await store.update({ id: record.id, expectedRevision: record.revision, actorId: 'op', title: '改名' });
    await store.upgradeToDatabase(memoryModel().model);
    expect(calls).toBe(3);
    off();
    await store.create({ ...base, at: NOW + DAY });
    expect(calls).toBe(3);
  });

  it('persists through the table and fails closed when it cannot read', async () => {
    const { store } = harness();
    const db = memoryModel();
    await store.upgradeToDatabase(db.model);
    const { record } = await store.create({ ...base, at: NOW + DAY, remindBefore: [HOUR] });
    expect(db.rows).toHaveLength(1);
    expect(db.rows[0]).toMatchObject({ remind_before: JSON.stringify([HOUR]), fired: '[]', status: 'scheduled' });
    expect(sessionEventFromRow(db.rows[0]!)).toMatchObject({ id: record.id, remindBefore: [HOUR], fired: [] });
    const list = await store.list({ platform: 'icqq', sceneId: 'group:123' });
    expect(list.map((item) => item.id)).toEqual([record.id]);
    db.failReads(true);
    await expect(store.listScheduled()).rejects.toBeInstanceOf(SessionEventUnavailableError);
  });
});

describe('session event template', () => {
  it('renders {title} {at} {in} in the instance timezone and keeps unknown vars', () => {
    const at = Date.UTC(2026, 9, 31, 6, 30);
    expect(formatSessionEventAt(at, 'Asia/Shanghai')).toBe('2026-10-31 14:30');
    expect(formatSessionEventAt(at, 'Not/AZone')).toBe('2026-10-31 14:30');
    expect(formatSessionEventIn(0)).toBe('现在');
    expect(formatSessionEventIn(DAY)).toBe('1 天后');
    expect(formatSessionEventIn(HOUR)).toBe('1 小时后');
    expect(formatSessionEventIn(30 * 60 * 1000)).toBe('30 分钟后');
    expect(formatSessionEventIn(90 * 60 * 1000)).toBe('1 小时 30 分钟后');
    expect(renderSessionEventTemplate('', { title: '周会', at, offset: HOUR, timezone: 'Asia/Shanghai' }).text)
      .toBe(DEFAULT_SESSION_EVENT_TEMPLATE.replace('{title}', '周会').replace('{at}', '2026-10-31 14:30').replace('{in}', '1 小时后'));
    const custom = renderSessionEventTemplate('{title} {in} {where}', { title: '周会', at, offset: 0 });
    expect(custom).toEqual({ text: '周会 现在 {where}', unknownVars: ['where'] });
  });
});
