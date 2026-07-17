import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { definePlugin } from '@zhin.js/plugin-runtime';
import { ConfigValidationError, RootRuntime, type ModuleRuntime } from '@zhin.js/next-runtime';
import {
  ConfigDocumentConflictError,
  ConfigDocumentParseError,
  YamlConfigDocument,
} from '../src/index.js';

const temporary: string[] = [];

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true })));
});

describe('YamlConfigDocument', () => {
  it('patches its AST while preserving comments, expressions, aliases and indentation', async () => {
    const { file } = await configFile(`# root comment
plugin:
    endpoint: "\${API_URL}" # expression
    defaults: &defaults
        retries: 3
    inherited: *defaults
plugins:
    child:
        label: 'v1' # label
        obsolete: true
`);
    const adapter = new YamlConfigDocument(file);
    const current = await adapter.read();
    const prepared = await adapter.prepare(current, [
      { op: 'set', path: ['plugins', 'child', 'label'], value: 'v2' },
      { op: 'remove', path: ['plugins', 'child', 'obsolete'] },
    ]);

    const committed = await prepared.commit();
    const output = await readFile(file, 'utf8');

    expect(committed.document).toMatchObject({ plugins: { child: { label: 'v2' } } });
    expect(output).toContain('# root comment');
    expect(output).toContain('"${API_URL}" # expression');
    expect(output).toContain('&defaults');
    expect(output).toContain('*defaults');
    expect(output).toContain("        label: 'v2' # label");
    expect(output).not.toContain('obsolete');
  });

  it('restores the exact previous bytes when a committed transaction rolls back', async () => {
    const original = 'plugin:\r\n    mode: development # keep\r\nplugins: {}\r\n';
    const { file } = await configFile(original);
    const adapter = new YamlConfigDocument(file);
    const prepared = await adapter.prepare(await adapter.read(), [{
      op: 'set', path: ['plugin', 'mode'], value: 'production',
    }]);

    await prepared.commit();
    await prepared.rollback();

    expect(await readFile(file, 'utf8')).toBe(original);
  });

  it('refuses to overwrite an edit made after prepare', async () => {
    const { file } = await configFile('plugin: {}\nplugins: {}\n');
    const adapter = new YamlConfigDocument(file);
    const prepared = await adapter.prepare(await adapter.read(), [{
      op: 'set', path: ['plugin', 'mode'], value: 'production',
    }]);
    const external = 'plugin:\n  mode: external\nplugins: {}\n';
    await writeFile(file, external);

    await expect(prepared.commit()).rejects.toBeInstanceOf(ConfigDocumentConflictError);
    expect(await readFile(file, 'utf8')).toBe(external);
  });

  it('reports malformed YAML before exposing a snapshot', async () => {
    const { file } = await configFile('plugin: [\n');
    await expect(new YamlConfigDocument(file).read())
      .rejects.toBeInstanceOf(ConfigDocumentParseError);
  });
});

describe('RootRuntime with YamlConfigDocument', () => {
  it('commits valid patches with the generation and leaves failed candidates untouched', async () => {
    const project = await createProject('plugins:\n  child:\n    label: v1\n');
    const file = join(project, 'config.yml');
    const modules = new FakeModuleRuntime();
    modules.set(join(project, 'plugin.ts'), { default: definePlugin({ name: 'root' }) });
    modules.set(join(project, 'plugins/child/plugin.ts'), {
      default: definePlugin({
        name: 'child',
        setup({ config }) {
          const value = config.get() as { readonly label: string };
          if (value.label === 'broken') throw new Error('shadow setup failed');
        },
      }),
    });
    const runtime = createRuntime(project, modules, file);
    await runtime.start();

    const committed = await runtime.patchConfig([{
      op: 'set', path: ['plugins', 'child', 'label'], value: 'v2',
    }]);
    expect(committed.generation).toBe(2);
    expect(await readFile(file, 'utf8')).toContain('label: v2');
    const stableSource = await readFile(file, 'utf8');

    await expect(runtime.patchConfig([{
      op: 'set', path: ['plugins', 'child', 'label'], value: 42,
    }])).rejects.toBeInstanceOf(ConfigValidationError);
    await expect(runtime.patchConfig([{
      op: 'set', path: ['plugins', 'child', 'label'], value: 'broken',
    }])).rejects.toThrow('shadow setup failed');

    expect(runtime.snapshot).toBe(committed);
    expect(await readFile(file, 'utf8')).toBe(stableSource);
    await runtime.stop();
  });

  it('persists an explicit schema default without publishing an empty generation', async () => {
    const project = await createProject('plugin: {}\nplugins:\n  child: {}\n');
    const file = join(project, 'config.yml');
    const modules = new FakeModuleRuntime();
    modules.set(join(project, 'plugin.ts'), { default: definePlugin({ name: 'root' }) });
    modules.set(join(project, 'plugins/child/plugin.ts'), {
      default: definePlugin({ name: 'child' }),
    });
    const runtime = createRuntime(project, modules, file);
    const started = await runtime.start();

    const result = await runtime.patchConfig([{
      op: 'set', path: ['plugins', 'child', 'label'], value: 'v1',
    }]);

    expect(result).toBe(started);
    expect(await readFile(file, 'utf8')).toContain('label: v1');
    await runtime.stop();
  });
});

class FakeModuleRuntime implements ModuleRuntime {
  readonly #modules = new Map<string, unknown>();
  set(source: string, value: unknown): void { this.#modules.set(source, value); }
  async load<T>(source: string): Promise<T> {
    if (!this.#modules.has(source)) throw new Error(`Missing fake module: ${source}`);
    return this.#modules.get(source) as T;
  }
  async close(): Promise<void> {}
}

function createRuntime(project: string, modules: ModuleRuntime, file: string): RootRuntime {
  return new RootRuntime({
    projectRoot: project,
    modules,
    environment: { name: 'test', mode: 'test', platform: 'node' },
    config: new YamlConfigDocument(file),
  });
}

async function configFile(source: string): Promise<{ readonly root: string; readonly file: string }> {
  const root = await mkdtemp(join(tmpdir(), 'zhin-next-yaml-'));
  temporary.push(root);
  const file = join(root, 'config.yml');
  await writeFile(file, source);
  return { root, file };
}

async function createProject(config: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'zhin-next-yaml-runtime-'));
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
  await writeFile(join(root, 'config.yml'), config);
  return root;
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}
