import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import adapterFeature, { Adapter, AdapterIndex, adapterFeatureId, createEndpointSpecification, defineAdapter,
  endpointSpec, endpointEventGatewayToken } from '@zhin.js/adapter';
import { childPluginId, definePlugin, rootPluginId, type RuntimeConfigDocument } from '@zhin.js/plugin-runtime';
import { RootRuntime, primaryConfigToken, type PrimaryConfig, type ModuleRuntime } from '@zhin.js/runtime';
import { createEndpointRoleConfigurationSelection, createEndpointRoleResolver, createSenderEnricher } from '@zhin.js/core/runtime';

const document = (configs: Record<string, unknown>): RuntimeConfigDocument => ({ configVersion: 2,
  plugins: Object.fromEntries(Object.keys(configs).map(key => [key, '@fixture/adapter'])), ...configs });
afterEach(() => vi.unstubAllEnvs());

describe('process-owned endpoint role configuration', () => {
  it.each([
    { name: 'profile only', before: { one: { nickname: 'before', master: 'owner' } }, after: { one: { nickname: 'after', master: 'owner' } }, selected: [] },
    { name: 'trusted membership order', before: { one: { trusted: ['a', 'b', 'a'] } }, after: { one: { trusted: 'b,a' } }, selected: [] },
    { name: 'stable endpoint reorder', before: { one: { endpoints: [{ id: 'a', master: 'a-owner' }, { id: 'b', master: 'b-owner' }] } },
      after: { one: { endpoints: [{ id: 'b', master: 'b-owner' }, { id: 'a', master: 'a-owner' }] } }, selected: [] },
    { name: 'new account identity', before: { one: { endpoints: [{ id: 'a', master: 'owner' }] } }, after: { one: { endpoints: [{ id: 'b', master: 'owner' }] } }, selected: ['one'] },
    { name: 'duplicate account identity', before: { one: { endpoints: [{ id: 'same', master: 'owner' }] } },
      after: { one: { endpoints: [{ id: 'same', master: 'owner' }, { id: 'same', master: 'other' }] } }, selected: ['one'] },
    { name: 'role-free new alias', before: { one: { master: 'owner' } }, after: { one: { master: 'owner' }, extra: {} }, selected: [] },
    { name: 'new alias borrows startup legacy owner', before: { one: { name: 'legacy', master: 'owner' } },
      after: { one: { name: 'legacy', master: 'owner' }, legacy: {} }, selected: ['legacy', 'one'] },
    { name: 'pure owner deletion', before: { one: { master: 'owner' } }, after: {}, selected: [] },
    { name: 'deletion changes live legacy ambiguity', before: { one: { name: 'legacy', master: 'one' }, two: { name: 'legacy', master: 'two' } },
      after: { two: { name: 'legacy', master: 'two' } }, selected: ['one', 'two'] },
  ])('selects by actual startup permissions: $name', async ({ before, after, selected }) => {
    const startup = document(before);
    const resolver = await createEndpointRoleResolver(startup);
    const guard = createEndpointRoleConfigurationSelection(startup, resolver);
    expect(guard.select({ previous: startup, next: document(after), expand: value => value }).map(item => item.instanceKey).sort()).toEqual(selected);
  });

  it('keeps checking the startup resolver after deletion, re-addition and disable', async () => {
    const startup = document({ one: { master: 'old-owner' } });
    const guard = createEndpointRoleConfigurationSelection(startup, await createEndpointRoleResolver(startup));
    const removed = document({});
    expect(guard.select({ previous: startup, next: removed, expand: value => value })).toEqual([]);
    expect(guard.select({ previous: removed, next: document({ one: { master: 'new-owner' } }), expand: value => value }))
      .toContainEqual({ instanceKey: 'one', reasonCode: 'endpoint-roles-process-owned' });
    const disabled = { ...document({ one: { master: 'new-owner' } }), disable_plugins: ['one'] };
    expect(guard.select({ previous: startup, next: disabled, expand: value => value })).toContainEqual({ instanceKey: 'one', reasonCode: 'endpoint-roles-process-owned' });
  });

  it('uses only the effective environment expansion supplied by Root for candidate roles', async () => {
    vi.stubEnv('OWNER', 'global-value-must-not-be-read');
    const startup = document({ one: { endpoints: [{ id: 'account', master: 'effective-owner', trusted: ['effective-trusted'] }] } });
    const guard = createEndpointRoleConfigurationSelection(startup, await createEndpointRoleResolver(startup));
    const next = document({ one: { endpoints: [{ id: 'account', master: '${OWNER}', trusted: ['${TRUSTED}'] }] } });
    const expand = <T>(value: T): T => JSON.parse(JSON.stringify(value).replaceAll('${OWNER}', 'effective-owner').replaceAll('${TRUSTED}', 'effective-trusted'));
    expect(guard.select({ previous: startup, next, expand })).toEqual([]);
    const changed = <T>(value: T): T => JSON.parse(JSON.stringify(value).replaceAll('${OWNER}', 'changed-owner').replaceAll('${TRUSTED}', 'effective-trusted'));
    expect(guard.select({ previous: startup, next, expand: changed })).toContainEqual({ instanceKey: 'one', reasonCode: 'endpoint-roles-process-owned' });
  });

  it('keeps the real sender enricher and effective account roles aligned while independent edits apply', async () => {
    const project = await realpath(await mkdtemp(join(tmpdir(), 'zhin-role-config-')));
    const modules = new Modules();
    let root: RootRuntime | undefined;
    const write = async (source: string, value: unknown) => { await mkdir(dirname(source), { recursive: true }); await writeFile(source, JSON.stringify(value)); };
    try {
      await write(join(project, 'package.json'), { name: '@fixture/root', dependencies: { '@fixture/adapter': 'workspace:*', '@fixture/extra': 'workspace:*' },
        zhin: { protocol: 1, type: 'plugin', entry: './plugin.ts' } });
      await write(join(project, 'plugins/adapter/package.json'), { name: '@fixture/adapter', dependencies: { '@fixture/adapter-feature': 'workspace:*' },
        zhin: { protocol: 1, type: 'plugin', entry: './plugin.ts', features: [{ package: '@fixture/adapter-feature' }] } });
      await write(join(project, 'plugins/adapter/schema.json'), { type: 'object', additionalProperties: false, properties: {
        nickname: { type: 'string' }, endpoints: { type: 'array', items: { type: 'object' } },
      } });
      await write(join(project, 'plugins/extra/package.json'), { name: '@fixture/extra', zhin: { protocol: 1, type: 'plugin', entry: './plugin.ts' } });
      await write(join(project, 'plugins/extra/schema.json'), { type: 'object', properties: { label: { type: 'string' } } });
      await write(join(project, 'packages/adapter-feature/package.json'), { name: '@fixture/adapter-feature', zhin: { protocol: 1, type: 'feature', entry: './index.ts' } });
      for (const [source, value] of [
        ['plugin.ts', { default: definePlugin({ name: 'root' }) }],
        ['plugins/adapter/plugin.ts', { default: definePlugin({ name: 'account', configUpdate: { featurePaths: [['nickname'], ['endpoints']] } }) }],
        ['plugins/extra/plugin.ts', { default: definePlugin({ name: 'extra' }) }],
        ['packages/adapter-feature/index.ts', { default: adapterFeature }],
      ] as const) { await write(join(project, source), {}); modules.set(join(project, source), value); }
      const adapterSource = join(project, 'plugins/adapter/adapters/local/index.ts');
      await write(adapterSource, {});
      modules.set(adapterSource, { default: defineAdapter({ capabilities: ['inbound'], createAdapter() {
        class Client { readonly [endpointSpec] = createEndpointSpecification(this, { start() {}, open() {}, close() {}, stop() {} }); }
        return new class extends Adapter<Client> { protected createEndpoint() { return new Client(); } }();
      } }) });
      const account = { nickname: 'Before', master: 'base-owner', trusted: ['base-trusted'],
        endpoints: [{ id: 'one', master: 'owner-one', trusted: ['trusted-one'] }, { id: 'two', master: 'owner-two' }] };
      const startup = { ...document({ account }), plugins: { account: '@fixture/adapter', extra: '@fixture/extra' }, extra: { label: 'before' } };
      const resolver = await createEndpointRoleResolver(startup);
      const enrich = (await createSenderEnricher(startup, resolver))!;
      root = new RootRuntime({ projectRoot: project, modules, config: startup,
        environment: { name: 'test', mode: 'test', platform: 'node' },
        installResources({ resources }) { resources.provide(endpointEventGatewayToken, { run: async receive => receive({ receive: async () => undefined }), receive: async () => undefined }); },
        pluginConfigurationSelection: createEndpointRoleConfigurationSelection(startup, resolver),
      });
      const initial = await root.start();
      const index = initial.projections.get(adapterFeatureId) as AdapterIndex;
      const first = index.adapters()[0].runtimeEntries().find(child => child.desired.endpointId === 'one')!;
      const conversation = { endpoint: { id: first.desired.canonicalId, adapter: 'local' }, kind: 'group' as const, id: 'group' };
      expect(enrich({ id: 'owner-one' }, conversation, initial)?.roles).toEqual(['master']);
      await root.patchConfig([{ op: 'set', path: ['account'], value: { nickname: 'After', master: 'new-base',
        endpoints: [{ id: 'two', master: 'new-two' }, { id: 'one', master: 'new-one' }] } },
      { op: 'set', path: ['extra', 'label'], value: 'independent' }]);
      expect(root.snapshot.config.get(childPluginId(rootPluginId(), 'account'))).toMatchObject({ nickname: account.nickname, endpoints: account.endpoints });
      expect((root.snapshot.resources.get(rootPluginId())?.get(primaryConfigToken.id) as PrimaryConfig).document.account).toEqual(account);
      expect(root.snapshot.config.get(childPluginId(rootPluginId(), 'extra'))).toEqual({ label: 'independent' });
      expect(enrich({ id: 'owner-one' }, conversation, root.snapshot)?.roles).toEqual(['master']);
      expect(enrich({ id: 'new-one' }, conversation, root.snapshot)?.roles).toBeUndefined();
      expect(root.configurationApplication.groups).toContainEqual(expect.objectContaining({ id: 'plugin-host:account', status: 'restart-pending' }));
      await root.patchConfig([{ op: 'set', path: ['account'], value: { ...account, nickname: 'Profile only' } }]);
      expect(root.snapshot.config.get(childPluginId(rootPluginId(), 'account'))).toMatchObject({ nickname: 'Profile only', endpoints: account.endpoints });
      expect(root.configurationApplication.groups.every(group => group.status === 'applied')).toBe(true);
      expect((root.snapshot.projections.get(adapterFeatureId) as AdapterIndex).clientById(first.desired.canonicalId)).toBe(index.clientById(first.desired.canonicalId));
      await root.patchConfig([{ op: 'set', path: ['account', 'master'], value: 'changed-while-disabled' },
        { op: 'set', path: ['disable_plugins'], value: ['account'] }]);
      expect(root.snapshot.tree.has(childPluginId(rootPluginId(), 'account'))).toBe(false);
      expect((root.snapshot.resources.get(rootPluginId())?.get(primaryConfigToken.id) as PrimaryConfig).document.account)
        .toMatchObject({ master: 'base-owner', nickname: 'Profile only' });
      await root.patchConfig([{ op: 'remove', path: ['account'] }, { op: 'remove', path: ['plugins', 'account'] },
        { op: 'set', path: ['disable_plugins'], value: [] }]);
      expect(root.snapshot.tree.has(childPluginId(rootPluginId(), 'account'))).toBe(false);
      await root.patchConfig([{ op: 'set', path: ['plugins', 'account'], value: '@fixture/adapter' },
        { op: 'set', path: ['account'], value: { ...account, master: 'changed-after-readd' } }]);
      expect(root.snapshot.tree.has(childPluginId(rootPluginId(), 'account'))).toBe(false);
      expect(root.configurationApplication.groups).toContainEqual(expect.objectContaining({ id: 'plugin-host:account', status: 'restart-pending' }));
      await root.patchConfig([{ op: 'set', path: ['account'], value: { ...account, nickname: 'Safe re-add' } }]);
      expect(root.snapshot.tree.has(childPluginId(rootPluginId(), 'account'))).toBe(true);
      expect(enrich({ id: 'owner-one' }, conversation, root.snapshot)?.roles).toEqual(['master']);
    } finally { await root?.stop(); await rm(project, { recursive: true, force: true }); }
  });
});

class Modules implements ModuleRuntime {
  readonly values = new Map<string, unknown>();
  set(source: string, value: unknown) { this.values.set(source, value); }
  async load<T>(source: string): Promise<T> { if (!this.values.has(source)) throw new Error(`Missing fixture module: ${source}`); return this.values.get(source) as T; }
  invalidate() {}
  async close() {}
}
