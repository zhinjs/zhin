import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import adapterFeature, { Adapter, AdapterIndex, adapterFeatureId, createEndpointSpecification, defineAdapter,
  endpointSpec, endpointEventGatewayToken } from '@zhin.js/adapter';
import { definePlugin, type RuntimeConfigDocument } from '@zhin.js/plugin-runtime';
import { RootRuntime, type ModuleRuntime } from '@zhin.js/runtime';
import { createSenderEnricher } from '@zhin.js/core/runtime';
import { chatRolesFromDocument } from './chat-role-fixture.js';

const document = (configs: Record<string, unknown>): RuntimeConfigDocument => ({ configVersion: 2,
  plugins: Object.fromEntries(Object.keys(configs).map(key => [key, '@fixture/adapter'])), ...configs });

const ROLES_SCHEMA = { type: 'object', properties: { inherit: { type: 'boolean' }, mappings: { type: 'array', items: { type: 'object' } } } };

describe('chat role mapping rules from the live configuration (ADR 0056 §4)', () => {
  it('applies adapter / account mapping changes live, without a restart, and keeps stored grants', async () => {
    const project = await realpath(await mkdtemp(join(tmpdir(), 'zhin-role-config-')));
    const modules = new Modules();
    let root: RootRuntime | undefined;
    const write = async (source: string, value: unknown) => { await mkdir(dirname(source), { recursive: true }); await writeFile(source, JSON.stringify(value)); };
    try {
      await write(join(project, 'package.json'), { name: '@fixture/root', dependencies: { '@fixture/adapter': 'workspace:*' },
        zhin: { protocol: 1, type: 'plugin', entry: './plugin.ts' } });
      await write(join(project, 'plugins/adapter/package.json'), { name: '@fixture/adapter', dependencies: { '@fixture/adapter-feature': 'workspace:*' },
        zhin: { protocol: 1, type: 'plugin', entry: './plugin.ts', features: [{ package: '@fixture/adapter-feature' }] } });
      await write(join(project, 'plugins/adapter/schema.json'), { type: 'object', additionalProperties: false, properties: {
        nickname: { type: 'string' }, roles: ROLES_SCHEMA, endpoints: { type: 'array', items: { type: 'object' } },
      } });
      await write(join(project, 'packages/adapter-feature/package.json'), { name: '@fixture/adapter-feature', zhin: { protocol: 1, type: 'feature', entry: './index.ts' } });
      for (const [source, value] of [
        ['plugin.ts', { default: definePlugin({ name: 'root' }) }],
        ['plugins/adapter/plugin.ts', { default: definePlugin({ name: 'account', configUpdate: { featurePaths: [['nickname'], ['roles'], ['endpoints']] } }) }],
        ['packages/adapter-feature/index.ts', { default: adapterFeature }],
      ] as const) { await write(join(project, source), {}); modules.set(join(project, source), value); }
      const adapterSource = join(project, 'plugins/adapter/adapters/local/index.ts');
      await write(adapterSource, {});
      modules.set(adapterSource, { default: defineAdapter({ capabilities: ['inbound'], createAdapter() {
        class Client { readonly [endpointSpec] = createEndpointSpecification(this, { start() {}, open() {}, close() {}, stop() {} }); }
        return new class extends Adapter<Client> { protected createEndpoint() { return new Client(); } }();
      } }) });
      const account = { nickname: 'Before', endpoints: [{ id: 'one' }, { id: 'two' }] };
      const startup = document({ account });
      const roles = await chatRolesFromDocument(startup);
      await roles.store.grant({ level: 'endpoint', key: 'account/one', adapter: 'account', userId: 'owner-one', role: 'owner' });
      const enrich = createSenderEnricher({ roles: () => roles });
      root = new RootRuntime({ projectRoot: project, modules, config: startup,
        environment: { name: 'test', mode: 'test', platform: 'node' },
        installResources({ resources }) { resources.provide(endpointEventGatewayToken, { run: async receive => receive({ receive: async () => undefined }), receive: async () => undefined }); },
      });
      const initial = await root.start();
      const index = initial.projections.get(adapterFeatureId) as AdapterIndex;
      const child = (id: string) => index.adapters()[0].runtimeEntries().find(entry => entry.desired.endpointId === id)!;
      const group = (id: string) => ({ endpoint: { id: child(id).desired.canonicalId, adapter: 'local' }, kind: 'group' as const, id: 'group' });
      const admin = { id: 'mod', platform: { standing: 'admin' as const } };
      const owner = { id: 'boss', platform: { standing: 'owner' as const } };
      // Default rule: group owners / admins are admin of that conversation.
      expect(enrich(admin, group('one'), initial)?.chatRole).toBe('admin');
      expect(enrich({ id: 'owner-one' }, group('one'), initial)?.chatRole).toBe('owner');
      // Tighten at the adapter level (owners only) and turn mapping off for account two.
      await root.patchConfig([{ op: 'set', path: ['account'], value: { ...account,
        roles: { mappings: [{ match: { standing: ['admin', 'owner'] }, grant: 'none' }, { match: { standing: ['owner'] }, grant: 'admin' }] },
        endpoints: [{ id: 'one' }, { id: 'two', roles: { inherit: false } }] } }]);
      expect(root.configurationApplication.groups.every(entry => entry.status === 'applied')).toBe(true);
      expect(enrich(admin, group('one'), root.snapshot)?.chatRole).toBeUndefined();
      expect(enrich(owner, group('one'), root.snapshot)?.chatRole).toBe('admin');
      expect(enrich(owner, group('two'), root.snapshot)?.chatRole).toBeUndefined();
      expect(enrich({ id: 'owner-one' }, group('one'), root.snapshot)?.chatRole).toBe('owner');
      // Configuration cannot map to owner / trusted: such a rule is ignored even if it got past validation.
      await root.patchConfig([{ op: 'set', path: ['account', 'roles'], value: { mappings: [{ match: { standing: ['admin'] }, grant: 'owner' }] } }]);
      expect(enrich(admin, group('one'), root.snapshot)?.chatRole).toBe('admin');
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
