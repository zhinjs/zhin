import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { definePlugin } from '@zhin.js/plugin-runtime';
import { RootRuntime, type ModuleRuntime } from '@zhin.js/runtime';
import {
  ConfigDocumentConflictError,
  ConfigDocumentParseError,
  JsonConfigDocument,
  YamlConfigDocument,
  createConfigDocument,
} from '../src/index.js';

const temporary: string[] = [];

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true })));
});

describe('JsonConfigDocument', () => {
  it('materializes a missing document on commit and removes it on rollback', async () => {
    const root = await mkdtemp(join(tmpdir(), 'zhin-runtime-json-missing-'));
    temporary.push(root);
    const file = join(root, 'zhin.config.json');
    const document = new JsonConfigDocument(file);
    const current = await document.read();

    expect(current.document).toEqual({});
    const prepared = await document.prepare(current, [{
      op: 'set', path: ['plugins', 'demo', 'endpoints'], value: [{ id: 'bot' }],
    }]);
    await prepared.commit();
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({
      plugins: { demo: { endpoints: [{ id: 'bot' }] } },
    });

    await prepared.rollback();
    await expect(readFile(file, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('detects a file created after an absent document was read', async () => {
    const root = await mkdtemp(join(tmpdir(), 'zhin-runtime-json-conflict-'));
    temporary.push(root);
    const file = join(root, 'zhin.config.json');
    const document = new JsonConfigDocument(file);
    const current = await document.read();
    await writeFile(file, '{"external":true}\n');

    await expect(document.prepare(current, [{
      op: 'set', path: ['plugins'], value: {},
    }])).rejects.toBeInstanceOf(ConfigDocumentConflictError);
  });

  it('applies the shared patch semantics and preserves indentation and line endings', async () => {
    const original = '{\r\n    "plugins": {\r\n        "demo": {\r\n            "endpoints": [{ "id": "a" }, { "id": "b" }]\r\n        }\r\n    }\r\n}\r\n';
    const file = await configFile('config.json', original);
    const document = new JsonConfigDocument(file);
    const prepared = await document.prepare(await document.read(), [
      { op: 'set', path: ['plugins', 'demo', 'endpoints', '0', 'id'], value: 'renamed' },
      { op: 'remove', path: ['plugins', 'demo', 'endpoints', '1'] },
    ]);

    const committed = await prepared.commit();
    const output = await readFile(file, 'utf8');

    expect(committed.document).toEqual({
      plugins: { demo: { endpoints: [{ id: 'renamed' }] } },
    });
    expect(output).toContain('\r\n    "plugins"');
    expect(output).not.toMatch(/(?<!\r)\n/u);
  });

  it('restores exact bytes on rollback and rejects an external edit', async () => {
    const original = '{"plugins":{"demo":{"enabled":true}}}\n';
    const file = await configFile('zhin.config.json', original);
    const document = new JsonConfigDocument(file);
    const prepared = await document.prepare(await document.read(), [{
      op: 'set', path: ['plugins', 'demo', 'enabled'], value: false,
    }]);
    await prepared.commit();
    await prepared.rollback();
    expect(await readFile(file, 'utf8')).toBe(original);

    const conflicting = await document.prepare(await document.read(), [{
      op: 'set', path: ['plugins', 'demo', 'enabled'], value: false,
    }]);
    await writeFile(file, '{"external":true}\n');
    await expect(conflicting.commit()).rejects.toBeInstanceOf(ConfigDocumentConflictError);
  });

  it('reports malformed JSON and non-object roots', async () => {
    const malformed = await configFile('config.json', '{');
    await expect(new JsonConfigDocument(malformed).read())
      .rejects.toBeInstanceOf(ConfigDocumentParseError);
    const array = await configFile('zhin.config.json', '[]\n');
    await expect(new JsonConfigDocument(array).read())
      .rejects.toBeInstanceOf(ConfigDocumentParseError);
  });
});

describe('createConfigDocument', () => {
  it('selects concrete implementations at the file boundary', () => {
    expect(createConfigDocument('config.yml')).toBeInstanceOf(YamlConfigDocument);
    expect(createConfigDocument('config.yaml')).toBeInstanceOf(YamlConfigDocument);
    expect(createConfigDocument('config.json')).toBeInstanceOf(JsonConfigDocument);
    expect(() => createConfigDocument('config.toml')).toThrow(/Unsupported config file extension/);
  });
});

describe('RootRuntime with JsonConfigDocument', () => {
  it('commits JSON through the generation handoff and rolls back a failed shadow', async () => {
    const project = await createProject();
    const file = join(project, 'config.json');
    const modules = new FakeModuleRuntime();
    modules.set(join(project, 'plugin.ts'), { default: definePlugin({ name: 'root' }) });
    modules.set(join(project, 'plugins/child/plugin.ts'), {
      default: definePlugin({
        name: 'child',
        setup({ config }) {
          if ((config.get() as { label: string }).label === 'broken') {
            throw new Error('shadow setup failed');
          }
        },
      }),
    });
    const runtime = new RootRuntime({
      projectRoot: project,
      modules,
      environment: { name: 'test', mode: 'test', platform: 'node' },
      config: createConfigDocument(file),
    });
    await runtime.start();

    const committed = await runtime.patchConfig([{
      op: 'set', path: ['plugins', 'child', 'label'], value: 'v2',
    }]);
    const stableSource = await readFile(file, 'utf8');
    expect(committed.generation).toBe(2);
    expect(JSON.parse(stableSource)).toMatchObject({ plugins: { child: { label: 'v2' } } });

    await expect(runtime.patchConfig([{
      op: 'set', path: ['plugins', 'child', 'label'], value: 'broken',
    }])).rejects.toThrow('shadow setup failed');
    expect(await readFile(file, 'utf8')).toBe(stableSource);
    expect(runtime.snapshot).toBe(committed);
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

async function configFile(name: string, source: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'zhin-runtime-config-file-'));
  temporary.push(root);
  const file = join(root, name);
  await writeFile(file, source);
  return file;
}

async function createProject(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'zhin-runtime-json-runtime-'));
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
  await writeJson(join(root, 'config.json'), { plugins: { child: { label: 'v1' } } });
  return realpath(root);
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}
