import { afterEach, describe, expect, it } from 'vitest';
import { LoginAssist } from '@zhin.js/core';
import { createConsoleEventHub } from '@zhin.js/host-http';
import { createHttpHost } from '@zhin.js/host-http/node';
import { SnapshotStore, rootPluginId, type SnapshotState } from '@zhin.js/plugin-runtime';
import { ToolApprovalQueue } from '@zhin.js/agent/security';
import type { ConsoleRuntime } from '@zhin.js/pagemanager/plugin-runtime';
import type { ConsoleAttentionList } from '@zhin.js/console-protocol';
import { registerConsoleRpcRoute } from '../../../src/instance/console/rpc-route.js';
import { agentToolApprovalQueueToken } from '../../../src/instance/console/tool-approvals.js';
import { testUser, withTestUsers } from '../utils/console-users.js';

const cleanups: Array<() => unknown> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

async function host() {
  const owner = {};
  const loginAssist = new LoginAssist();
  void loginAssist.waitForInput('icqq', '10001', 'qrcode', { message: 'scan' }, { owner, timeoutMs: 0 }).catch(() => {});
  cleanups.push(() => { for (const task of loginAssist.listPending()) loginAssist.cancel(task.id, 'test'); });
  const endpoints = [
    { id: 'e1', endpoint: { id: 'e1', adapter: 'icqq' }, name: '10001', adapter: 'icqq', owner: 'root/icqq', connected: false, admitted: true,
      transportState: 'closed', status: 'offline', phase: 'offline' },
    { id: 'e2', endpoint: { id: 'e2', adapter: 'qq' }, name: 'bot', adapter: 'qq', owner: 'root/qq', connected: false, admitted: true,
      transportState: 'closed', status: 'offline', phase: 'offline' },
    // Adapter alias `qq-work` ≠ client adapter type `qq`; account name `ops` ≠ canonical id.
    { id: 'root/qq-work\u0000zhin.adapter\u0000main', endpoint: { id: 'root/qq-work\u0000zhin.adapter\u0000main', adapter: 'qq' }, name: 'ops', adapter: 'qq-work',
      owner: 'root/qq-work', connected: false, admitted: true, transportState: 'closed', status: 'offline', phase: 'offline' },
  ];
  const queue = new ToolApprovalQueue();
  queue.enqueue({ toolName: 'group_kick', category: 'member', sessionKey: 'qq:bot:group:1', requesterId: 'u1', turnId: 't1', args: {} });
  const root = rootPluginId();
  const state: SnapshotState = {
    root,
    tree: new Map([[root, { id: root, instanceKey: 'root', packageName: 'app', packageRoot: '/app', children: [] }]]),
    config: new Map(), capabilities: new Map(), projections: new Map(), resources: new Map([[root, new Map<string, unknown>([[agentToolApprovalQueueToken.id, queue]])]]),
  };
  const snapshots = new SnapshotStore(state);
  cleanups.push(() => snapshots.close());
  const http = withTestUsers(createHttpHost({ host: '127.0.0.1', port: 0 }), {
    owner: 'owner',
    viewer: 'viewer',
    scoped: Object.freeze({ ...testUser('operator', { kind: 'endpoint', key: 'qq/bot' }, 'scoped'),
      grants: Object.freeze([
        { role: 'viewer', scope: { kind: 'global' } as const, permissions: ['status.view'] },
        { role: 'operator', scope: { kind: 'endpoint', key: 'qq/bot' } as const, permissions: ['endpoint.view'] },
      ]) }),
    nobody: 'none',
    work: Object.freeze({ ...testUser('operator', { kind: 'endpoint', key: 'qq-work/ops' }, 'work'),
      grants: Object.freeze([
        { role: 'viewer', scope: { kind: 'global' } as const, permissions: ['status.view'] },
        { role: 'operator', scope: { kind: 'endpoint', key: 'qq-work/ops' } as const, permissions: ['endpoint.view'] },
      ]) }),
  });
  registerConsoleRpcRoute({
    http, base: '/api', projectRoot: '/nonexistent-attention-project',
    consoleRuntime: { runView: async () => ({ pages: [] }) } as unknown as ConsoleRuntime,
    hub: createConsoleEventHub(),
    im: { loginAssist, endpoints: { list: () => endpoints } } as never,
    listEndpoints: async () => endpoints,
    snapshots,
    configuration: {
      readSource: async () => ({ applicationError: 'invalid' }),
      readLiteralSecrets: async () => [{ path: ['http', 'token'] }],
    } as never,
  } as Parameters<typeof registerConsoleRpcRoute>[0]);
  const base = `http://127.0.0.1:${(await http.listen()).port}`;
  cleanups.push(() => http.close());
  return async (token: string, data?: Record<string, unknown>, type = 'attention.list') => {
    const response = await fetch(`${base}/api/console/request`, {
      method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ type, requestId: 1, ...(data ? { data } : {}) }),
    });
    return { status: response.status, body: await response.json() as { success: boolean; code?: string; data?: ConsoleAttentionList } };
  };
}

describe('endpoint identity shared by attention.list and endpoint.list', () => {
  it('scopes endpoint.list by the same adapter alias + name as attention items', async () => {
    const request = await host();
    const work = await request('work', undefined, 'endpoint.list') as unknown as { body: { data?: { endpoints: { name: string }[] } } };
    expect(work.body.data!.endpoints.map(row => row.name)).toEqual(['ops']);
    const scoped = await request('scoped', undefined, 'endpoint.list') as unknown as { body: { data?: { endpoints: { name: string }[] } } };
    expect(scoped.body.data!.endpoints.map(row => row.name)).toEqual(['bot']);
  });
});

describe('attention.list over the Console RPC route', () => {
  it('gathers login, endpoint, configuration and approval items from the wired runtime state for an owner', async () => {
    const request = await host();
    const reply = await request('owner', { locale: 'en' });
    expect(reply.status).toBe(200);
    const kinds = reply.body.data!.items.map(item => `${item.kind}${item.subject?.endpointKey ? `:${item.subject.endpointKey}` : ''}`);
    expect(new Set(kinds)).toEqual(new Set(['login.pending:10001', 'endpoint.offline:bot', 'endpoint.offline:ops', 'config.apply-failed', 'config.literal-secrets', 'tool-approval.pending']));
    expect(reply.body.data!.items[0]).toMatchObject({ kind: 'login.pending', title: 'icqq / 10001 is waiting to sign in' });
  });

  it('filters items per principal and refuses callers without status.view', async () => {
    const request = await host();
    const viewer = await request('viewer');
    // Viewers hold endpoint.view and plugin.perms.read (→ tool_approvals:read, like the approvals panel), not ops.config.read.
    expect(new Set(viewer.body.data!.items.map(item => item.kind))).toEqual(new Set(['login.pending', 'endpoint.offline', 'tool-approval.pending']));
    // A binding on qq-work/ops (the row's adapter alias + name, as the Console's binding editor writes it).
    const work = await request('work');
    expect(work.body.data!.items.map(item => [item.kind, item.subject?.adapter, item.subject?.endpointKey, item.action.path]))
      .toEqual([['endpoint.offline', 'qq-work', 'ops', '/scope/qq-work/ops?tab=access']]);
    const scoped = await request('scoped');
    expect(scoped.body.data!.items.map(item => `${item.kind}:${item.subject?.endpointKey}`)).toEqual(['endpoint.offline:bot']);
    const nobody = await request('nobody');
    expect(nobody.status).toBe(403);
    expect(nobody.body.code).toBe('forbidden');
  });
});
