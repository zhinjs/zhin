import { afterEach, describe, expect, it, vi } from 'vitest';
import { AiAnnouncements, DecisionEventLog } from '@zhin.js/agent';
import { SnapshotStore, rootPluginId, type SnapshotState } from '@zhin.js/plugin-runtime';
import type { ConsoleAccess } from '@zhin.js/host-http';
import { AssistantStatus } from '../../../src/plugin-runtime/console/assistant-status.js';
import {
  ANNOUNCEMENTS_APPROVE_PERMISSION,
  ANNOUNCEMENTS_READ_PERMISSION,
  ANNOUNCEMENTS_WRITE_PERMISSION,
} from '../../../src/plugin-runtime/console/announcements-rpc.js';
import { dispatchPluginConsoleRpcRequest } from '../../../src/plugin-runtime/console/plugin-console-rpc.js';
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

const stores: SnapshotStore[] = [];
afterEach(async () => { for (const store of stores.splice(0)) await store.close(); });

/** Runs a method through the real Console RPC authorization (`plugin.root.*`). */
function consoleDispatch(status: AssistantStatus) {
  const root = rootPluginId();
  const state: SnapshotState = {
    root,
    tree: new Map([[root, { id: root, instanceKey: 'root', packageName: 'app', packageRoot: '/app', children: [] }]]),
    config: new Map(), capabilities: new Map(), projections: new Map(), resources: new Map([[root, new Map()]]),
  };
  const store = new SnapshotStore(state); stores.push(store);
  return (type: string, access: ConsoleAccess, data?: unknown) => dispatchPluginConsoleRpcRequest(
    { type, requestId: 1, ...(data === undefined ? {} : { data }) },
    { snapshots: store, access, pagesOwnedBy: () => [] as never, hostRpc: status.consoleRpc },
  );
}

describe('announcements Console RPC (ADR 0037 slice B)', () => {
  it('declares reads on control:read, drafting on control:write and approval on ops:approve (slice E)', () => {
    const { status } = harness();
    expect(ANNOUNCEMENTS_APPROVE_PERMISSION).toBe('ops:approve');
    for (const name of ['announcements', 'announcement']) {
      expect(status.consoleRpc.methods.get(name)).toMatchObject({ readOnly: true, requiredPermissions: [ANNOUNCEMENTS_READ_PERMISSION] });
    }
    for (const name of ['announcement-create', 'announcement-edit', 'announcement-submit']) {
      expect(status.consoleRpc.methods.get(name)).toMatchObject({ readOnly: false, requiredPermissions: [ANNOUNCEMENTS_WRITE_PERMISSION] });
    }
    for (const name of ['announcement-approve', 'announcement-reject', 'announcement-resend']) {
      expect(status.consoleRpc.methods.get(name)).toMatchObject({ readOnly: false, requiredPermissions: ['ops:approve'] });
    }
    expect(status.consoleRpc.methods.get('session-ops-set')).toBeDefined();
  });

  it('refuses approve / reject / resend without ops:approve, even with control:write; allows them with it', async () => {
    const { status, sendNotice } = harness();
    const dispatch = consoleDispatch(status);
    const writer: ConsoleAccess = { unrestricted: false, permissions: ['control:read', 'control:write'], roles: [] };
    const approver: ConsoleAccess = { unrestricted: false, permissions: ['ops:approve'], roles: [] };

    const created = await dispatch('plugin.root.announcement-create', writer, { ...scene, content: '周六活动' });
    expect(created).toMatchObject({ status: 200 });
    const id = (created.body as any).data.announcement.id as string;
    expect(await dispatch('plugin.root.announcement-submit', writer, { id, expectedRevision: 1 })).toMatchObject({ status: 200 });
    // control:write alone cannot approve or reject; ops:approve alone cannot draft.
    expect(await dispatch('plugin.root.announcement-approve', writer, { id, expectedRevision: 2 })).toMatchObject({ status: 403 });
    expect(await dispatch('plugin.root.announcement-reject', writer, { id, expectedRevision: 2 })).toMatchObject({ status: 403 });
    expect(await dispatch('plugin.root.announcement-create', approver, { ...scene, content: 'x' })).toMatchObject({ status: 403 });
    expect(sendNotice).not.toHaveBeenCalled();

    expect(await dispatch('plugin.root.announcement-approve', approver, { id, expectedRevision: 2 }))
      .toMatchObject({ status: 200, body: { data: { to: 'approved', send: { result: 'sent' } } } });
    expect(sendNotice).toHaveBeenCalledTimes(1);

    // resend (failed → pending) is an approval step too.
    const failing = harness({ send: async () => { throw new Error('offline'); } });
    const dispatchFailing = consoleDispatch(failing.status);
    const draft = await failing.call('announcement-create', { ...scene, content: 'retry me' });
    const failedId = draft.announcement.id as string;
    await failing.call('announcement-submit', { id: failedId, expectedRevision: 1 });
    const sent = await failing.call('announcement-approve', { id: failedId, expectedRevision: 2 });
    expect(sent.announcement.status).toBe('failed');
    const revision = sent.announcement.revision as number;
    expect(await dispatchFailing('plugin.root.announcement-resend', writer, { id: failedId, expectedRevision: revision })).toMatchObject({ status: 403 });
    expect(await dispatchFailing('plugin.root.announcement-resend', approver, { id: failedId, expectedRevision: revision }))
      .toMatchObject({ status: 200, body: { data: { to: 'pending' } } });
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
