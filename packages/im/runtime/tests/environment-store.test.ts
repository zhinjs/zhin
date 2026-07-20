import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  childPluginId,
  definePlugin,
  rootPluginId,
  type PluginId,
  type RuntimeSnapshot,
} from '@zhin.js/plugin-runtime';
import {
  EnvSchemaParseError,
  EnvironmentVariableMissingError,
  RootRuntime,
  createEnvStore,
  defineEnvSchema,
  defineRuntimeEnvironment,
  envStoreToken,
  expandEnvironmentValue,
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

  it('expands missing config placeholders to empty strings for soft-fail create', () => {
    const store = createEnvStore(
      rootPluginId(),
      { name: 'development', mode: 'development', platform: 'node' },
      { base: { HOST: 'api.example.com' } },
    );

    expect(store.expandMissingAsEmpty({
      token: '${MISSING_TOKEN}',
      url: 'https://${HOST}/v1',
    })).toEqual({
      token: '',
      url: 'https://api.example.com/v1',
    });
  });

  it('supports ${VAR:-default} and ${VAR:=default} fallbacks', () => {
    const store = createEnvStore(
      rootPluginId(),
      { name: 'development', mode: 'development', platform: 'node' },
      { base: { HOST: 'api.example.com', EMPTY: '' } },
    );

    expect(store.expandMissingAsEmpty({
      host: '${HOST:-fallback.example.com}',
      missing: '${MISSING:-fallback}',
      assign: '${MISSING:=fallback}',
      empty: '${EMPTY:-fallback}',
    })).toEqual({
      host: 'api.example.com',
      missing: 'fallback',
      assign: 'fallback',
      empty: 'fallback',
    });

    // Strict expand honors the fallback instead of throwing…
    expect(store.expand('${MISSING:-fallback}')).toBe('fallback');
    // …but a plain missing reference still throws.
    expect(() => store.expand('${MISSING}')).toThrow(EnvironmentVariableMissingError);
  });

  it('expandEnvironmentValue expands arbitrary config from a lookup source', () => {
    const lookup = (key: string) => ({ KEY: 'value' } as Record<string, string>)[key];
    expect(expandEnvironmentValue({
      plain: '${KEY}',
      missing: '${NOPE}',
      fallback: '${NOPE:-d}',
      nested: ['x-${KEY:-y}'],
    }, lookup)).toEqual({
      plain: 'value',
      missing: '',
      fallback: 'd',
      nested: ['x-value'],
    });
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
  const root = await mkdtemp(join(tmpdir(), 'zhin-runtime-env-store-'));
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
  return realpath(root);
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

describe('expandEnvironmentValue linear scanner (no ReDoS)', () => {
  const empty = () => undefined;

  it('keeps legacy semantics for malformed placeholders', () => {
    expect(expandEnvironmentValue('${}', empty)).toBe('${}');
    expect(expandEnvironmentValue('${1A}', empty)).toBe('${1A}');
    expect(expandEnvironmentValue('${A', empty)).toBe('${A');
    expect(expandEnvironmentValue('${A:x}', empty)).toBe('${A:x}');
    expect(expandEnvironmentValue('${A:-}', empty)).toBe('');
    expect(expandEnvironmentValue('${A:-x}y}', empty)).toBe('xy}');
    expect(expandEnvironmentValue('${${A}}', (k) => (k === 'A' ? 'v' : undefined))).toBe('${v}');
  });

  it('keeps :- / := fallback semantics', () => {
    const lookup = (key: string) => ({ SET: 'v', EMPTY: '' } as Record<string, string>)[key];
    expect(expandEnvironmentValue('${SET:-d}', lookup)).toBe('v');
    expect(expandEnvironmentValue('${EMPTY:-d}', lookup)).toBe('d');
    expect(expandEnvironmentValue('${EMPTY:=d}', lookup)).toBe('d');
    expect(expandEnvironmentValue('${NOPE:-a}b}', lookup)).toBe('ab}');
  });

  it('expands 100k adversarial placeholders in linear time', () => {
    const input = `${'${'.repeat(50_000)}${'A'.repeat(50_000)}`;
    const start = performance.now();
    const result = expandEnvironmentValue(input, empty);
    expect(performance.now() - start).toBeLessThan(100);
    expect(typeof result).toBe('string');
  });
});
