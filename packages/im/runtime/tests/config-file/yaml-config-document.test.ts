import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { definePlugin, type ConfigPatch } from '@zhin.js/plugin-runtime';
import { ConfigValidationError, RootRuntime, type ModuleRuntime } from '../../src/index.js';
import {
  ConfigDocumentConflictError,
  ConfigDocumentParseError,
  YamlConfigDocument,
} from '../../src/config-file/index.js';

const temporary: string[] = [];

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true })));
});

describe('YamlConfigDocument', () => {
  it('materializes a missing document on commit and removes it on rollback', async () => {
    const root = await mkdtemp(join(tmpdir(), 'zhin-runtime-yaml-missing-'));
    temporary.push(root);
    const file = join(root, 'zhin.config.yml');
    const document = new YamlConfigDocument(file);
    const current = await document.read();

    expect(current.document).toEqual({});
    const prepared = await document.prepare(current, [{
      op: 'set', path: ['plugins', 'demo', 'endpoints'], value: [{ id: 'bot' }],
    }]);
    await prepared.commit();
    expect(await readFile(file, 'utf8')).toContain('id: bot');

    await prepared.rollback();
    await expect(readFile(file, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('detects a file created after an absent document was read', async () => {
    const root = await mkdtemp(join(tmpdir(), 'zhin-runtime-yaml-conflict-'));
    temporary.push(root);
    const file = join(root, 'zhin.config.yml');
    const document = new YamlConfigDocument(file);
    const current = await document.read();
    await writeFile(file, 'external: true\n');

    await expect(document.prepare(current, [{
      op: 'set', path: ['plugins'], value: {},
    }])).rejects.toBeInstanceOf(ConfigDocumentConflictError);
  });

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

  it('disabling a plugin changes only disable_plugins, keeping key-line comments elsewhere (#1250 config-write-moves-inline-comment)', async () => {
    const original = `# project config
ai:
  personalPrincipals:
    "user:7f3a": # Console 所有者（sandbox）
      - qq:12345
    team: # 同事
      sandbox: [alice, bob]
  model: gpt # inline
disable_plugins:
  - repeater
plugins:
  - code-runner
  - repeater
http: { port: 8086 }
`;
    const { file } = await configFile(original);
    const adapter = new YamlConfigDocument(file);
    const prepared = await adapter.prepare(await adapter.read(), [
      { op: 'set', path: ['disable_plugins'], value: ['repeater', 'code-runner'] },
    ]);
    await prepared.commit();
    const output = await readFile(file, 'utf8');

    expect(output).toBe(original.replace('disable_plugins:\n  - repeater\n', 'disable_plugins:\n  - repeater\n  - code-runner\n'));
  });

  it('keeps a key-line comment in place inside the entry that changed (#1250)', async () => {
    const { file } = await configFile(`ai:
  personalPrincipals:
    "user:7f3a": # Console 所有者
      - qq:12345
  model: gpt
`);
    const adapter = new YamlConfigDocument(file);
    const prepared = await adapter.prepare(await adapter.read(), [{ op: 'set', path: ['ai', 'model'], value: 'claude' }]);
    await prepared.commit();
    expect(await readFile(file, 'utf8')).toBe(`ai:
  personalPrincipals:
    "user:7f3a": # Console 所有者
      - qq:12345
  model: claude
`);
  });

  describe('byte-preserving splice edge cases (#1250)', () => {
    const cases: readonly (readonly [string, string, ConfigPatch[], string])[] = [
      ['CRLF line endings', '# top\r\na: 1 # c\r\nb:\r\n  - x\r\nc: { k: v }\r\n',
        [{ op: 'set', path: ['b'], value: ['x', 'y'] }], '# top\r\na: 1 # c\r\nb:\r\n  - x\r\n  - y\r\nc: { k: v }\r\n'],
      ['CRLF inside a block scalar', 'a: |\r\n  x\r\n  y\r\nb: 1\r\n',
        [{ op: 'set', path: ['b'], value: 2 }], 'a: |\r\n  x\r\n  y\r\nb: 2\r\n'],
      ['a UTF-8 BOM', '\uFEFFa: 1 # keep\nb: 2\n', [{ op: 'set', path: ['b'], value: 3 }], 'a: 1 # keep\nb: 3\n'],
      ['anchors and aliases', 'base: &b\n  x: 1\nuse: *b\nother: 2\n',
        [{ op: 'set', path: ['other'], value: 3 }], 'base: &b\n  x: 1\nuse: *b\nother: 3\n'],
      ['an alias inside the touched entry', 'base: &b\n  x: 1\nuse:\n  v: *b\n  w: 1\n',
        [{ op: 'set', path: ['use', 'w'], value: 2 }], 'base: &b\n  x: 1\nuse:\n  v: *b\n  w: 2\n'],
      ['comments between top-level entries', 'a: 1\n\n# about b\n# more\nb: 2\n\n# about c\nc: 3\n',
        [{ op: 'set', path: ['b'], value: 5 }], 'a: 1\n\n# about b\n# more\nb: 5\n\n# about c\nc: 3\n'],
      ['a directive and document markers', '%YAML 1.2\n---\na: 1 # x\nb: 2\n...\n',
        [{ op: 'set', path: ['b'], value: 3 }], '%YAML 1.2\n---\na: 1 # x\nb: 3\n...\n'],
      ['no trailing newline', 'a: 1\nb: [1,2] # x', [{ op: 'set', path: ['a'], value: 3 }], 'a: 3\nb: [1,2] # x\n'],
      ['a clipped block scalar at EOF without newline', 'a: 1\nb: |\n  line',
        [{ op: 'set', path: ['a'], value: 3 }], 'a: 3\nb: |\n  line\n'],
      ['a kept block scalar with trailing blank lines', 'a: 1\nb: |+\n  line\n\n\n',
        [{ op: 'set', path: ['a'], value: 3 }], 'a: 3\nb: |+\n  line\n\n\n'],
      ['removing an entry', 'a: 1 # x\nb: 2\nc: 3 # z\n', [{ op: 'remove', path: ['b'] }], 'a: 1 # x\nc: 3 # z\n'],
    ];
    for (const [name, original, patches, expected] of cases) {
      it(`keeps semantics and untouched bytes with ${name}`, async () => {
        const { file } = await configFile(original);
        const adapter = new YamlConfigDocument(file);
        const current = await adapter.read();
        const prepared = await adapter.prepare(current, patches);
        await prepared.commit();
        const output = await readFile(file, 'utf8');
        expect(output).toBe(expected);
        const intended = structuredClone(current.document) as Record<string, unknown>;
        for (const patch of patches) {
          let target = intended;
          for (const key of patch.path.slice(0, -1)) target = target[key] as Record<string, unknown>;
          if (patch.op === 'set') target[patch.path.at(-1)!] = patch.value;
          else delete target[patch.path.at(-1)!];
        }
        expect((await adapter.read()).document).toEqual(intended);
      });
    }
  });

  it('replaces source with optimistic concurrency and preserves exact editor text', async () => {
    const { file } = await configFile('http:\n  port: 1000\n');
    const document = new YamlConfigDocument(file);
    const current = await document.readSource();
    const replacement = '# edited\nhttp:\n    port: 2000\n';
    const prepared = await document.prepareReplacement(current.revision, replacement);

    const committed = await prepared.commit();

    expect(committed.document).toEqual({ http: { port: 2000 } });
    expect(await readFile(file, 'utf8')).toBe(replacement);
    await expect(document.prepareReplacement(current.revision, 'http: {}\n'))
      .rejects.toBeInstanceOf(ConfigDocumentConflictError);
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

  it('addresses sequence elements with numeric path segments', async () => {
    const { file } = await configFile(`# endpoints comment
http:
    endpoints: # keep
        - url: 'a' # first
          token: "\${TOKEN_A}"
        - url: 'b'
plugins: {}
`);
    const adapter = new YamlConfigDocument(file);
    const current = await adapter.read();
    const prepared = await adapter.prepare(current, [
      { op: 'set', path: ['http', 'endpoints', '0', 'url'], value: 'a2' },
      { op: 'remove', path: ['http', 'endpoints', '1'] },
    ]);
    const committed = await prepared.commit();
    const output = await readFile(file, 'utf8');

    expect(committed.document).toMatchObject({
      http: { endpoints: [{ url: 'a2', token: '${TOKEN_A}' }] },
    });
    expect(output).toContain('# endpoints comment');
    expect(output).toContain("url: 'a2' # first");
    expect(output).toContain('"${TOKEN_A}"');
    expect(output).not.toContain("url: 'b'");
  });

  it('rejects non-numeric and out-of-bounds sequence segments', async () => {
    const { file } = await configFile('http:\n  endpoints:\n    - url: a\nplugins: {}\n');
    const adapter = new YamlConfigDocument(file);
    const current = await adapter.read();

    await expect(adapter.prepare(current, [
      { op: 'set', path: ['http', 'endpoints', 'foo', 'url'], value: 'x' },
    ])).rejects.toThrow(/requires an array index/);
    await expect(adapter.prepare(current, [
      { op: 'set', path: ['http', 'endpoints', '3', 'url'], value: 'x' },
    ])).rejects.toThrow(/out of bounds/);
    await expect(adapter.prepare(current, [
      { op: 'remove', path: ['http', 'endpoints', '3'] },
    ])).rejects.toThrow(/out of bounds/);
    expect(await readFile(file, 'utf8')).toContain('url: a');
  });
});

describe('RootRuntime with YamlConfigDocument', () => {
  it('rejects invalid patches before save and retains saved desired YAML when activation fails', async () => {
    const project = await createProject('configVersion: 2\nplugins:\n  child: "@test/child"\nchild:\n  label: v1\n');
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
      op: 'set', path: ['child', 'label'], value: 'v2',
    }]);
    expect(committed.generation).toBe(2);
    expect(await readFile(file, 'utf8')).toContain('label: v2');
    const stableSource = await readFile(file, 'utf8');

    await expect(runtime.patchConfig([{
      op: 'set', path: ['child', 'label'], value: 42,
    }])).rejects.toBeInstanceOf(ConfigValidationError);
    expect(await readFile(file, 'utf8')).toBe(stableSource);
    expect(runtime.snapshot).toBe(committed);
    await expect(runtime.patchConfig([{
      op: 'set', path: ['child', 'label'], value: 'broken',
    }])).rejects.toThrow('shadow setup failed');

    expect(runtime.snapshot).toBe(committed);
    expect([...runtime.snapshot.config.values()]).toContainEqual(expect.objectContaining({ label: 'v2' }));
    expect(await readFile(file, 'utf8')).toBe(stableSource.replace('label: v2', 'label: broken'));
    expect(runtime.configurationApplication).toMatchObject({ saved: true, generation: committed.generation,
      sourceRevision: (await new YamlConfigDocument(file).read()).revision,
      groups: expect.arrayContaining([expect.objectContaining({ status: 'failed' })]) });
    await runtime.stop();
  });

  it('persists an explicit schema default without publishing an empty generation', async () => {
    const project = await createProject('configVersion: 2\nplugin: {}\nplugins:\n  child: "@test/child"\nchild: {}\n');
    const file = join(project, 'config.yml');
    const modules = new FakeModuleRuntime();
    modules.set(join(project, 'plugin.ts'), { default: definePlugin({ name: 'root' }) });
    modules.set(join(project, 'plugins/child/plugin.ts'), {
      default: definePlugin({ name: 'child' }),
    });
    const runtime = createRuntime(project, modules, file);
    const started = await runtime.start();

    const result = await runtime.patchConfig([{
      op: 'set', path: ['child', 'label'], value: 'v1',
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
  const root = await mkdtemp(join(tmpdir(), 'zhin-runtime-yaml-'));
  temporary.push(root);
  const file = join(root, 'config.yml');
  await writeFile(file, source);
  const resolved = await realpath(root);
  return { root: resolved, file: join(resolved, 'config.yml') };
}

async function createProject(config: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'zhin-runtime-yaml-runtime-'));
  temporary.push(root);
  await writeJson(join(root, 'package.json'), {
    name: '@test/root',
    dependencies: { '@test/child': 'workspace:*' },
    zhin: {
      protocol: 1,
      type: 'plugin',
      entry: './plugin.ts',
      plugins: [],
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
  return realpath(root);
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}
