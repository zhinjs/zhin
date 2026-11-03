import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  childPluginId,
  createRootPrivateToken,
  ConfigDocumentDivergenceError,
  definePlugin,
  rootPluginId,
  type ConfigDocumentPort,
  type ConfigDocumentSnapshot,
  type ConfigPatch,
  type PreparedConfigDocument,
  type RuntimeConfigDocument,
} from '@zhin.js/plugin-runtime';
import {
  ConfigValidationError,
  RootRuntime,
  primaryConfigToken,
  type PrimaryConfig,
  type ModuleRuntime,
} from '../src/index.js';

const temporary: string[] = [];

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true })));
});

describe('RootRuntime config patches', () => {
  it('retains a Host-selected plugin owner and its declaration while applying independent edits', async () => {
    const project = await createProject();
    await writeJson(join(project, 'plugins/child/schema.json'), { type: 'object', additionalProperties: false,
      properties: { nickname: { type: 'string' }, master: { type: 'string' }, endpoints: { type: 'array', items: { type: 'object' } } } });
    const modules = new FakeModuleRuntime();
    for (const source of ['plugin.ts', 'plugins/child/plugin.ts', 'plugins/sibling/plugin.ts']) modules.set(join(project, source), { default: definePlugin({ name: 'fixture' }) });
    const child = { nickname: 'Before', master: 'owner-before', endpoints: [{ id: 'one', master: 'one-before' }, { id: 'two', master: 'two-before' }] };
    const port = new class extends FakeConfigDocumentPort {
      override async read(): Promise<ConfigDocumentSnapshot> {
        const snapshot = await super.read();
        return { ...snapshot, pluginOrder: Object.keys(snapshot.document.plugins ?? {}) };
      }
    }({ configVersion: 2, plugins: { child: '@test/child', sibling: '@test/sibling' }, child });
    const runtime = new RootRuntime({ projectRoot: project, modules, config: port,
      environment: { name: 'test', mode: 'test', platform: 'node' }, installResources() {},
      pluginConfigurationSelection: { select: ({ next }) => next.plugins && Object.hasOwn(next.plugins, 'child')
        ? [{ instanceKey: 'child', reasonCode: 'startup-role-mapping' }] : [] },
    });
    await runtime.start();
    const old = runtime.snapshots.acquire();
    try {
      await runtime.patchConfig([{ op: 'set', path: ['child'], value: { nickname: 'After', master: 'owner-after',
        endpoints: [{ id: 'two', master: 'two-after' }, { id: 'one', master: 'one-after' }] } },
      { op: 'set', path: ['sibling', 'label'], value: 'independent' }]);
      expect(runtime.snapshot.config.get(childPluginId(rootPluginId(), 'child'))).toEqual(child);
      expect(runtime.snapshot.config.get(childPluginId(rootPluginId(), 'sibling'))).toEqual({ label: 'independent' });
      expect(port.document.child).toMatchObject({ master: 'owner-after' });
      expect(runtime.configurationApplication.groups).toContainEqual(expect.objectContaining({ id: 'plugin-host:child', status: 'restart-pending', reasonCode: 'startup-role-mapping' }));
      expect(runtime.configurationApplication.groups.find(group => group.id === 'plugins')?.paths).not.toContainEqual(['child', 'master']);
      await runtime.reload();
      expect(runtime.snapshot.config.get(childPluginId(rootPluginId(), 'child'))).toEqual(child);
      port.writeExternal({ configVersion: 2, plugins: { sibling: '@test/sibling', child: '@test/sibling' }, child: { label: 'rebound' } });
      await runtime.applyConfiguration();
      expect(runtime.snapshot.tree.get(childPluginId(rootPluginId(), 'child'))?.packageName).toBe('@test/child');
      expect(runtime.snapshot.config.get(childPluginId(rootPluginId(), 'child'))).toEqual(child);
      // Disabling/removing an account retires its consumers immediately. Later
      // re-addition must still be checked against the process startup role map.
      port.writeExternal({ configVersion: 2, plugins: { sibling: '@test/sibling', child: '@test/child' }, disable_plugins: ['child'], child: { ...child, master: 'owner-after' } });
      await runtime.applyConfiguration();
      expect(runtime.snapshot.tree.has(childPluginId(rootPluginId(), 'child'))).toBe(false);
      port.writeExternal({ configVersion: 2, plugins: { sibling: '@test/sibling' }, sibling: { label: 'next' } });
      await runtime.applyConfiguration();
      expect(runtime.snapshot.tree.has(childPluginId(rootPluginId(), 'child'))).toBe(false);
      port.writeExternal({ configVersion: 2, plugins: { sibling: '@test/sibling', child: '@test/sibling' }, disable_plugins: ['child'], child: { label: 'rebound' } });
      await runtime.applyConfiguration();
      expect(runtime.snapshot.tree.has(childPluginId(rootPluginId(), 'child'))).toBe(false);
      await runtime.reload();
      expect(runtime.snapshot.tree.has(childPluginId(rootPluginId(), 'child'))).toBe(false);
      expect(old.value.config.get(childPluginId(rootPluginId(), 'child'))).toEqual(child);
    } finally { old.release(); await runtime.stop(); }
  });
  it('uses distinct operation evidence across Root instances with the same source revision', async () => {
    const project = await createProject();
    const modules = new FakeModuleRuntime();
    for (const source of ['plugin.ts', 'plugins/child/plugin.ts', 'plugins/sibling/plugin.ts']) modules.set(join(project, source), { default: definePlugin({ name: 'fixture' }) });
    const roots = [0, 1].map(() => new RootRuntime({ projectRoot: project, modules,
      config: new FakeConfigDocumentPort({ configVersion: 2, plugins: { child: '@test/child', sibling: '@test/sibling' } }),
      environment: { name: 'test', mode: 'test', platform: 'node' },
    }));
    const initialIds = roots.map(root => root.configurationApplication.operationId);
    await Promise.all(roots.map(root => root.start()));
    try {
      expect(initialIds[0]).not.toBe(initialIds[1]);
      expect(roots[0].configurationApplication.sourceRevision).toBe(roots[1].configurationApplication.sourceRevision);
      expect(roots[0].configurationApplication.operationId).not.toBe(roots[1].configurationApplication.operationId);
    } finally { await Promise.all(roots.map(root => root.stop())); }
  });
  it.each([true, false])('replaced Root seeds its own private binding=%s without transferring the previous owner version', async seedsBinding => {
    const project = await createProject();
    const modules = new FakeModuleRuntime();
    for (const source of ['plugin.ts', 'plugins/child/plugin.ts', 'plugins/sibling/plugin.ts']) modules.set(join(project, source), { default: definePlugin({ name: 'fixture' }) });
    const token = createRootPrivateToken<{ generation: number; level: unknown }>('test.owner-config');
    const runtime = new RootRuntime({ projectRoot: project, modules,
      config: { configVersion: 2, plugins: { child: '@test/child', sibling: '@test/sibling' }, log_level: 'info' },
      environment: { name: 'test', mode: 'test', platform: 'node' },
      installResources({ generation, resources, config }) {
        if (generation === 1 || seedsBinding) resources.provide(token, { generation, level: config.get('log_level') });
      },
      configUpdates: [{ id: 'level', paths: [['log_level']], async prepare(input) {
        return { effect: 'in-place', rootResources: new Map([[token, { generation: 0, level: input.next.log_level }]]) };
      } }],
    });
    await runtime.start();
    await runtime.patchConfig([{ op: 'set', path: ['log_level'], value: 'debug' }]);
    const previous = runtime.snapshots.acquire();
    try {
      const replacement = runtime.patchConfig([{ op: 'set', path: ['log_level'], value: 'warn' }, { op: 'set', path: ['plugin', 'mode'], value: 'production' }]);
      if (seedsBinding) {
        await replacement;
        await runtime.control(async context => { expect(context.readRootResource(token)).toEqual({ generation: 3, level: 'warn' }); });
        expect(runtime.snapshot.generation).toBe(3);
      } else {
        await expect(replacement).rejects.toThrow('replaced Root owner did not provide');
        expect(runtime.snapshot).toBe(previous.value);
      }
      expect(runtime.snapshots.rootResource?.(previous, token)).toEqual({ generation: 0, level: 'debug' });
    } finally { previous.release(); await runtime.stop(); }
  });
  it('rejects a superseded prepared source without overwriting the newer external edit', async () => {
    const project = await createProject();
    const modules = new FakeModuleRuntime();
    for (const source of ['plugin.ts', 'plugins/child/plugin.ts', 'plugins/sibling/plugin.ts']) modules.set(join(project, source), { default: definePlugin({ name: 'fixture' }) });
    const token = createRootPrivateToken<unknown>('test.superseded');
    const source = { configVersion: 2, plugins: { child: '@test/child', sibling: '@test/sibling' }, log_level: 'info' };
    const port = new FakeConfigDocumentPort(source);
    let entered!: () => void; let proceed!: () => void;
    const enteredPrepare = new Promise<void>(resolve => { entered = resolve; });
    const proceedPrepare = new Promise<void>(resolve => { proceed = resolve; });
    const runtime = new RootRuntime({ projectRoot: project, modules, config: port,
      environment: { name: 'test', mode: 'test', platform: 'node' }, installResources({ resources }) { resources.provide(token, 'info'); },
      configUpdates: [{ id: 'level', paths: [['log_level']], async prepare(input) {
        entered(); await proceedPrepare;
        return { effect: 'in-place', rootResources: new Map([[token, input.next.log_level]]) };
      } }],
    });
    const initial = await runtime.start();
    try {
      await expect(runtime.applyConfiguration('stale-source-revision')).rejects.toMatchObject({ code: 'configuration_superseded' });
      expect(runtime.snapshot).toBe(initial); expect(port.commits).toBe(0);
      const applying = runtime.patchConfig([{ op: 'set', path: ['log_level'], value: 'debug' }]);
      void applying.catch(() => undefined);
      await enteredPrepare;
      port.writeExternal({ ...source, log_level: 'warn' });
      proceed();
      await expect(applying).rejects.toThrow('Configuration source changed');
      expect(runtime.snapshot).toBe(initial); expect(port.document.log_level).toBe('warn');
      expect(runtime.configurationApplication.groups).toEqual([expect.objectContaining({ status: 'superseded' })]);
      await runtime.applyConfiguration();
      await runtime.control(async context => { expect(context.readRootResource(token)).toBe('warn'); });
    } finally { proceed(); await runtime.stop(); }
  });
  it('keeps candidate private bindings invisible while asynchronous handoff fails', async () => {
    const project = await createProject();
    const modules = new FakeModuleRuntime();
    const token = createRootPrivateToken<string>('test.activation-version');
    let entered!: () => void;
    let finish!: () => void;
    const enteredHandoff = new Promise<void>(resolve => { entered = resolve; });
    const finishHandoff = new Promise<void>(resolve => { finish = resolve; });
    modules.set(join(project, 'plugin.ts'), { default: definePlugin({ name: 'root', setup() {} }) });
    modules.set(join(project, 'plugins/sibling/plugin.ts'), { default: definePlugin({ name: 'sibling', setup() {} }) });
    modules.set(join(project, 'plugins/child/plugin.ts'), { default: definePlugin({ name: 'child', setup({ config, handoff }) {
      if ((config.get() as { label: string }).label === 'activation-broken') handoff.add({ async activateNext() {
        entered(); await finishHandoff; throw new Error('activation failed');
      } });
    } }) });
    const port = new FakeConfigDocumentPort({ configVersion: 2, plugins: { child: '@test/child', sibling: '@test/sibling' }, log_level: 'info' });
    const runtime = new RootRuntime({ projectRoot: project, modules, config: port,
      environment: { name: 'test', mode: 'test', platform: 'node' },
      installResources({ resources }) { resources.provide(token, 'old'); },
      configUpdates: [{ id: 'level', paths: [['log_level']], async prepare() { return { effect: 'in-place', rootResources: new Map([[token, 'new']]) }; } }],
    });
    const initial = await runtime.start();
    const old = runtime.snapshots.acquire();
    try {
      const applying = runtime.patchConfig([{ op: 'set', path: ['log_level'], value: 'debug' },
        { op: 'set', path: ['child', 'label'], value: 'activation-broken' }]);
      void applying.catch(() => undefined);
      await enteredHandoff;
      expect(runtime.snapshot).toBe(initial);
      expect(runtime.snapshots.rootResource?.(old, token)).toBe('old');
      finish();
      await expect(applying).rejects.toThrow('activation failed');
      expect(runtime.snapshot).toBe(initial);
      expect(runtime.snapshots.rootResource?.(old, token)).toBe('old');
      expect(port.document.log_level).toBe('debug');
    } finally { finish(); old.release(); await runtime.stop(); }
  });

  it('validates the complete desired Host document before saving any independent change', async () => {
    const project = await createProject();
    const modules = new FakeModuleRuntime();
    for (const source of ['plugin.ts', 'plugins/child/plugin.ts', 'plugins/sibling/plugin.ts']) modules.set(join(project, source), { default: definePlugin({ name: 'fixture' }) });
    const port = new FakeConfigDocumentPort({ configVersion: 2, plugins: { child: '@test/child', sibling: '@test/sibling' }, log_level: 'info' });
    const runtime = new RootRuntime({ projectRoot: project, modules, config: port,
      environment: { name: 'test', mode: 'test', platform: 'node' }, configUpdates: [{ id: 'model', paths: [['log_level']],
        validate({ next }) { if (next.log_level === 'debug') throw new Error('invalid model reference'); }, async prepare() { throw new Error('must not prepare invalid input'); },
      }],
    });
    const initial = await runtime.start();
    try {
      await expect(runtime.patchConfig([{ op: 'set', path: ['log_level'], value: 'debug' }, { op: 'set', path: ['child', 'label'], value: 'two' }])).rejects.toThrow('invalid model reference');
      expect(port.commits).toBe(0); expect(runtime.snapshot).toBe(initial);
      expect(port.document.log_level).toBe('info');
    } finally { await runtime.stop(); }
  });
  it('publishes exact Host paths and generation-private versions without exposing them to old or forged leases', async () => {
    const project = await createProject();
    const modules = new FakeModuleRuntime();
    for (const source of ['plugin.ts', 'plugins/child/plugin.ts', 'plugins/sibling/plugin.ts']) {
      modules.set(join(project, source), { default: definePlugin({ name: 'fixture', setup() {} }) });
    }
    const token = createRootPrivateToken<{ level: unknown }>('test.versioned-config');
    const config = new FakeConfigDocumentPort({ configVersion: 2, plugins: { child: '@test/child', sibling: '@test/sibling' },
      log_level: 'info', http: { port: 8080 } });
    const runtime = new RootRuntime({ projectRoot: project, modules, config,
      environment: { name: 'test', mode: 'test', platform: 'node' },
      installResources({ resources, config: primary }) { resources.provide(token, { level: primary.get('log_level') }); },
      configUpdates: [{ id: 'level', paths: [['log_level']], async prepare(input) {
        expect(input.readRootResource(token)).toEqual({ level: 'info' });
        expect(input.current.resources.get(rootPluginId())?.has(token.id)).toBe(false);
        return { effect: 'in-place', rootResources: new Map([[token, { level: input.next.log_level }]]) };
      } }],
    });
    await runtime.start();
    const old = runtime.snapshots.acquire();
    try {
      await runtime.patchConfig([{ op: 'set', path: ['http', 'port'], value: 9090 }, { op: 'set', path: ['log_level'], value: 'debug' }]);
      const current = runtime.snapshots.acquire();
      try {
        expect(runtime.snapshots.rootResource?.(old, token)).toEqual({ level: 'info' });
        expect(runtime.snapshots.rootResource?.(current, token)).toEqual({ level: 'debug' });
        expect(runtime.snapshots.rootResource?.(current, createRootPrivateToken(token.id))).toBeUndefined();
        expect((current.value.resources.get(rootPluginId())?.get(primaryConfigToken.id) as PrimaryConfig).document.http).toEqual({ port: 8080 });
      } finally { current.release(); }
      expect(runtime.configurationApplication.groups).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: 'level', status: 'applied' }), expect.objectContaining({ status: 'restart-pending' }),
      ]));
      await runtime.reload(childPluginId(rootPluginId(), 'child'));
      await runtime.control(async context => {
        expect(context.readRootResource(token)).toEqual({ level: 'debug' });
        const retained = context.retain();
        expect(retained.value).toBe(context.lease.value);
        retained.release();
        expect(await runtime.control(async nested => nested === context, context)).toBe(true);
        await expect(runtime.control(async () => undefined)).rejects.toThrow('Recursive Runtime control');
      });
    } finally { old.release(); await runtime.stop(); }
  });
  it('validates and atomically replaces only the shallowest changed Plugin forests', async () => {
    const project = await createProject();
    const modules = new FakeModuleRuntime();
    const setupCalls = { root: 0, child: 0, sibling: 0 };
    const observed = { root: [] as unknown[], child: [] as unknown[], sibling: [] as unknown[] };
    modules.set(join(project, 'plugin.ts'), {
      default: definePlugin({
        name: 'root',
        setup({ config }) {
          setupCalls.root += 1;
          observed.root.push(config.get());
        },
      }),
    });
    modules.set(join(project, 'plugins/child/plugin.ts'), {
      default: definePlugin({
        name: 'child',
        setup({ config }) {
          const value = config.get() as { readonly label: string };
          if (value.label === 'broken') throw new Error('child config setup failed');
          setupCalls.child += 1;
          observed.child.push(value);
        },
      }),
    });
    modules.set(join(project, 'plugins/sibling/plugin.ts'), {
      default: definePlugin({
        name: 'sibling',
        setup({ config }) {
          setupCalls.sibling += 1;
          observed.sibling.push(config.get());
        },
      }),
    });

    const runtime = new RootRuntime({ config: { configVersion: 2, plugins: {"child":"@test/child","sibling":"@test/sibling"} },
      projectRoot: project,
      modules,
      environment: { name: 'test', mode: 'test', platform: 'node' },
    });
    await runtime.start();
    const child = childPluginId(rootPluginId(), 'child');
    const sibling = childPluginId(rootPluginId(), 'sibling');

    const childUpdate = await runtime.patchConfig([{
      op: 'set',
      path: ['child', 'label'],
      value: 'v2',
    }]);
    expect(childUpdate.generation).toBe(2);
    expect(childUpdate.config.get(child)).toEqual({ label: 'v2' });
    expect(setupCalls).toEqual({ root: 1, child: 2, sibling: 1 });
    expect(observed.child).toEqual([{ label: 'v1' }, { label: 'v2' }]);

    await expect(runtime.patchConfig([{
      op: 'set',
      path: ['child', 'label'],
      value: 42,
    }])).rejects.toBeInstanceOf(ConfigValidationError);
    expect(runtime.snapshot).toBe(childUpdate);
    expect(setupCalls).toEqual({ root: 1, child: 2, sibling: 1 });

    await expect(runtime.patchConfig([{
      op: 'set',
      path: ['child', 'label'],
      value: 'broken',
    }])).rejects.toThrow('child config setup failed');
    expect(runtime.snapshot).toBe(childUpdate);
    expect(runtime.snapshot.config.get(child)).toEqual({ label: 'v2' });
    expect(setupCalls).toEqual({ root: 1, child: 2, sibling: 1 });

    const noChange = await runtime.patchConfig([{
      op: 'set',
      path: ['child', 'label'],
      value: 'v2',
    }]);
    expect(noChange).toBe(childUpdate);

    await Promise.all([
      runtime.patchConfig([{
        op: 'set',
        path: ['child', 'label'],
        value: 'v3',
      }]),
      runtime.patchConfig([{
        op: 'set',
        path: ['sibling', 'label'],
        value: 's2',
      }]),
    ]);
    expect(runtime.snapshot.generation).toBe(4);
    expect(runtime.snapshot.config.get(child)).toEqual({ label: 'v3' });
    expect(runtime.snapshot.config.get(sibling)).toEqual({ label: 's2' });
    expect(setupCalls).toEqual({ root: 1, child: 3, sibling: 2 });

    await runtime.patchConfig([{
      op: 'set',
      path: ['plugin', 'mode'],
      value: 'production',
    }]);
    expect(runtime.snapshot.generation).toBe(5);
    expect(runtime.snapshot.config.get(rootPluginId())).toEqual({ mode: 'production' });
    expect(setupCalls).toEqual({ root: 2, child: 4, sibling: 3 });

    await runtime.stop();
  });

  it('saves unsupported Host patches as pending without rebuilding captured resources', async () => {
    const project = await createProject();
    const modules = new FakeModuleRuntime();
    modules.set(join(project, 'plugin.ts'), {
      default: definePlugin({ name: 'root', setup() {} }),
    });
    modules.set(join(project, 'plugins/child/plugin.ts'), {
      default: definePlugin({ name: 'child', setup() {} }),
    });
    modules.set(join(project, 'plugins/sibling/plugin.ts'), {
      default: definePlugin({ name: 'sibling', setup() {} }),
    });
    const installed: unknown[] = [];
    const runtime = new RootRuntime({ config: { configVersion: 2, plugins: {"child":"@test/child","sibling":"@test/sibling"} },
      projectRoot: project,
      modules,
      environment: { name: 'test', mode: 'test', platform: 'node' },
      installResources: ({ config }) => {
        installed.push(structuredClone(config.document));
      },
    });
    const started = await runtime.start();
    expect(installed).toHaveLength(1);

    // A captured Host resource cannot claim a live update simply because its
    // installer ran again. Preserve it until an explicit process restart.
    const patched = await runtime.patchConfig([{
      op: 'set',
      path: ['http', 'port'],
      value: 8080,
    }]);
    expect(patched.generation).toBe(started.generation);
    expect(installed).toHaveLength(1);
    expect(runtime.configurationApplication.groups).toEqual([
      expect.objectContaining({ effect: 'restart-process', status: 'restart-pending', paths: [['http', 'port']] }),
    ]);

    await runtime.stop();
  });

  it('publishes a new primary document without rebuilding Scopes when no Host installer exists', async () => {
    const project = await createProject();
    const modules = new FakeModuleRuntime();
    modules.set(join(project, 'plugin.ts'), {
      default: definePlugin({ name: 'root', setup() {} }),
    });
    modules.set(join(project, 'plugins/child/plugin.ts'), {
      default: definePlugin({ name: 'child', setup() {} }),
    });
    modules.set(join(project, 'plugins/sibling/plugin.ts'), {
      default: definePlugin({ name: 'sibling', setup() {} }),
    });
    const port = new FakeConfigDocumentPort({ configVersion: 2, plugins: {"child":"@test/child","sibling":"@test/sibling"},  });
    const runtime = new RootRuntime({
      projectRoot: project,
      modules,
      environment: { name: 'test', mode: 'test', platform: 'node' },
      config: port,
    });
    const started = await runtime.start();

    const patched = await runtime.patchConfig([{
      op: 'set',
      path: ['http', 'port'],
      value: 8080,
    }]);
    expect(patched.generation).toBe(started.generation + 1);
    expect((patched.resources.get(rootPluginId())?.get(primaryConfigToken.id) as PrimaryConfig).document.http).toEqual({ port: 8080 });
    expect((started.resources.get(rootPluginId())?.get(primaryConfigToken.id) as PrimaryConfig).document.http).toBeUndefined();
    expect(port.commits).toBe(1);
    expect(port.rollbacks).toBe(0);
    expect(port.document).toEqual({ configVersion: 2, plugins: { child: '@test/child', sibling: '@test/sibling' }, http: { port: 8080 } });

    await runtime.stop();
  });

  it('adopts an externally edited config document on reload and on patchConfig', async () => {
    const project = await createProject();
    const modules = new FakeModuleRuntime();
    modules.set(join(project, 'plugin.ts'), {
      default: definePlugin({ name: 'root', setup() {} }),
    });
    modules.set(join(project, 'plugins/child/plugin.ts'), {
      default: definePlugin({ name: 'child', setup() {} }),
    });
    modules.set(join(project, 'plugins/sibling/plugin.ts'), {
      default: definePlugin({ name: 'sibling', setup() {} }),
    });
    const port = new FakeConfigDocumentPort({ configVersion: 2, plugins: {"child":"@test/child","sibling":"@test/sibling"},  });
    const runtime = new RootRuntime({
      projectRoot: project,
      modules,
      environment: { name: 'test', mode: 'test', platform: 'node' },
      config: port,
    });
    await runtime.start();
    const child = childPluginId(rootPluginId(), 'child');

    // External edit (e.g. hand-edited zhin.config.yml picked up by the file
    // watcher): a reload must rebuild from the file, not the stale start-up
    // in-memory document.
    port.writeExternal({ configVersion: 2, plugins: {"child":"@test/child","sibling":"@test/sibling"}, http: { port: 9090 }, child: { label: 'external' } });
    await runtime.reload();
    expect(runtime.snapshot.config.get(child)).toEqual({ label: 'external' });

    // A subsequent patch must apply on top of the external edit instead of
    // hitting a revision conflict or dropping it.
    await runtime.patchConfig([{
      op: 'set',
      path: ['child', 'label'],
      value: 'patched',
    }]);
    expect(runtime.snapshot.config.get(child)).toEqual({ label: 'patched' });
    expect(port.document).toEqual({ configVersion: 2, plugins: {"child":"@test/child","sibling":"@test/sibling"}, http: { port: 9090 }, child: { label: 'patched' } });

    // patchConfig right after an external edit (no reload in between) also
    // adopts the file first.
    port.writeExternal({ configVersion: 2, plugins: {"child":"@test/child","sibling":"@test/sibling"}, http: { port: 7070 }, child: { label: 'again' } });
    await runtime.patchConfig([{
      op: 'set',
      path: ['sibling', 'label'],
      value: 's9',
    }]);
    expect(port.document).toEqual({ configVersion: 2, plugins: {"child":"@test/child","sibling":"@test/sibling"}, http: { port: 7070 }, child: { label: 'again' }, sibling: { label: 's9' } });

    await runtime.stop();
  });

  it('keeps the saved desired source and old effective generation when shadow setup fails', async () => {
    const project = await createProject();
    const modules = new FakeModuleRuntime();
    modules.set(join(project, 'plugin.ts'), {
      default: definePlugin({ name: 'root', setup() {} }),
    });
    modules.set(join(project, 'plugins/child/plugin.ts'), {
      default: definePlugin({
        name: 'child',
        setup({ config }) {
          if ((config.get() as { readonly label: string }).label === 'broken') {
            throw new Error('child config setup failed');
          }
        },
      }),
    });
    modules.set(join(project, 'plugins/sibling/plugin.ts'), {
      default: definePlugin({ name: 'sibling', setup() {} }),
    });
    const port = new FakeConfigDocumentPort({ configVersion: 2, plugins: {"child":"@test/child","sibling":"@test/sibling"},  });
    const runtime = new RootRuntime({
      projectRoot: project,
      modules,
      environment: { name: 'test', mode: 'test', platform: 'node' },
      config: port,
    });
    const started = await runtime.start();

    await expect(runtime.patchConfig([{
      op: 'set',
      path: ['child', 'label'],
      value: 'broken',
    }])).rejects.toThrow('child config setup failed');
    expect(runtime.snapshot).toBe(started);
    expect(port.commits).toBe(1);
    expect(port.rollbacks).toBe(0);
    expect(port.document).toEqual({ configVersion: 2, plugins: { child: '@test/child', sibling: '@test/sibling' }, child: { label: 'broken' } });
    expect(runtime.configurationApplication).toMatchObject({ saved: true, generation: started.generation });

    port.diverge = true;
    await expect(runtime.patchConfig([{
      op: 'set',
      path: ['child', 'label'],
      value: 'v2',
    }])).rejects.toBeInstanceOf(ConfigDocumentDivergenceError);
    expect(runtime.snapshot).toBe(started);
    expect(port.commits).toBe(1);
    expect(port.rollbacks).toBe(1);
    expect(port.document).toEqual({ configVersion: 2, plugins: { child: '@test/child', sibling: '@test/sibling' }, child: { label: 'broken' } });

    await runtime.stop();
  });
});

class FakeConfigDocumentPort implements ConfigDocumentPort {
  commits = 0;
  rollbacks = 0;
  diverge = false;
  #document: RuntimeConfigDocument;
  #revision = 0;

  constructor(document: RuntimeConfigDocument) {
    this.#document = structuredClone(document);
  }

  get document(): RuntimeConfigDocument {
    return this.#document;
  }

  /** Simulates an external edit of the backing config file. */
  writeExternal(document: RuntimeConfigDocument): void {
    this.#document = structuredClone(document);
    this.#revision += 1;
  }

  async read(): Promise<ConfigDocumentSnapshot> {
    return { document: structuredClone(this.#document), revision: `r${this.#revision}` };
  }

  async prepare(
    current: ConfigDocumentSnapshot,
    patches: readonly ConfigPatch[],
  ): Promise<PreparedConfigDocument> {
    const document = structuredClone(current.document) as Record<string, unknown>;
    if (this.diverge) document.diverged = true;
    else {
      for (const patch of patches) {
        if (patch.op !== 'set') continue;
        let target = document;
        for (const segment of patch.path.slice(0, -1)) {
          target = (target[segment] ??= {}) as Record<string, unknown>;
        }
        target[patch.path[patch.path.length - 1]!] = structuredClone(patch.value);
      }
    }
    return {
      document,
      commit: async () => {
        this.commits += 1;
        this.#revision += 1;
        this.#document = structuredClone(document);
        return { document, revision: `r${this.#revision}` };
      },
      rollback: async () => {
        this.rollbacks += 1;
      },
    };
  }
}

class FakeModuleRuntime implements ModuleRuntime {
  readonly #modules = new Map<string, unknown>();

  set(source: string, value: unknown): void {
    this.#modules.set(source, value);
  }

  async load<T>(source: string): Promise<T> {
    if (!this.#modules.has(source)) throw new Error(`Missing fake module: ${source}`);
    return this.#modules.get(source) as T;
  }

  async close(): Promise<void> {}
}

async function createProject(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'zhin-runtime-config-patch-'));
  temporary.push(root);
  await writeJson(join(root, 'package.json'), {
    name: '@test/root',
    dependencies: {
      '@test/child': 'workspace:*',
      '@test/sibling': 'workspace:*',
    },
    zhin: {
      protocol: 1,
      type: 'plugin',
      entry: './plugin.ts',
      plugins: [],
    },
  });
  await writeSchema(join(root, 'schema.json'), 'mode', 'development');
  await pluginPackage(root, 'child', '@test/child', 'v1');
  await pluginPackage(root, 'sibling', '@test/sibling', 's1');
  for (const file of [
    'plugin.ts',
    'plugins/child/plugin.ts',
    'plugins/sibling/plugin.ts',
  ]) await touch(join(root, file));
  return realpath(root);
}

async function pluginPackage(
  root: string,
  directory: string,
  name: string,
  defaultLabel: string,
): Promise<void> {
  await writeJson(join(root, `plugins/${directory}/package.json`), {
    name,
    zhin: { protocol: 1, type: 'plugin', entry: './plugin.ts' },
  });
  await writeSchema(join(root, `plugins/${directory}/schema.json`), 'label', defaultLabel);
}

async function writeSchema(
  path: string,
  property: string,
  defaultValue: string,
): Promise<void> {
  await writeJson(path, {
    type: 'object',
    additionalProperties: false,
    properties: { [property]: { type: 'string', default: defaultValue } },
  });
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function touch(path: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, '');
}
