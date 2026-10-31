import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { ModuleKind, ScriptTarget, transpileModule } from 'typescript';
import { parse } from 'yaml';

const repository = fileURLToPath(new URL('../..', import.meta.url));
const execFileAsync = promisify(execFile);
const supportsSourceTypeScript = Number(process.versions.node.split('.')[0]) >= 22;

function executableSource(source: string, sourceTypeScript: boolean): string {
  return sourceTypeScript ? source : transpileModule(source, {
    compilerOptions: { module: ModuleKind.ESNext, target: ScriptTarget.ES2022 },
  }).outputText;
}

interface TutorialPackage {
  name: string;
  dependencies: Record<string, string>;
  zhin: {
    entry: string;
    features: unknown[];
    plugins: unknown[];
  };
}

function fenced(source: string, language: string): string[] {
  return [...source.matchAll(new RegExp('```' + language + '\\n([\\s\\S]*?)```', 'g'))]
    .map((match) => match[1]!);
}

describe('first-plugin tutorial through the real Runtime', () => {
  const documents = [
    'docs/getting-started/first-plugin.md',
    'docs/en/getting-started/first-plugin.md',
  ];
  const cases = documents.flatMap((document) => supportsSourceTypeScript
    ? [{ document, sourceTypeScript: true }, { document, sourceTypeScript: false }]
    : [{ document, sourceTypeScript: false }]);
  it.each(cases)('dispatches $document (source TypeScript: $sourceTypeScript)', async ({ document, sourceTypeScript }) => {
    const entryName = sourceTypeScript ? 'plugin.ts' : 'plugin.js';
    const commandName = sourceTypeScript ? 'index.ts' : 'index.js';
    const source = await readFile(join(repository, document), 'utf8');
    const [packageSource, schemaSource, mountSource] = fenced(source, 'json');
    const [pluginSource, commandSource] = fenced(source, 'ts');
    const [childConfigSource, rootConfigSource] = fenced(source, 'yaml');
    expect(packageSource && schemaSource && mountSource && pluginSource && commandSource
      && childConfigSource && rootConfigSource).toBeTruthy();

    const pluginPackage = JSON.parse(packageSource!) as TutorialPackage;
    // Without native TypeScript the tutorial runs the compiled entry; otherwise source TS runs directly.
    if (!sourceTypeScript) pluginPackage.zhin.entry = './plugin.js';
    const mount = JSON.parse(mountSource!) as { dependencies: Record<string, string>; zhin: { plugins: unknown[] } };
    const projectRoot = await mkdtemp(join(tmpdir(), 'zhin-first-plugin-doc-'));
    const childRoot = join(projectRoot, 'plugins/ping-pong');
    try {
      await mkdir(join(childRoot, 'commands/ping'), { recursive: true });
      // Model the documented host install: the child has a peer, without its own provider copy.
      await mkdir(join(projectRoot, 'node_modules/@zhin.js'), { recursive: true });
      await symlink(join(repository, 'node_modules/zhin.js'), join(projectRoot, 'node_modules/zhin.js'), 'junction');
      await symlink(join(repository, 'packages/im/command'),
        join(projectRoot, 'node_modules/@zhin.js/command'), 'junction');
      await writeFile(join(childRoot, 'package.json'), JSON.stringify(pluginPackage));
      await writeFile(join(childRoot, entryName), executableSource(pluginSource!, sourceTypeScript));
      await writeFile(join(childRoot, 'schema.json'), schemaSource!);
      await writeFile(join(childRoot, 'commands/ping', commandName), executableSource(commandSource!, sourceTypeScript));
      await writeFile(join(projectRoot, entryName),
        "import { definePlugin } from 'zhin.js';\nexport default definePlugin({ name: 'tutorial-host' });\n");

      const hostPackage = structuredClone(pluginPackage);
      hostPackage.name = 'tutorial-host';
      hostPackage.dependencies = { ...hostPackage.dependencies, ...mount.dependencies };
      // The host inherits Stable Features from zhin.js. Its child must declare its own Features.
      hostPackage.zhin.features = [];
      hostPackage.zhin.plugins = mount.zhin.plugins;
      await writeFile(join(projectRoot, 'package.json'), JSON.stringify(hostPackage));
      await writeFile(join(projectRoot, 'zhin.config.yml'), childConfigSource!);

      const runner = join(projectRoot, 'verify.mjs');
      await writeFile(runner, `
import assert from 'node:assert/strict';
import { cp, mkdir, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { RootRuntime, NativeDevelopmentModuleRuntime } from ${JSON.stringify(pathToFileURL(join(repository, 'packages/im/runtime/lib/index.js')).href)};
const projectRoot = ${JSON.stringify(projectRoot)};
const childRoot = ${JSON.stringify(childRoot)};
const commandRoot = ${JSON.stringify(join(repository, 'packages/im/command'))};
const pluginPackage = ${JSON.stringify(pluginPackage)};
const schemaSource = ${JSON.stringify(schemaSource)};
const pluginSource = ${JSON.stringify(executableSource(pluginSource!, sourceTypeScript))};
const commandSource = ${JSON.stringify(executableSource(commandSource!, sourceTypeScript))};
const entryName = ${JSON.stringify(entryName)};
const commandName = ${JSON.stringify(commandName)};
async function dispatch(config, expected, owner, expectedFailure) {
  const runtime = new RootRuntime({
    projectRoot,
    modules: new NativeDevelopmentModuleRuntime({ projectRoot, watch: false }),
    environment: { name: 'test', mode: 'test', platform: 'node' },
    config: { configVersion: 2, plugins: { 'ping-pong': './plugins/ping-pong' }, ...config },
  });
  try {
    if (expectedFailure) {
      await assert.rejects(runtime.start(), { message: expectedFailure });
      return;
    }
    const snapshot = await runtime.start();
    const commands = snapshot.projections.get('zhin.command');
    assert.ok(commands, 'Root must inherit the Command Feature');
    const result = await commands.dispatch({ input: 'ping' });
    if (expected === undefined) {
      assert.deepEqual(commands.list(), [], 'a child without a Feature must not publish commands');
      assert.equal(result.matched, false);
    } else {
      assert.equal(result.matched, true);
      assert.equal(result.command, 'ping');
      assert.equal(result.owner, owner);
      assert.equal(result.value, expected);
    }
  } finally {
    await runtime.stop();
  }
}
await dispatch(${JSON.stringify(parse(childConfigSource!))}, 'pong!', 'root/ping-pong');
await dispatch({ configVersion: 2, plugins: { 'ping-pong': './plugins/ping-pong' } }, 'pong', 'root/ping-pong');

// npm's optional peer flag does not make the runtime Feature optional.
const hostCommand = join(projectRoot, 'node_modules/@zhin.js/command');
await rm(hostCommand);
await dispatch({}, undefined, undefined, 'Cannot resolve @zhin.js/command from ping-pong');
await symlink(commandRoot, hostCommand, 'junction');

// A second physical provider is invalid even if its version and Feature API match.
const duplicateCommand = join(childRoot, 'node_modules/@zhin.js/command');
await mkdir(duplicateCommand, { recursive: true });
await cp(join(commandRoot, 'lib'), join(duplicateCommand, 'lib'), { recursive: true });
const commandPackage = JSON.parse(await readFile(join(commandRoot, 'package.json'), 'utf8'));
await symlink(join(commandRoot, 'node_modules'), join(duplicateCommand, 'node_modules'), 'junction');
for (const version of [commandPackage.version, '1.1.999']) {
  await writeFile(join(duplicateCommand, 'package.json'), JSON.stringify({ ...commandPackage, version }));
  await dispatch({}, undefined, undefined, 'Multiple package locations for @zhin.js/command are not supported in one generation');
}
// Root's direct dependency selects a single provider, even when Core carries another version.
await rm(hostCommand);
await rename(duplicateCommand, hostCommand);
await rm(join(childRoot, 'node_modules'), { recursive: true, force: true });
await dispatch({ configVersion: 2, plugins: { 'ping-pong': './plugins/ping-pong' } }, 'pong', 'root/ping-pong');

await writeFile(join(childRoot, 'package.json'), JSON.stringify({
  ...pluginPackage, zhin: { ...pluginPackage.zhin, features: [] },
}));
await dispatch(${JSON.stringify(parse(childConfigSource!))}, undefined);

// The same tutorial command can also be used by a root application with no explicit Feature mount.
await rm(childRoot, { recursive: true, force: true });
await writeFile(join(projectRoot, 'package.json'), JSON.stringify({
  ...pluginPackage, dependencies: { ...pluginPackage.dependencies, ...${JSON.stringify(mount.dependencies)} },
  zhin: { ...pluginPackage.zhin, features: [], plugins: [] },
}));
await writeFile(join(projectRoot, entryName), pluginSource);
await writeFile(join(projectRoot, 'schema.json'), schemaSource);
await mkdir(join(projectRoot, 'commands/ping'), { recursive: true });
await writeFile(join(projectRoot, 'commands/ping', commandName), commandSource);
await dispatch(${JSON.stringify(parse(rootConfigSource!))}, 'pong!', 'root');
console.log('FIRST_PLUGIN_VERIFIED');
`);
      const nodeArguments = sourceTypeScript ? ['--experimental-strip-types'] : [];
      const result = await execFileAsync(process.execPath, [...nodeArguments, runner], {
        timeout: 20_000,
        env: { ...process.env, NODE_OPTIONS: '' },
      });
      expect(result.stdout).toContain('FIRST_PLUGIN_VERIFIED');
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  }, 30_000);
});
