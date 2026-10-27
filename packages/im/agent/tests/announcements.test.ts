import { describe, expect, it } from 'vitest';
import {
  AI_ANNOUNCEMENT_MODEL,
  AiAnnouncements,
  AnnouncementRevisionConflictError,
  AnnouncementStateError,
  AnnouncementUnavailableError,
  AnnouncementValidationError,
  DEFAULT_ANNOUNCEMENT_APPROVAL_TTL_MS,
  MAX_ANNOUNCEMENT_ERROR_CHARS,
  announcementContentHash,
  type AnnouncementModel,
} from '../src/announcements.js';
import type { DecisionEventInput } from '../src/decision-events.js';

function harness(options: { ttl?: number } = {}) {
  let now = 1_000_000;
  const events: DecisionEventInput[] = [];
  const store = new AiAnnouncements({
    now: () => now,
    ...(options.ttl ? { approvalTtlMs: options.ttl } : {}),
    audit: () => ({ record: (input) => { events.push(input); } }),
  });
  return { store, events, advance: (ms: number) => { now += ms; }, now: () => now };
}

const base = { platform: 'icqq', sceneId: 'group:123', content: '周六 14:00 活动室集合', createdBy: 'op-1', createdVia: 'console' as const };

function memoryModel() {
  const rows: Record<string, unknown>[] = [];
  let failReads = false;
  const matches = (row: Record<string, unknown>, where: Record<string, unknown>) =>
    Object.entries(where).every(([key, value]) => row[key] === value);
  const model: AnnouncementModel = {
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

describe('ai_announcements schema', () => {
  it('has the ADR 0037 §1.2 columns', () => {
    for (const column of ['id', 'platform', 'scene_id', 'content', 'content_hash', 'status', 'created_by', 'created_via',
      'approved_by', 'approved_at', 'revision', 'error']) {
      expect(AI_ANNOUNCEMENT_MODEL).toHaveProperty(column);
    }
    expect(AI_ANNOUNCEMENT_MODEL.id).toMatchObject({ type: 'text', primary: true });
    expect(AI_ANNOUNCEMENT_MODEL.approved_by.nullable).toBe(true);
    expect(AI_ANNOUNCEMENT_MODEL.approved_at.nullable).toBe(true);
    expect(DEFAULT_ANNOUNCEMENT_APPROVAL_TTL_MS).toBe(24 * 60 * 60 * 1000);
  });
});

describe('AiAnnouncements state machine', () => {
  it('drafts → submits → approves, binding the approval to the content hash, and audits each step', async () => {
    const { store, events } = harness();
    const drafted = await store.create(base);
    expect(drafted.record).toMatchObject({ status: 'draft', revision: 1, contentHash: announcementContentHash(base.content), approvedHash: null });
    const submitted = await store.submit({ id: drafted.record.id, expectedRevision: 1, actorId: 'op-1' });
    expect(submitted.record.status).toBe('pending');
    const approved = await store.approve({ id: drafted.record.id, expectedRevision: 2, actorId: 'boss' });
    expect(approved.record).toMatchObject({ status: 'approved', approvedBy: 'boss', approvedAt: expect.any(Number), revision: 3 });
    expect(approved.record.approvedHash).toBe(approved.record.contentHash);
    expect(events.map((event) => [event.kind, event.reasonCode, event.outcome, event.actor])).toEqual([
      ['announcement', 'announcement_drafted', 'allow', 'operator'],
      ['announcement', 'announcement_submitted', 'defer', 'operator'],
      ['announcement', 'announcement_approved', 'allow', 'operator'],
    ]);
    expect(events[2]).toMatchObject({ platform: 'icqq', sceneId: 'group:123', actorId: 'boss', payload: { from: 'pending', to: 'approved' } });
  });

  it('editing any non-terminal announcement returns it to draft, recomputes the hash and drops the approval', async () => {
    const { store } = harness();
    const { record } = await store.create(base);
    await store.submit({ id: record.id, expectedRevision: 1, actorId: 'op-1' });
    await store.approve({ id: record.id, expectedRevision: 2, actorId: 'boss' });
    const edited = await store.edit({ id: record.id, expectedRevision: 3, actorId: 'op-1', content: '改到周日' });
    expect(edited.record).toMatchObject({ status: 'draft', approvedHash: null, approvedBy: null, approvedAt: null });
    expect(edited.record.contentHash).toBe(announcementContentHash('改到周日'));
    expect(edited.reasonCode).toBe('announcement_drafted');
  });

  it('only moves forward: illegal transitions throw and terminal rows cannot be edited', async () => {
    const { store } = harness();
    const { record } = await store.create(base);
    await expect(store.approve({ id: record.id, expectedRevision: 1, actorId: 'boss' })).rejects.toBeInstanceOf(AnnouncementStateError);
    await expect(store.resend({ id: record.id, expectedRevision: 1, actorId: 'boss' })).rejects.toBeInstanceOf(AnnouncementStateError);
    await expect(store.markSent({ id: record.id, expectedRevision: 1 })).rejects.toBeInstanceOf(AnnouncementStateError);
    await store.submit({ id: record.id, expectedRevision: 1, actorId: 'op-1' });
    const rejected = await store.reject({ id: record.id, expectedRevision: 2, actorId: 'boss', reason: '不合适' });
    expect(rejected.record).toMatchObject({ status: 'rejected', error: '不合适' });
    await expect(store.edit({ id: record.id, expectedRevision: 3, actorId: 'op-1', content: 'x' })).rejects.toBeInstanceOf(AnnouncementStateError);
    await expect(store.submit({ id: record.id, expectedRevision: 3, actorId: 'op-1' })).rejects.toBeInstanceOf(AnnouncementStateError);
  });

  it('rejects stale revisions without writing', async () => {
    const { store, events } = harness();
    const { record } = await store.create(base);
    await store.submit({ id: record.id, expectedRevision: 1, actorId: 'op-1' });
    await expect(store.approve({ id: record.id, expectedRevision: 1, actorId: 'boss' })).rejects.toBeInstanceOf(AnnouncementRevisionConflictError);
    expect((await store.get(record.id))?.status).toBe('pending');
    expect(events.filter((event) => event.reasonCode === 'announcement_approved')).toHaveLength(0);
  });

  it('expires pending announcements after the approval window (default 24h) and refuses to approve them', async () => {
    const { store, events, advance } = harness();
    const { record } = await store.create(base);
    await store.submit({ id: record.id, expectedRevision: 1, actorId: 'op-1' });
    advance(DEFAULT_ANNOUNCEMENT_APPROVAL_TTL_MS - 1);
    expect(await store.expireDue()).toHaveLength(0);
    advance(1);
    await expect(store.approve({ id: record.id, expectedRevision: 2, actorId: 'boss' })).rejects.toBeInstanceOf(AnnouncementStateError);
    expect((await store.get(record.id))?.status).toBe('expired');
    const expired = events.filter((event) => event.reasonCode === 'announcement_expired');
    expect(expired).toHaveLength(1);
    expect(expired[0]).toMatchObject({ kind: 'announcement', outcome: 'skip', actor: 'policy' });
  });

  it('send failure goes to failed with a clipped error; resend needs a fresh approval', async () => {
    const { store, events } = harness();
    const { record } = await store.create(base);
    await store.submit({ id: record.id, expectedRevision: 1, actorId: 'op-1' });
    await store.approve({ id: record.id, expectedRevision: 2, actorId: 'boss' });
    const failed = await store.markFailed({ id: record.id, expectedRevision: 3, error: 'x'.repeat(500) });
    expect(failed.record.status).toBe('failed');
    expect(Array.from(failed.record.error ?? '')).toHaveLength(MAX_ANNOUNCEMENT_ERROR_CHARS);
    expect(events.at(-1)).toMatchObject({ reasonCode: 'announcement_send_failed', outcome: 'error', actor: 'system' });
    const resent = await store.resend({ id: record.id, expectedRevision: 4, actorId: 'boss' });
    expect(resent.record).toMatchObject({ status: 'pending', approvedHash: null, approvedBy: null });
    expect(events.at(-1)).toMatchObject({ reasonCode: 'announcement_resend', actor: 'operator', actorId: 'boss' });
    const again = await store.approve({ id: record.id, expectedRevision: 5, actorId: 'boss' });
    const sent = await store.markSent({ id: again.record.id, expectedRevision: 6 });
    expect(sent.record).toMatchObject({ status: 'sent', sentAt: expect.any(Number) });
    await expect(store.resend({ id: record.id, expectedRevision: 7, actorId: 'boss' })).rejects.toBeInstanceOf(AnnouncementStateError);
  });

  it('validates input', async () => {
    const { store } = harness();
    await expect(store.create({ ...base, sceneId: '123' })).rejects.toBeInstanceOf(AnnouncementValidationError);
    await expect(store.create({ ...base, content: '  ' })).rejects.toBeInstanceOf(AnnouncementValidationError);
    await expect(store.create({ ...base, content: 'x'.repeat(2_001) })).rejects.toBeInstanceOf(AnnouncementValidationError);
  });

  it('lists a session newest first', async () => {
    const { store, advance } = harness();
    const first = await store.create(base);
    advance(10);
    const second = await store.create({ ...base, content: '第二条' });
    await store.create({ ...base, sceneId: 'group:999' });
    const listed = await store.list({ platform: 'icqq', sceneId: 'group:123' });
    expect(listed.map((row) => row.id)).toEqual([second.record.id, first.record.id]);
  });

  it('persists through the table and surfaces read failures as unavailable', async () => {
    const db = memoryModel();
    const { store, now } = harness();
    await store.upgradeToDatabase(db.model);
    const { record } = await store.create(base);
    await store.submit({ id: record.id, expectedRevision: 1, actorId: 'op-1' });
    expect(db.rows).toHaveLength(1);
    expect(db.rows[0]).toMatchObject({ status: 'pending', revision: 2, scene_id: 'group:123', created_via: 'console' });
    const reopened = new AiAnnouncements({ now });
    await reopened.upgradeToDatabase(db.model);
    expect((await reopened.get(record.id))?.status).toBe('pending');
    db.failReads(true);
    await expect(reopened.get(record.id)).rejects.toBeInstanceOf(AnnouncementUnavailableError);
  });
});
