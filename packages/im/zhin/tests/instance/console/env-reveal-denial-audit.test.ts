import { afterEach, describe, expect, it } from 'vitest';
import { createConsoleEventHub } from '@zhin.js/host-http';
import { createHttpHost } from '@zhin.js/host-http/node';
import { SnapshotStore, rootPluginId, type SnapshotState } from '@zhin.js/plugin-runtime';
import type { ConsoleRuntime } from '@zhin.js/pagemanager/plugin-runtime';
import { registerConsoleRpcRoute } from '../../../src/instance/console/rpc-route.js';
import { installTestConsoleUsers, testUser } from '../utils/console-users.js';

const cleanups: Array<() => unknown> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

/** A user holding exactly `permissions`, globally. */
function holding(id: string, permissions: string[]) {
  return Object.freeze({ ...testUser('viewer', { kind: 'global' }, id), grants: Object.freeze([{ role: 'custom', scope: { kind: 'global' } as const, permissions }]) });
}

describe('env:reveal denial audit (issue #1250 review)', () => {
  it('records detail.reason when the second permission (alsoRequires) is missing', async () => {
    const http = createHttpHost({ host: '127.0.0.1', port: 0 });
    const audits = installTestConsoleUsers(http, {
      writeOnly: holding('writeOnly', ['ops.env.write']),
      readOnly: holding('readOnly', ['ops.env.read']),
    });
    const root = rootPluginId();
    const state: SnapshotState = {
      root,
      tree: new Map([[root, { id: root, instanceKey: 'root', packageName: 'app', packageRoot: '/app', children: [] }]]),
      config: new Map(), capabilities: new Map(), projections: new Map(), resources: new Map(),
    };
    const snapshots = new SnapshotStore(state);
    cleanups.push(() => snapshots.close());
    registerConsoleRpcRoute({
      http, base: '/api', projectRoot: '/nonexistent-env-reveal-project',
      consoleRuntime: { runView: async () => ({ pages: [] }) } as unknown as ConsoleRuntime,
      hub: createConsoleEventHub(),
      im: { endpoints: { list: () => [] } } as never,
      listEndpoints: async () => [],
      snapshots,
      configuration: { readSource: async () => ({}), readLiteralSecrets: async () => [] } as never,
    } as Parameters<typeof registerConsoleRpcRoute>[0]);
    const base = `http://127.0.0.1:${(await http.listen()).port}`;
    cleanups.push(() => http.close());
    const reveal = async (token: string) => {
      const response = await fetch(`${base}/api/console/request`, {
        method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'env:reveal', requestId: 1, filename: '.env', key: 'BOT_TOKEN' }),
      });
      return { status: response.status, body: await response.json() as Record<string, unknown> };
    };
    expect(await reveal('writeOnly')).toMatchObject({ status: 403, body: { code: 'forbidden', error: '缺少权限 ops.env.read' } });
    expect(await reveal('readOnly')).toMatchObject({ status: 403, body: { code: 'forbidden', error: '缺少权限 ops.env.write' } });
    const denied = audits.filter(entry => entry.action === 'rpc:env:reveal' && entry.outcome === 'denied');
    expect(denied).toHaveLength(2);
    for (const entry of denied) expect(entry.detail).toMatchObject({ reason: 'insufficient_permission', file: '.env', key: 'BOT_TOKEN' });
  });
});
