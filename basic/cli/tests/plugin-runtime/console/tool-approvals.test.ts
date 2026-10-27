import { afterEach, expect, it } from 'vitest';
import { SnapshotStore, rootPluginId, type SnapshotState } from '@zhin.js/plugin-runtime';
import { unrestrictedConsoleAccess, type ConsoleAccess } from '@zhin.js/host-http';
import { ToolApprovalQueue } from '@zhin.js/agent/security';
import { AssistantStatus } from '../../../src/plugin-runtime/console/assistant-status.js';
import { dispatchPluginConsoleRpcRequest } from '../../../src/plugin-runtime/console/plugin-console-rpc.js';
import {
  CONSOLE_TOOL_APPROVAL_OPERATOR,
  HostToolApprovals,
  OPS_APPROVE_PERMISSION,
  composeHostConsoleRpc,
} from '../../../src/plugin-runtime/console/tool-approvals.js';

const stores: SnapshotStore[] = [];
afterEach(async () => { for (const store of stores.splice(0)) await store.close(); });

function host(approvals: HostToolApprovals) {
  const root = rootPluginId();
  const state: SnapshotState = {
    root,
    tree: new Map([[root, { id: root, instanceKey: 'root', packageName: 'app', packageRoot: '/app', children: [] }]]),
    config: new Map(), capabilities: new Map(), projections: new Map(), resources: new Map([[root, new Map()]]),
  };
  const store = new SnapshotStore(state); stores.push(store);
  const hostRpc = composeHostConsoleRpc(new AssistantStatus().consoleRpc, approvals.consoleRpc);
  return (type: string, access: ConsoleAccess, data?: unknown) => dispatchPluginConsoleRpcRequest(
    { type, requestId: 1, ...(data === undefined ? {} : { data }) },
    { snapshots: store, access, pagesOwnedBy: () => [] as never, hostRpc },
  );
}

it('lists dangerous-tool approval cards and lets permitted tokens settle them', async () => {
  const queue = new ToolApprovalQueue();
  const approvals = new HostToolApprovals();
  const unbind = approvals.bind(queue);
  const card = queue.enqueue({
    toolName: 'group_kick', category: 'member', sessionKey: 'icqq:1:group:2', requesterId: 'u1', turnId: 't1',
    args: { user_id: 3, cookie: 'SESSDATA=abc123' },
  });
  const call = host(approvals);
  const reader: ConsoleAccess = { unrestricted: false, permissions: ['tool_approvals:read'], roles: ['member'] };
  const resolver: ConsoleAccess = { unrestricted: false, permissions: ['tool_approvals:read', 'tool_approvals:resolve'], roles: ['member'] };

  const listed = await call('plugin.root.tool-approvals', reader);
  expect(listed).toMatchObject({ status: 200, body: { data: { available: true, pending: [{ id: card.id, toolName: 'group_kick', category: 'member' }] } } });
  expect(JSON.stringify(listed)).not.toContain('abc123');
  // Ambient status from the other Host surface is still served next to it.
  expect(await call('plugin.root.skills', unrestrictedConsoleAccess)).toMatchObject({ status: 200 });

  expect(await call('plugin.root.resolve-tool-approval', reader, { id: card.id, decision: 'approve' })).toMatchObject({ status: 403 });
  expect(await call('plugin.root.resolve-tool-approval', resolver, { id: card.id, decision: 'maybe' })).toMatchObject({ status: 400 });
  expect(await call('plugin.root.resolve-tool-approval', resolver, { id: card.id, decision: 'approve' }))
    .toMatchObject({ status: 200, body: { data: { id: card.id, status: 'approved', decidedBy: CONSOLE_TOOL_APPROVAL_OPERATOR } } });
  expect(await call('plugin.root.resolve-tool-approval', resolver, { id: card.id, decision: 'deny' })).toMatchObject({ status: 409 });
  expect(await call('plugin.root.resolve-tool-approval', resolver, { id: 'tap_missing', decision: 'deny' })).toMatchObject({ status: 404 });

  unbind();
  expect(await call('plugin.root.tool-approvals', reader)).toMatchObject({ status: 200, body: { data: { available: false, pending: [] } } });
});

it('lets ops:approve or the older tool_approvals:resolve settle cards (ADR 0037 slice E)', async () => {
  const queue = new ToolApprovalQueue();
  const approvals = new HostToolApprovals();
  approvals.bind(queue);
  const call = host(approvals);
  const enqueue = (user: number) => queue.enqueue({
    toolName: 'group_kick', category: 'member', sessionKey: 'icqq:1:group:2', turnId: `t${user}`, args: { user_id: user },
  });
  const opsApprover: ConsoleAccess = { unrestricted: false, permissions: ['ops:approve'], roles: [] };
  const legacy: ConsoleAccess = { unrestricted: false, permissions: ['tool_approvals:resolve'], roles: [] };
  const controlWriter: ConsoleAccess = { unrestricted: false, permissions: ['control:write', 'control:read'], roles: [] };

  expect(approvals.consoleRpc.methods.get('resolve-tool-approval'))
    .toMatchObject({ requiredPermissions: [], anyOfPermissions: [OPS_APPROVE_PERMISSION, 'tool_approvals:resolve'].sort() });
  // ops:approve can also see the cards it settles.
  expect(await call('plugin.root.tool-approvals', opsApprover)).toMatchObject({ status: 200 });
  expect(await call('plugin.root.tool-approvals', controlWriter)).toMatchObject({ status: 403 });

  const first = enqueue(1);
  expect(await call('plugin.root.resolve-tool-approval', controlWriter, { id: first.id, decision: 'approve' })).toMatchObject({ status: 403 });
  expect(await call('plugin.root.resolve-tool-approval', opsApprover, { id: first.id, decision: 'deny' }))
    .toMatchObject({ status: 200, body: { data: { id: first.id, status: 'denied', channel: 'console' } } });
  const second = enqueue(2);
  expect(await call('plugin.root.resolve-tool-approval', legacy, { id: second.id, decision: 'approve' }))
    .toMatchObject({ status: 200, body: { data: { id: second.id, status: 'approved' } } });
  const third = enqueue(3);
  expect(await call('plugin.root.resolve-tool-approval', unrestrictedConsoleAccess, { id: third.id, decision: 'approve' }))
    .toMatchObject({ status: 200 });
});

it('rejects duplicate Host Console RPC method names', () => {
  const approvals = new HostToolApprovals();
  expect(() => composeHostConsoleRpc(approvals.consoleRpc, approvals.consoleRpc)).toThrow(/Duplicate/);
});
