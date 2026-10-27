import { describe, expect, it, vi } from 'vitest';
import { AiAnnouncements, AiControlPlane, DecisionEventLog, type SessionProfileStore } from '@zhin.js/agent';
import { ToolApprovalQueue } from '@zhin.js/agent/security';
import { AnnouncementDispatcher, ANNOUNCEMENT_SEND_TOOL_NAME } from '../../../../src/plugin-runtime/agent/turn/announcement-dispatch.js';

async function approved(store: AiAnnouncements, content = '周六 14:00 活动室集合') {
  const { record } = await store.create({ platform: 'icqq', sceneId: 'group:123', content, createdBy: 'op', createdVia: 'console', endpoint: '10086' });
  await store.submit({ id: record.id, expectedRevision: 1, actorId: 'op' });
  return (await store.approve({ id: record.id, expectedRevision: 2, actorId: 'boss' })).record;
}

function harness(options: {
  control?: AiControlPlane;
  sessions?: SessionProfileStore;
  send?: () => Promise<any>;
  approvals?: ToolApprovalQueue;
} = {}) {
  const log = new DecisionEventLog();
  const store = new AiAnnouncements({ audit: () => log });
  const sendNotice = vi.fn(options.send ?? (async () => ({ status: 'sent' as const })));
  const dispatcher = new AnnouncementDispatcher({
    announcements: () => store,
    controlPlane: () => options.control,
    sessions: () => options.sessions,
    decisionEvents: () => log,
    approvals: () => options.approvals,
    sendNotice,
  });
  const codes = async () => {
    await log.idle();
    return log.recent().map((row) => `${row.kind}:${row.outcome}:${row.reasonCode}`);
  };
  return { log, store, sendNotice, dispatcher, codes };
}

describe('AnnouncementDispatcher (ADR 0037 slice B)', () => {
  it('sends an approved announcement once, using the approval as the hard-gate approval', async () => {
    const { store, sendNotice, dispatcher, codes } = harness();
    const record = await approved(store);
    const result = await dispatcher.dispatch(record.id);
    expect(result).toMatchObject({ kind: 'sent', record: { status: 'sent' } });
    expect(sendNotice).toHaveBeenCalledTimes(1);
    expect(sendNotice).toHaveBeenCalledWith({ platform: 'icqq', endpoint: '10086', scope: 'group', id: '123' }, '周六 14:00 活动室集合');
    expect(await codes()).toEqual(expect.arrayContaining([
      'tool_approval:allow:tool_approval_approved',
      'tool_hard_gate:allow:tool_approval_approved',
      'outbound:allow:outbound_sent',
      'announcement:allow:announcement_sent',
    ]));
    // No approval card was raised: nothing asked for a second approval.
    expect((await codes()).some((code) => code.includes('tool_approval_requested'))).toBe(false);
    expect(ANNOUNCEMENT_SEND_TOOL_NAME).toBe('send_group_notice');
  });

  it('does not raise a second approval card even with an approval queue in the host', async () => {
    const queue = new ToolApprovalQueue();
    const enqueue = vi.spyOn(queue, 'enqueue');
    const { store, dispatcher } = harness({ approvals: queue });
    const record = await approved(store);
    await expect(dispatcher.dispatch(record.id)).resolves.toMatchObject({ kind: 'sent' });
    expect(enqueue).not.toHaveBeenCalled();
    expect(queue.list()).toHaveLength(0);
  });

  it('only sends approved announcements', async () => {
    const { store, sendNotice, dispatcher } = harness();
    const { record } = await store.create({ platform: 'icqq', sceneId: 'group:123', content: 'x', createdBy: 'op', createdVia: 'console' });
    await expect(dispatcher.dispatch(record.id)).resolves.toMatchObject({ kind: 'not_approved' });
    expect(sendNotice).not.toHaveBeenCalled();
  });

  it('refuses with announcement_hash_mismatch when the approved content was changed behind the state machine', async () => {
    const { store, sendNotice, dispatcher, codes } = harness();
    const record = await approved(store);
    // Simulate a row edited directly in the table (content changed, status left approved).
    const tampered = { ...record, content: '改过的正文' };
    vi.spyOn(store, 'get').mockResolvedValueOnce(tampered);
    const result = await dispatcher.dispatch(record.id);
    expect(result).toMatchObject({ kind: 'failed', reason: 'content_hash_mismatch' });
    expect(sendNotice).not.toHaveBeenCalled();
    expect(await codes()).toContain('announcement:deny:announcement_hash_mismatch');
    expect((await store.get(record.id))?.status).toBe('failed');
  });

  it('skips (fail closed, no queue) when the control plane mutes the session', async () => {
    const control = new AiControlPlane();
    await control.set({ expectedRevision: 0, actorId: 'op', sessions: [{ platform: 'icqq', sceneId: 'group:123', flags: { muted: true } }] });
    const { store, sendNotice, dispatcher, codes } = harness({ control });
    const record = await approved(store);
    const result = await dispatcher.dispatch(record.id);
    expect(result).toMatchObject({ kind: 'failed' });
    expect(sendNotice).not.toHaveBeenCalled();
    const rows = await codes();
    expect(rows).toContain('control_gate:deny:control_muted_session');
    expect(rows).toContain('announcement:skip:control_muted_session');
    expect((await store.get(record.id))?.status).toBe('failed');
  });

  it('mention_only does not block an approved announcement', async () => {
    const control = new AiControlPlane();
    await control.set({ expectedRevision: 0, actorId: 'op', sessions: [{ platform: 'icqq', sceneId: 'group:123', flags: { mention_only: true } }] });
    const { store, sendNotice, dispatcher } = harness({ control });
    const record = await approved(store);
    await expect(dispatcher.dispatch(record.id)).resolves.toMatchObject({ kind: 'sent' });
    expect(sendNotice).toHaveBeenCalledTimes(1);
  });

  it('skips when the bot cannot speak in the group (session gate)', async () => {
    const sessions = { get: async () => ({ restriction: '', restrictionUntil: 0, muteUntil: Date.now() + 60_000, mutedAll: false, botRole: 'member' }) } as unknown as SessionProfileStore;
    const { store, sendNotice, dispatcher, codes } = harness({ sessions });
    const record = await approved(store);
    await expect(dispatcher.dispatch(record.id)).resolves.toMatchObject({ kind: 'failed', reason: 'blocked:muted' });
    expect(sendNotice).not.toHaveBeenCalled();
    expect(await codes()).toContain('speak_gate:deny:cannot_speak_muted');
  });

  it('marks failed on a platform error and never retries automatically', async () => {
    vi.useFakeTimers();
    try {
      const { store, sendNotice, dispatcher, codes } = harness({ send: async () => { throw new Error('no admin permission'); } });
      const record = await approved(store);
      const result = await dispatcher.dispatch(record.id);
      expect(result).toMatchObject({ kind: 'failed', record: { status: 'failed', error: 'failed:no admin permission' } });
      await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
      expect(sendNotice).toHaveBeenCalledTimes(1);
      // A second dispatch is a no-op: failed is not approved.
      await expect(dispatcher.dispatch(record.id)).resolves.toMatchObject({ kind: 'not_approved' });
      expect(sendNotice).toHaveBeenCalledTimes(1);
      const rows = await codes();
      expect(rows).toContain('outbound:error:outbound_failed');
      expect(rows).toContain('announcement:error:announcement_send_failed');
    } finally {
      vi.useRealTimers();
    }
  });

  it('dedupes concurrent dispatches of the same announcement', async () => {
    const { store, sendNotice, dispatcher } = harness();
    const record = await approved(store);
    await Promise.all([dispatcher.dispatch(record.id), dispatcher.dispatch(record.id)]);
    expect(sendNotice).toHaveBeenCalledTimes(1);
  });
});
