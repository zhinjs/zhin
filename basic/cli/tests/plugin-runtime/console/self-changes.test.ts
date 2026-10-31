import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { SnapshotStore, rootPluginId, type SnapshotState } from '@zhin.js/plugin-runtime';
import { unrestrictedConsoleAccess, type ConsoleAccess } from '@zhin.js/host-http';
import { SelfChangeApprovals, SelfChangeStore } from '@zhin.js/agent';
import { ToolApprovalQueue } from '@zhin.js/agent/security';
import { dispatchPluginConsoleRpcRequest } from '../../../src/plugin-runtime/console/plugin-console-rpc.js';
import { HostSelfChanges } from '../../../src/plugin-runtime/console/self-changes.js';
import { HostToolApprovals, composeHostConsoleRpc } from '../../../src/plugin-runtime/console/tool-approvals.js';

const stores: SnapshotStore[] = [];
let project: string;
beforeEach(() => { project = mkdtempSync(join(tmpdir(), 'zhin-console-self-change-')); });
afterEach(async () => {
  for (const store of stores.splice(0)) await store.close();
  rmSync(project, { recursive: true, force: true });
});

function host(surface: HostSelfChanges, toolApprovals: HostToolApprovals) {
  const root = rootPluginId();
  const state: SnapshotState = {
    root,
    tree: new Map([[root, { id: root, instanceKey: 'root', packageName: 'app', packageRoot: '/app', children: [] }]]),
    config: new Map(), capabilities: new Map(), projections: new Map(), resources: new Map([[root, new Map()]]),
  };
  const store = new SnapshotStore(state); stores.push(store);
  const hostRpc = () => composeHostConsoleRpc(toolApprovals.consoleRpc, surface.consoleRpc);
  return (type: string, access: ConsoleAccess, data?: unknown) => dispatchPluginConsoleRpcRequest(
    { type, requestId: 1, ...(data === undefined ? {} : { data }) },
    { snapshots: store, access, pagesOwnedBy: () => [] as never, hostRpc },
  );
}

async function pendingChange(store: SelfChangeStore, approvals: SelfChangeApprovals, sceneId: string) {
  const draft = await store.draft({
    origin: { platform: 'icqq', sceneId, userId: '42', endpoint: 'bot-1' },
    files: [{ path: 'commands/ping.ts', content: 'export default 1; // SECRET_BODY\n' }],
  });
  await store.transition(draft.id, 'trialing', { actor: 'policy', reasonCode: 'change_drafted' });
  await store.transition(draft.id, 'ready', { actor: 'policy', trial: { passed: true, checks: [] } });
  return approvals.submit(draft.id);
}

it('lists pending changes and lets ops:approve approve or reject them', async () => {
  const store = new SelfChangeStore({ root: join(project, '.zhin', 'changes'), projectRoot: project });
  const queue = new ToolApprovalQueue();
  const approvals = new SelfChangeApprovals({ store, queue });
  const surface = new HostSelfChanges();
  const toolApprovals = new HostToolApprovals(queue);
  const call = host(surface, toolApprovals);
  const reader: ConsoleAccess = { unrestricted: false, permissions: ['tool_approvals:read'], roles: [] };
  const approver: ConsoleAccess = { unrestricted: false, permissions: ['ops:approve'], roles: [] };

  expect(await call('plugin.root.self-changes', reader)).toMatchObject({ status: 200, body: { data: { available: false } } });
  const unbind = surface.bind(store, approvals);
  const first = await pendingChange(store, approvals, 'group:1');
  const second = await pendingChange(store, approvals, 'group:2');

  const listed = await call('plugin.root.self-changes', reader);
  expect(listed).toMatchObject({ status: 200, body: { data: { available: true } } });
  const data = (listed as { body: { data: { pending: { id: string; approvalId: string }[]; usageBytes: number } } }).body.data;
  expect(data.pending.map(card => card.id).sort()).toEqual([first.record.id, second.record.id].sort());
  expect(data.pending.find(card => card.id === first.record.id)?.approvalId).toBe(first.approvalId);
  expect(data.usageBytes).toBeGreaterThan(0);
  expect(JSON.stringify(listed)).not.toContain('SECRET_BODY');

  expect(await call('plugin.root.resolve-self-change', reader, { id: first.record.id, decision: 'approve' })).toMatchObject({ status: 403 });
  expect(await call('plugin.root.resolve-self-change', approver, { id: first.record.id, decision: 'maybe' })).toMatchObject({ status: 400 });
  expect(await call('plugin.root.resolve-self-change', approver, { id: first.record.id, decision: 'approve' }))
    .toMatchObject({ status: 200, body: { data: { id: first.record.id, status: 'approved', approvedBy: 'console' } } });
  expect(await call('plugin.root.resolve-self-change', approver, { id: first.record.id, decision: 'reject' })).toMatchObject({ status: 409 });
  expect(await call('plugin.root.resolve-self-change', approver, { id: 'missing', decision: 'reject' })).toMatchObject({ status: 404 });

  // The same card is visible on the hard-gate surface; settling it there settles the change too.
  expect(await call('plugin.root.resolve-tool-approval', unrestrictedConsoleAccess, { id: second.approvalId, decision: 'deny' })).toMatchObject({ status: 200 });
  await approvals.drain();
  expect((await store.get(second.record.id))?.status).toBe('rejected');

  // Only `failed` changes can be marked handled.
  expect(await call('plugin.root.mark-self-change-handled', approver, { id: first.record.id })).toMatchObject({ status: 409 });
  unbind();
  expect(await call('plugin.root.resolve-self-change', approver, { id: first.record.id, decision: 'approve' })).toMatchObject({ status: 503 });
});
