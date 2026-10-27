import { describe, expect, it, vi } from 'vitest';
import { AiAnnouncements, DecisionEventLog } from '@zhin.js/agent';
import { AssistantStatus } from '../../../src/plugin-runtime/console/assistant-status.js';
import {
  ANNOUNCEMENTS_READ_PERMISSION,
  ANNOUNCEMENTS_WRITE_PERMISSION,
} from '../../../src/plugin-runtime/console/announcements-rpc.js';
import { AnnouncementDispatcher } from '../../../src/plugin-runtime/agent/turn/announcement-dispatch.js';

const signal = new AbortController().signal;

function harness(options: { bound?: boolean; dispatcher?: boolean; send?: () => Promise<any> } = {}) {
  const status = new AssistantStatus();
  const log = new DecisionEventLog();
  const store = new AiAnnouncements({ audit: () => log });
  const sendNotice = vi.fn(options.send ?? (async () => ({ status: 'sent' as const })));
  const dispatcher = new AnnouncementDispatcher({ announcements: () => store, decisionEvents: () => log, sendNotice });
  if (options.bound !== false) status.bindAnnouncements(() => store, () => (options.dispatcher === false ? undefined : dispatcher));
  const call = (name: string, input: Record<string, unknown> = {}) =>
    Promise.resolve().then(() => status.consoleRpc.methods.get(name)!.handler(input as never, { signal })) as Promise<Record<string, any>>;
  const codes = async () => {
    await log.idle();
    return log.recent().map((row) => `${row.kind}:${row.outcome}:${row.reasonCode}`);
  };
  return { status, store, log, sendNotice, call, codes };
}

const scene = { platform: 'icqq', sceneId: 'group:123' };

describe('announcements Console RPC (ADR 0037 slice B)', () => {
  it('declares read queries and write actions on control:read / control:write', () => {
    const { status } = harness();
    for (const name of ['announcements', 'announcement']) {
      expect(status.consoleRpc.methods.get(name)).toMatchObject({ readOnly: true, requiredPermissions: [ANNOUNCEMENTS_READ_PERMISSION] });
    }
    for (const name of ['announcement-create', 'announcement-edit', 'announcement-submit', 'announcement-approve', 'announcement-reject', 'announcement-resend']) {
      expect(status.consoleRpc.methods.get(name)).toMatchObject({ readOnly: false, requiredPermissions: [ANNOUNCEMENTS_WRITE_PERMISSION] });
    }
    expect(status.consoleRpc.methods.get('session-ops-set')).toBeDefined();
  });

  it('create → submit → approve sends immediately and audits every transition', async () => {
    const { call, sendNotice, codes } = harness();
    const created = await call('announcement-create', { ...scene, content: '周六活动', endpoint: '10086' });
    expect(created).toMatchObject({ from: null, to: 'draft', announcement: { status: 'draft', revision: 1, createdVia: 'console', createdBy: 'console' } });
    const id = created.announcement.id as string;
    await call('announcement-submit', { id, expectedRevision: 1 });
    const approved = await call('announcement-approve', { id, expectedRevision: 2 });
    expect(approved).toMatchObject({ to: 'approved', send: { result: 'sent' }, announcement: { status: 'sent', approvedBy: 'console' } });
    expect(sendNotice).toHaveBeenCalledTimes(1);
    const listed = await call('announcements', scene);
    expect(listed.announcements).toHaveLength(1);
    expect(await codes()).toEqual(expect.arrayContaining([
      'announcement:allow:announcement_drafted',
      'announcement:defer:announcement_submitted',
      'announcement:allow:announcement_approved',
      'announcement:allow:announcement_sent',
    ]));
  });

  it('edit after approval-pending returns to draft; stale revisions conflict', async () => {
    const { call } = harness();
    const { announcement } = await call('announcement-create', { ...scene, content: 'v1' });
    await call('announcement-submit', { id: announcement.id, expectedRevision: 1 });
    const edited = await call('announcement-edit', { id: announcement.id, expectedRevision: 2, content: 'v2' });
    expect(edited.announcement).toMatchObject({ status: 'draft', content: 'v2' });
    await expect(call('announcement-submit', { id: announcement.id, expectedRevision: 2 })).rejects.toMatchObject({ code: 'conflict' });
    await expect(call('announcement-approve', { id: announcement.id, expectedRevision: 3 })).rejects.toMatchObject({ code: 'conflict' });
  });

  it('a failed send is not retried; resend goes back to pending and needs another approval', async () => {
    const { call, sendNotice, codes } = harness({ send: async () => ({ status: 'failed', code: 'no_permission', retryable: true }) });
    const { announcement } = await call('announcement-create', { ...scene, content: 'x' });
    await call('announcement-submit', { id: announcement.id, expectedRevision: 1 });
    const approved = await call('announcement-approve', { id: announcement.id, expectedRevision: 2 });
    expect(approved).toMatchObject({ send: { result: 'failed', reason: 'failed:no_permission' }, announcement: { status: 'failed', error: 'failed:no_permission' } });
    expect(sendNotice).toHaveBeenCalledTimes(1);
    const resent = await call('announcement-resend', { id: announcement.id, expectedRevision: approved.announcement.revision });
    expect(resent.announcement).toMatchObject({ status: 'pending', approvedBy: null });
    expect(sendNotice).toHaveBeenCalledTimes(1);
    expect(await codes()).toContain('announcement:defer:announcement_resend');
  });

  it('reject is terminal', async () => {
    const { call } = harness();
    const { announcement } = await call('announcement-create', { ...scene, content: 'x' });
    await call('announcement-submit', { id: announcement.id, expectedRevision: 1 });
    await expect(call('announcement-reject', { id: announcement.id, expectedRevision: 2, reason: '时间不对' }))
      .resolves.toMatchObject({ announcement: { status: 'rejected', error: '时间不对' } });
    await expect(call('announcement-edit', { id: announcement.id, expectedRevision: 3, content: 'y' })).rejects.toMatchObject({ code: 'conflict' });
  });

  it('refuses to approve while the send path is not ready (no approved-but-unsent rows)', async () => {
    const { call, store } = harness({ dispatcher: false });
    const { announcement } = await call('announcement-create', { ...scene, content: 'x' });
    await call('announcement-submit', { id: announcement.id, expectedRevision: 1 });
    await expect(call('announcement-approve', { id: announcement.id, expectedRevision: 2 })).rejects.toMatchObject({ code: 'unavailable' });
    expect((await store.get(announcement.id))?.status).toBe('pending');
  });

  it('validates input and reports unavailable / not_found', async () => {
    const { call } = harness();
    await expect(call('announcement-create', { platform: 'icqq', sceneId: 'private:1', content: 'x' })).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(call('announcement-create', { ...scene, content: 'x', extra: 1 })).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(call('announcement-submit', { id: 'nope' })).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(call('announcement', { id: 'nope' })).rejects.toMatchObject({ code: 'not_found' });
    const unbound = harness({ bound: false });
    await expect(unbound.call('announcements', scene)).rejects.toMatchObject({ code: 'unavailable' });
  });
});
