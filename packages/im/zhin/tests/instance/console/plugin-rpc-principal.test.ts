import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CONSOLE_BUILTIN_ROLES,
  pluginPermissionLevelResolver,
  resolveConsoleRpcPermission,
  type ConsoleBindingScope,
  type ConsoleGrant,
} from '@zhin.js/console-protocol';
import {
  SnapshotStore, childPluginId, definePluginConsoleRpc, pluginConsoleRpcToken, rootPluginId, type SnapshotState,
} from '@zhin.js/plugin-runtime';
import { publicConsoleAccess, unrestrictedConsoleAccess, type ConsoleAccess } from '@zhin.js/host-http';
import { ToolApprovalQueue } from '@zhin.js/agent/security';
import { AssistantStatus } from '../../../src/instance/console/assistant-status.js';
import { dispatchPluginConsoleRpcRequest } from '../../../src/instance/console/plugin-console-rpc.js';
import { collectPluginPermissionCatalog } from '../../../src/instance/console/plugin-permission-catalog.js';
import { HostToolApprovals, composeHostConsoleRpc } from '../../../src/instance/console/tool-approvals.js';

/**
 * Plugin Console RPC for signed-in principals (ADR 0049, amendment 2026-11-11): every method checks
 * its own / Page permissions by level; the catalog fallback only applies when nothing is declared.
 */

const stores: SnapshotStore[] = [];
afterEach(async () => { for (const store of stores.splice(0)) await store.close(); });

const root = rootPluginId(), rss = childPluginId(root, 'rss'), legacy = childPluginId(root, 'legacy');
type Role = keyof typeof CONSOLE_BUILTIN_ROLES;

const grantOf = (role: Role, scope: ConsoleBindingScope = { kind: 'global' }, permissions?: readonly string[]): ConsoleGrant =>
  ({ role, scope, permissions: permissions ?? CONSOLE_BUILTIN_ROLES[role].permissions });

function fixture() {
  const queue = new ToolApprovalQueue();
  const approvals = new HostToolApprovals(queue);
  const rssRpc = definePluginConsoleRpc({
    permissions: [{ id: 'rss:write', level: 'operate' }],
    status: { page: 'index', requiredPermissions: ['rss:read'], handler: () => ({ feeds: 1 }) },
    actions: { add: { page: 'index', requiredPermissions: ['rss:write'], handler: () => ({ added: true }) } },
  });
  // A plugin that declares no permissions at all keeps the feature.view / feature.configure fallback.
  const legacyRpc = definePluginConsoleRpc({
    status: { handler: () => ({ ok: true }) },
    actions: { poke: { handler: () => ({ poked: true }) } },
  });
  const state: SnapshotState = {
    root,
    tree: new Map([
      [root, { id: root, instanceKey: 'root', packageName: 'app', packageRoot: '/app', children: [rss, legacy] }],
      [rss, { id: rss, instanceKey: 'rss', packageName: 'rss', packageRoot: '/app/rss', parent: root, children: [] }],
      [legacy, { id: legacy, instanceKey: 'legacy', packageName: 'legacy', packageRoot: '/app/legacy', parent: root, children: [] }],
    ]),
    config: new Map(), capabilities: new Map(), projections: new Map(),
    resources: new Map([
      [root, new Map()],
      [rss, new Map([[pluginConsoleRpcToken.id, rssRpc]])],
      [legacy, new Map([[pluginConsoleRpcToken.id, legacyRpc]])],
    ]),
  };
  const store = new SnapshotStore(state); stores.push(store);
  const hostRpc = () => composeHostConsoleRpc(new AssistantStatus().consoleRpc, approvals.consoleRpc);
  const levelOf = pluginPermissionLevelResolver(collectPluginPermissionCatalog(store.current, hostRpc()));
  const pagesOwnedBy = vi.fn((_snapshot: unknown, id: string) =>
    (id === rss ? [{ localName: 'index', requiredPermissions: ['rss:read'], requiredRoles: [] }] : []) as never);
  const call = (type: string, grants: readonly ConsoleGrant[] | 'owner', data?: Record<string, unknown>) => {
    const message = { type, requestId: 1, ...(data ? { data } : {}) };
    const access: ConsoleAccess = grants === 'owner' ? unrestrictedConsoleAccess : publicConsoleAccess;
    return dispatchPluginConsoleRpcRequest(message, {
      snapshots: store, access, pagesOwnedBy, hostRpc,
      ...(grants === 'owner' ? {} : {
        principal: { grants, roles: grants.map(grant => grant.role ?? ''), rule: resolveConsoleRpcPermission(type, message), levelOf },
      }),
    });
  };
  const card = () => queue.enqueue({
    toolName: 'group_kick', category: 'member', sessionKey: 'icqq:1:group:2', requesterId: 'u1', turnId: 't1', args: {},
  });
  return { call, card };
}

const status = (reply: Awaited<ReturnType<ReturnType<typeof fixture>['call']>>) => reply?.status;

describe('plugin Console RPC authorization for signed-in principals', () => {
  it('keeps approvals (ops:approve / tool_approvals:resolve) with admin: an operator gets 403', async () => {
    const f = fixture();
    const operator = [grantOf('operator')], admin = [grantOf('admin')];
    const first = f.card();
    expect(await f.call('plugin.root.resolve-tool-approval', operator, { id: first.id, decision: 'approve' }))
      .toMatchObject({ status: 403, body: { success: false, code: 'forbidden' } });
    expect(status(await f.call('plugin.root.resolve-tool-approval', admin, { id: first.id, decision: 'approve' }))).toBe(200);
    // The operator still sees the cards (tool_approvals:read is a read permission).
    expect(status(await f.call('plugin.root.tool-approvals', operator))).toBe(200);
  });

  it('does not let tool_approvals:resolve fall to operate by suffix inference', async () => {
    const f = fixture();
    const levelGrant = [grantOf('operator', { kind: 'global' }, ['plugin.perms.read', 'plugin.perms.operate'])];
    expect(status(await f.call('plugin.root.resolve-tool-approval', levelGrant, { id: f.card().id, decision: 'deny' }))).toBe(403);
    // Listed by name it still works (custom role kept for backward compatibility).
    const named = [grantOf('operator', { kind: 'global' }, ['tool_approvals:resolve'])];
    expect(status(await f.call('plugin.root.resolve-tool-approval', named, { id: f.card().id, decision: 'deny' }))).toBe(200);
  });

  it('lets a viewer call read methods only', async () => {
    const f = fixture();
    const viewer = [grantOf('viewer')];
    expect(status(await f.call('plugin.root/rss.status', viewer))).toBe(200);
    expect(status(await f.call('plugin.root/rss.add', viewer))).toBe(403);
    expect(status(await f.call('plugin.root.tool-approvals', viewer))).toBe(200);
    expect(status(await f.call('plugin.root.resolve-tool-approval', viewer, { id: f.card().id, decision: 'approve' }))).toBe(403);
    expect(status(await f.call('plugin.root.control-set', viewer, {}))).toBe(403);
    expect(status(await f.call('plugin.root/legacy.status', viewer))).toBe(200);
    expect(status(await f.call('plugin.root/legacy.poke', viewer))).toBe(403);
  });

  it('gives operators the declared operate permissions', async () => {
    const f = fixture();
    const operator = [grantOf('operator')];
    expect(status(await f.call('plugin.root/rss.add', operator))).toBe(200);
    // control:write is declared operate: authorized, then the handler rejects the empty input.
    expect(await f.call('plugin.root.control-set', operator, {})).toMatchObject({ status: 400, body: { code: 'invalid_input' } });
  });

  it('denies an API token narrowed below the method permission', async () => {
    const f = fixture();
    const narrowed = [grantOf('operator', { kind: 'global' }, ['feature.view', 'feature.configure', 'plugin.perms.read'])];
    expect(status(await f.call('plugin.root/rss.status', narrowed))).toBe(200);
    expect(status(await f.call('plugin.root/rss.add', narrowed))).toBe(403);
    const readOnly = [grantOf('operator', { kind: 'global' }, ['rss:read'])];
    expect(status(await f.call('plugin.root/rss.status', readOnly))).toBe(200);
    expect(status(await f.call('plugin.root/rss.add', readOnly))).toBe(403);
    // Holding only the method permission is not enough: the Page's rss:read applies on top.
    expect(status(await f.call('plugin.root/rss.add', [grantOf('operator', { kind: 'global' }, ['rss:write'])]))).toBe(403);
  });

  it('keeps the feature.view / feature.configure fallback for plugins without declarations', async () => {
    const f = fixture();
    expect(status(await f.call('plugin.root/legacy.poke', [grantOf('operator')]))).toBe(200);
    const pluginOnly = [grantOf('viewer', { kind: 'global' }, ['rss:read'])];
    expect(status(await f.call('plugin.root/legacy.status', pluginOnly))).toBe(403);
    expect(status(await f.call('plugin.root/rss.status', pluginOnly))).toBe(200);
    // Scoped bindings never stand in for the global fallback of a non-adapter plugin.
    const scoped = [grantOf('admin', { kind: 'adapter', key: 'legacy' })];
    expect(status(await f.call('plugin.root/legacy.status', scoped))).toBe(403);
    expect(status(await f.call('plugin.root/rss.status', [grantOf('admin', { kind: 'adapter', key: 'rss' })]))).toBe(403);
  });

  it('leaves the global owner unrestricted', async () => {
    const f = fixture();
    expect(status(await f.call('plugin.root.resolve-tool-approval', 'owner', { id: f.card().id, decision: 'approve' }))).toBe(200);
    expect(status(await f.call('plugin.root/legacy.poke', 'owner'))).toBe(200);
  });
});
