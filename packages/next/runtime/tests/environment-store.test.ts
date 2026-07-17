import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  childPluginId,
  definePlugin,
  rootPluginId,
  type PluginId,
  type RuntimeSnapshot,
} from '@zhin.js/next-kernel';
import {
  EnvSchemaParseError,
  EnvironmentVariableMissingError,
  RootRuntime,
  createEnvStore,
  defineEnvSchema,
  defineRuntimeEnvironment,
  envStoreToken,
  type EnvStore,
  type ModuleRuntime,
} from '../src/index.js';

const temporary: string[] = [];

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true })));
});

describe('EnvStore', () => {
  it('applies base, environment and ancestor Plugin overlays in a fixed order', () => {
    const environment = { name: 'test', mode: 'test', platform: 'node' } as const;
    const layers = {
      base: { ENDPOINT: 'base', SHARED: 'base', REMOVED: 'yes' },
      environments: {
        test: { ENDPOINT: 'test', REMOVED: undefined },
      },
      plugins: {
        root: { SHARED: 'root', ROOT_ONLY: 'visible-to-descendants' },
        'root/child': { ENDPOINT: 'child' },
      },
    };

    const root = createEnvStore(rootPluginId(), environment, layers);
    const child = createEnvStore(childPluginId(rootPluginId(), 'child'), environment, layers);

    expect(root.get('ENDPOINT')).toBe('test');
    expect(root.get('SHARED')).toBe('root');
    expect(root.has('REMOVED')).toBe(false);
    expect(child.get('ENDPOINT')).toBe('child');
    expect(child.get('SHARED')).toBe('root');
    expect(child.get('ROOT_ONLY')).toBe('visible-to-descendants');
  });

  it('expands structured values without mutating config and rejects missing variables', () => {
    const store = createEnvStore(
      rootPluginId(),
      { name: 'production', mode: 'production', platform: 'node' },
      { base: { HOST: 'api.example.com', TOKEN: 'secret' } },
    );
    const input = { endpoint: 'https://${HOST}/v1', headers: ['Bearer ${TOKEN}'] };

    const expanded = store.expand(input);

    expect(expanded).toEqual({
      endpoint: 'https://api.example.com/v1',
      headers: ['Bearer secret'],
    });
    expect(input.endpoint).toBe('https://${HOST}/v1');
    expect(Object.isFrozen(expanded)).toBe(true);
    expect(() => store.expand('${MISSING}')).toThrow(EnvironmentVariableMissingError);
  });

  it('redacts declared secrets from parser diagnostics and structured values', () => {
    const store = createEnvStore(
      rootPluginId(),
      { name: 'test', mode: 'test', platform: 'node' },
      { base: { TOKEN: 'top-secret', PORT: 'invalid' } },
    );
    const schema = defineEnvSchema({
      secretKeys: ['TOKEN'],
      parse(source) {
        if (source.PORT === 'invalid') {
          throw new Error(`Cannot connect with ${source.TOKEN}`);
        }
        return { token: source.TOKEN };
      },
    });

    expect(() => store.parse(schema)).toThrow(EnvSchemaParseError);
    try {
      store.parse(schema);
    } catch (error) {
      expect(String(error)).toContain('[REDACTED]');
      expect(String(error)).not.toContain('top-secret');
      expect((error as Error).cause).toBeUndefined();
    }
    expect(store.redact(
      { authorization: 'Bearer top-secret', nested: ['top-secret'] },
      ['TOKEN'],
    )).toEqual({
      authorization: 'Bearer [REDACTED]',
      nested: ['[REDACTED]'],
    });
    expect(store.redact(new Error('Leaked top-secret'), ['TOKEN'])).toEqual(
      expect.objectContaining({ message: 'Leaked [REDACTED]' }),
    );

    const parsed = createEnvStore(
      rootPluginId(),
      { name: 'test', mode: 'test', platform: 'node' },
      { base: { TOKEN: 'safe', PORT: '3000' } },
    ).parse(defineEnvSchema({
      secretKeys: ['TOKEN'],
      parse: (source) => ({ credentials: { token: source.TOKEN }, port: Number(source.PORT) }),
    }));
    expect(parsed).toEqual({ credentials: { token: 'safe' }, port: 3000 });
    expect(Object.isFrozen(parsed)).toBe(true);
    expect(Object.isFrozen(parsed.credentials)).toBe(true);
  });

  it('validates layer identities and runtime modes at the Root boundary', () => {
    expect(() => createEnvStore(
      rootPluginId(),
      { name: 'test', mode: 'test', platform: 'node' },
      { plugins: { '../outside': { TOKEN: 'value' } } },
    )).toThrow('Invalid Plugin environment overlay owner');
    expect(() => defineRuntimeEnvironment({
      name: 'staging', mode: 'staging', platform: 'node',
    } as never)).toThrow('Invalid runtime mode');
  });
});

describe('RootRuntime EnvStore ownership', () => {
  it('injects exact owner views and recreates only the changed subtree view', async () => {
    const project = await createProject();
    const modules = new FakeModuleRuntime();
    const observed = { root: [] as string[], child: [] as string[] };
    modules.set(join(project, 'plugin.ts'), {
      default: definePlugin({
        name: 'root',
        requires: [envStoreToken],
        setup({ resources }) {
          observed.root.push(resources.use(envStoreToken).require('ENDPOINT'));
        },
      }),
    });
    modules.set(join(project, 'plugins/child/plugin.ts'), {
      default: definePlugin({
        name: 'child',
        requires: [envStoreToken],
        setup({ resources }) {
          observed.child.push(resources.use(envStoreToken).require('ENDPOINT'));
        },
      }),
    });
    const runtime = new RootRuntime({
      projectRoot: project,
      modules,
      environment: { name: 'test', mode: 'test', platform: 'node' },
      environmentVariables: {
        base: { ENDPOINT: 'base' },
        environments: { test: { ENDPOINT: 'test' } },
        plugins: { 'root/child': { ENDPOINT: 'child' } },
      },
    });

    const first = await runtime.start();
    const childId = childPluginId(rootPluginId(), 'child');
    expect(envStore(first, rootPluginId()).owner).toBe(rootPluginId());
    expect(envStore(first, childId).owner).toBe(childId);
    expect(observed).toEqual({ root: ['test'], child: ['child'] });

    await runtime.patchConfig([{
      op: 'set', path: ['plugins', 'child', 'label'], value: 'v2',
    }]);

    expect(observed).toEqual({ root: ['test'], child: ['child', 'child'] });
    expect(envStore(runtime.snapshot, childId).require('ENDPOINT')).toBe('child');
    await runtime.stop();
  });
});

function envStore(
  snapshot: RuntimeSnapshot,
  owner: PluginId,
): EnvStore {
  const store = snapshot.resources.get(owner)?.get(envStoreToken.id);
  if (!store) throw new Error(`Missing EnvStore for ${owner}`);
  return store as EnvStore;
}

class FakeModuleRuntime implements ModuleRuntime {
  readonly #modules = new Map<string, unknown>();
  set(source: string, value: unknown): void { this.#modules.set(source, value); }
  async load<T>(source: string): Promise<T> {
    if (!this.#modules.has(source)) throw new Error(`Missing fake module: ${source}`);
    return this.#modules.get(source) as T;
  }
  async close(): Promise<void> {}
}

async function createProject(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'zhin-next-env-store-'));
  temporary.push(root);
  await writeJson(join(root, 'package.json'), {
    name: '@test/root',
    dependencies: { '@test/child': 'workspace:*' },
    zhin: {
      protocol: 1,
      type: 'plugin',
      entry: './plugin.ts',
      plugins: [{ package: '@test/child', instanceKey: 'child' }],
    },
  });
  await writeJson(join(root, 'schema.json'), {
    type: 'object', additionalProperties: false, properties: {},
  });
  await writeJson(join(root, 'plugins/child/package.json'), {
    name: '@test/child',
    zhin: { protocol: 1, type: 'plugin', entry: './plugin.ts' },
  });
  await writeJson(join(root, 'plugins/child/schema.json'), {
    type: 'object',
    additionalProperties: false,
    properties: { label: { type: 'string', default: 'v1' } },
  });
  await writeFile(join(root, 'plugin.ts'), '');
  await writeFile(join(root, 'plugins/child/plugin.ts'), '');
  return root;
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}
