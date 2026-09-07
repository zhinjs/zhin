import { afterEach, describe, expect, it } from 'vitest';
import { createHttpHost, type ProcessHttpHost } from '@zhin.js/host-http';
import { adapterFeatureId } from '@zhin.js/adapter';
import { SnapshotStore, databaseHostToken, rootPluginId, type SnapshotState } from '@zhin.js/plugin-runtime';
import { createPrimaryConfig, createEnvStore, primaryConfigToken } from '@zhin.js/runtime';
import { readReadiness, registerReadinessRoutes, type ReadinessPolicy } from '../../src/plugin-runtime/readiness.js';
import { fetchReadiness } from '../../src/plugin-runtime/readiness-client.js';

const stores: SnapshotStore[] = [];
const hosts: ProcessHttpHost[] = [];
afterEach(async () => {
  await Promise.all(hosts.splice(0).map((host) => host.close()));
  await Promise.all(stores.splice(0).map((store) => store.close()));
});

function state(policy: ReadinessPolicy = {}, started = true): SnapshotState {
  const root = rootPluginId();
  const config = createPrimaryConfig({ http: { readiness: policy } }, createEnvStore(root, {
    name: 'test', mode: 'test', platform: 'node',
  }));
  return {
    root, tree: new Map(), config: new Map(), capabilities: new Map(), projections: new Map(),
    resources: new Map([[root, new Map([
      [primaryConfigToken.id, config],
      [databaseHostToken.id, { started }],
    ])]]),
  };
}

function store(initial = state()): SnapshotStore {
  const result = new SnapshotStore(initial);
  stores.push(result);
  return result;
}

function commit(snapshots: SnapshotStore, next: SnapshotState): void {
  snapshots.commit(snapshots.current.generation, { snapshot: next, dispose: () => undefined });
}

describe('runtime readiness', () => {
  it('rejects startup and stopped Roots, checks database initialization by default', async () => {
    const snapshots = store();
    expect(readReadiness({ snapshots }).ready).toBe(false);
    commit(snapshots, state());
    expect(readReadiness({ snapshots })).toMatchObject({ ready: true, generation: 1 });
    commit(snapshots, state({}, false));
    expect(readReadiness({ snapshots }).checks).toContainEqual(expect.objectContaining({
      component: 'database', ready: false, reason: 'not_initialized',
    }));
    commit(snapshots, state({ database: false }, false));
    expect(readReadiness({ snapshots }).ready).toBe(true);
    await snapshots.close();
    expect(readReadiness({ snapshots }).ready).toBe(false);
  });

  it('selects required endpoint slots by exact owner and stable id, not display name', () => {
    const snapshots = store();
    const required = { owner: 'root/primary', name: 'sandbox~bot' };
    let connected = true;
    const next = state({ endpoints: [required] });
    const projection = {
      $projection: 'zhin.adapter-index/1',
      describe: () => [
        { owner: 'root/other', id: 'root/other\0zhin.adapter\0sandbox~bot', connected: true },
        { owner: required.owner, id: 'root/primary\0zhin.adapter\0sandbox~bot', name: 'mutable nickname', connected },
      ],
    };
    commit(snapshots, { ...next, projections: new Map([[adapterFeatureId, projection]]) });
    expect(readReadiness({ snapshots }).ready).toBe(true);
    connected = false;
    expect(readReadiness({ snapshots }).checks.at(-1)?.reason).toBe('admission_closed');
    commit(snapshots, next);
    expect(readReadiness({ snapshots }).checks.at(-1)?.reason).toBe('endpoint_missing');
  });

  it('uses the leased generation for policy and agent bindings even if a new generation commits', () => {
    const snapshots = store();
    commit(snapshots, state({ agents: ['old'] }));
    const report = readReadiness({ snapshots, agentBindings(snapshot) {
      commit(snapshots, state({ agents: ['new'] }));
      expect(snapshot.generation).toBe(1);
      return [{ name: 'old' }];
    } });
    expect(report).toMatchObject({ ready: true, generation: 1 });
    expect(readReadiness({ snapshots }).checks.at(-1)).toMatchObject({
      component: 'agent:new', ready: false, reason: 'binding_missing',
    });
  });

  it('fails closed and releases the lease when diagnostics throw, without disclosing exception text', async () => {
    const snapshots = store();
    commit(snapshots, state({ agents: ['test'] }));
    const report = readReadiness({ snapshots, agentBindings() { throw new Error('secret-provider-key'); } });
    expect(report.ready).toBe(false);
    expect(JSON.stringify(report)).not.toContain('secret-provider-key');
    await snapshots.close();
  });

  it('serves public 503/200 and protects detailed reports on a custom API base', async () => {
    const snapshots = store();
    const host = createHttpHost({ host: '127.0.0.1', port: 0, token: 'full-secret',
      tokens: [{ token: 'demo-secret', scope: 'demo' }], apiBase: '/control' });
    hosts.push(host);
    registerReadinessRoutes(host, { snapshots }, '/control/');
    const { origin } = await host.listen();
    const pending = await fetch(`${origin}/pub/ready`);
    expect(pending.status).toBe(503);
    expect(await pending.json()).toEqual({ ready: false });
    expect((await fetch(`${origin}/pub/health`)).status).toBe(200);
    expect((await fetch(`${origin}/control/system/readiness`)).status).toBe(401);
    expect((await fetch(`${origin}/control/system/readiness`, {
      headers: { Authorization: 'Bearer demo-secret' },
    })).status).toBe(401);
    await expect(fetchReadiness(`${origin}/control`, 'full-secret')).resolves.toMatchObject({ ready: false });
    commit(snapshots, state());
    const ready = await fetch(`${origin}/pub/ready`);
    expect(ready.status).toBe(200);
    expect(ready.headers.get('cache-control')).toBe('no-store');
    expect(await ready.json()).toEqual({ ready: true });
    const details = await fetch(`${origin}/control/system/readiness`, {
      headers: { Authorization: 'Bearer full-secret' },
    });
    expect(await details.json()).toMatchObject({ success: true, data: { generation: 1, ready: true } });
    await expect(fetchReadiness(`${origin}/control`, 'full-secret')).resolves.toMatchObject({ ready: true });
    await expect(fetchReadiness(`${origin}/control`, 'demo-secret')).rejects.toThrow('full-scope');
  });
});
