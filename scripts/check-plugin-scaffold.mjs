#!/usr/bin/env node
/**
 * External plugin author acceptance:
 *   locally built CLI → `zhin new` (normal / service / adapter, non-interactive)
 *   → install against locally packed tarballs (simulates npm)
 *   → generated vitest + tsc → `pnpm pack` ships plugin.js → `zhin plugin check --strict` passes.
 *
 * Also asserts no packed @zhin.js/* manifest still has the source-only
 * `development` → ./src/*.ts condition, that @zhin.js/testing takes the zhin.js
 * stack only through peers, and that the scaffolded install holds exactly one
 * copy of every zhin.js / @zhin.js/* package (#899).
 *
 * Usage: node scripts/check-plugin-scaffold.mjs [--no-build] [--keep]
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { access, mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readWorkspaceGraph } from './lib/workspace-graph.mjs';
import { resolveWorkspacePackClosure, withWorkspaceTarballOverrides } from './workspace-pack-closure.mjs';
import { hasSourceConditions } from './sync-publish-exports.mjs';

const runFile = promisify(execFile);
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(repo, 'basic/cli/lib/cli.js');
const build = !process.argv.includes('--no-build');
const keep = process.argv.includes('--keep');
// Generated tests import @zhin.js/testing, so it ships from the same packed closure.
const STACK_ROOTS = ['zhin.js', '@zhin.js/skill', '@zhin.js/command', '@zhin.js/adapter', '@zhin.js/testing'];
const PLUGINS = [
  { name: 'e2e-normal', type: 'normal', js: ['plugin.js', 'commands/e2e-normal/index.js', 'commands/e2e-normal-echo/[text]/index.js'] },
  { name: 'e2e-service', type: 'service', js: ['plugin.js'] },
  { name: 'e2e-adapter', type: 'adapter', js: ['plugin.js', 'adapters/e2e-adapter/index.js'] },
];
// Layout standard (docs/contributing/publishing.md#发布包目录规范): library code in lib/ with .d.ts.
const LIBRARY_FILES = ['lib/index.js', 'lib/index.d.ts'];
/** Files a scaffolded tarball must never contain: TypeScript sources, tests, build configs. */
function layoutProblems(name, files) {
  const bad = [...files].filter((file) => (/\.tsx?$/u.test(file) && !file.endsWith('.d.ts'))
    || /(^|\/)(tests?|__tests__)\//u.test(file) || /\.(test|spec)\.[cm]?[jt]sx?$/u.test(file)
    || /(^|\/)(tsconfig[^/]*\.json|vitest\.config\.[cm]?[jt]s|[^/]*\.tsbuildinfo)$/u.test(file)
    || file.startsWith('scripts/'));
  return bad.length ? [`${name}: tarball ships sources/tests/configs: ${bad.slice(0, 5).join(', ')}`] : [];
}

// The regression this guards: tooling that enables the `development`
// condition (Vitest 4 does unless NODE_ENV=production) must still work.
const env = { ...process.env, NODE_OPTIONS: '', NPM_TOKEN: process.env.NPM_TOKEN ?? '' };
delete env.NODE_ENV;
delete env.ZHIN_RUNTIME_CHILD;

async function run(command, args, cwd) {
  try {
    return await runFile(command, args, { cwd, env, timeout: 300_000, maxBuffer: 16 * 1024 * 1024 });
  } catch (error) {
    throw new Error(
      `${command} ${args.join(' ')} failed in ${cwd}:\n${String(error.stderr ?? '').slice(-6000)}\n${String(error.stdout ?? '').slice(-6000)}`,
    );
  }
}

async function exists(file) {
  try { await access(file); return true; } catch { return false; }
}

async function tarball(file) {
  const { stdout: listing } = await run('tar', ['-tzf', file], repo);
  const files = new Set(listing.split('\n').filter(Boolean).map((entry) => entry.replace(/^package\//u, '')));
  const { stdout: manifest } = await run('tar', ['-xzOf', file, 'package/package.json'], repo);
  return { files, manifest: JSON.parse(manifest) };
}

/**
 * Only the source-only condition is asserted here; packed relative imports and
 * main/bin/exports targets are covered by scripts/check-pack-imports.mjs (#800).
 */
function publishProblems(name, { manifest }) {
  return hasSourceConditions(manifest.exports) ? [`${name}: exports still has a development condition`] : [];
}

/**
 * #899: a hard (exact) zhin.js / @zhin.js/* dependency in the test kit installs a
 * second stack next to the plugin's own zhin.js whenever their versions drift.
 * Tarball overrides below would hide that drift, so the manifest is asserted directly.
 */
function testingManifestProblems(name, { manifest }) {
  if (name !== '@zhin.js/testing') return [];
  const pinned = Object.keys(manifest.dependencies ?? {}).filter(isStackPackage);
  return pinned.length ? [`${name}: zhin.js stack must be peerDependencies, not dependencies: ${pinned.join(', ')}`] : [];
}

function isStackPackage(name) {
  return name === 'zhin.js' || name.startsWith('@zhin.js/');
}

/**
 * Every zhin.js / @zhin.js/* package must resolve to one location: a second
 * version or a second peer-resolution variant is a second module instance,
 * which the Runtime rejects ("Multiple package locations …").
 */
async function duplicateStackProblems(root) {
  const locations = new Map();
  for (const dir of await readdir(path.join(root, 'node_modules/.pnpm'))) {
    const name = dir.startsWith('@') ? dir.slice(0, dir.indexOf('@', 1)).replace('+', '/') : dir.slice(0, dir.indexOf('@'));
    if (!isStackPackage(name)) continue;
    locations.set(name, [...(locations.get(name) ?? []), dir]);
  }
  if (locations.size === 0) return ['no zhin.js / @zhin.js/* package found under node_modules/.pnpm'];
  return [...locations].filter(([, dirs]) => dirs.length > 1)
    .map(([name, dirs]) => `${name} is installed ${dirs.length} times: ${dirs.join(', ')}`);
}

/** An external author imports only the installed tarball's public API, never its source convention entry. */
async function checkPackedAdapterConsumer(plugin, manifest, packedFile, scaffold, temp) {
  const consumer = path.join(temp, `${plugin.name}-consumer`);
  const modules = path.join(consumer, 'node_modules');
  await mkdir(modules, { recursive: true });
  // Reuse the candidate stack already installed from tarballs, keeping one module identity.
  for (const name of await readdir(path.join(scaffold, 'node_modules'))) {
    await symlink(path.join(scaffold, 'node_modules', name), path.join(modules, name), 'dir');
  }
  const installed = path.join(modules, ...manifest.name.split('/'));
  await mkdir(installed, { recursive: true });
  await run('tar', ['-xzf', packedFile, '--strip-components=1', '-C', installed], consumer);
  await writeFile(path.join(consumer, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
  await writeFile(path.join(consumer, 'tsconfig.json'), JSON.stringify({ compilerOptions: {
    target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext', strict: true,
    noEmit: true, skipLibCheck: false, types: ['node'],
  }, include: ['consumer.ts'] }));
  await writeFile(path.join(consumer, 'independent-platform.d.ts'), `import type {} from '@zhin.js/feature-kit';
declare class IndependentEndpoint { independentSdk(value: string): void; }
declare class IndependentAdapter { getEndpoint(id: string): IndependentEndpoint | undefined; }
declare module '@zhin.js/feature-kit' { interface AdapterRegistry { 'independent-packed-platform': IndependentAdapter; } }
`);
  await writeFile(path.join(consumer, 'consumer.ts'), `import '${manifest.name}';
import './independent-platform.js';
import { defineCommand } from 'zhin.js/command';
export const command = defineCommand({ adapter: '${plugin.name}', execute({ session }) {
  if (!session) return;
  session.endpoint.connect(session.signal);
  session.endpoint.send('native-target', 'native-payload');
  session.adapter.getEndpoint('instance')?.send('native-target', 'native-payload');
  // @ts-expect-error The inferred native Client must reject nonexistent SDK methods.
  session.endpoint.notARealSdkMethod();
  // @ts-expect-error The inferred native Client requires a string send target.
  session.endpoint.send(123, 'native-payload');
  return 'typed' as const;
} });
export const independent = defineCommand({ adapter: 'independent-packed-platform', execute({ session }) {
  if (!session) return;
  session.endpoint.independentSdk('typed');
  // @ts-expect-error The second registration must retain its own native Client type.
  session.endpoint.send('native-target', 'native-payload');
} });
`);
  console.log(`${plugin.name}: packed public consumer tsc (positive + negative native inference)`);
  await run(process.execPath, [path.join(scaffold, 'node_modules/typescript/bin/tsc'), '--noEmit', '-p', path.join(consumer, 'tsconfig.json')], consumer);
  const prefix = plugin.name.charAt(0).toUpperCase() + plugin.name.slice(1).replace(/-([a-z])/gu, (_match, letter) => letter.toUpperCase());
  await writeFile(path.join(consumer, 'runtime.mjs'), `import assert from 'node:assert/strict';
import { ${prefix}Adapter, ${prefix}Client, ${prefix}Endpoint } from '${manifest.name}';
import { AdapterIndex, adapterFeatureId, endpointEventGatewayToken, endpointSpec } from 'zhin.js/adapter';
import { createCapabilitySlot, rootPluginId } from 'zhin.js';
import definition from ${JSON.stringify(pathToFileURL(path.join(installed, 'adapters', plugin.name, 'index.js')).href)};
const root = rootPluginId();
const slot = createCapabilitySlot({ owner: root, feature: adapterFeatureId, localName: '${plugin.name}', source: '/fixture/adapters/${plugin.name}/index.js', definition });
const receiveEvent = async () => undefined;
const gateway = { receive: receiveEvent, run: async callback => callback({ receive: receiveEvent }) };
const snapshot = { generation: 1, root,
  tree: new Map([[root, { id: root, instanceKey: 'root', packageName: '${manifest.name}', packageRoot: '/', children: [] }]]),
  config: new Map([[root, { id: 'packed-account' }]]), capabilities: new Map([[slot.id, slot]]), projections: new Map(),
  resources: new Map([[root, new Map([[endpointEventGatewayToken.id, gateway]])]]) };
const index = await AdapterIndex.create([slot], snapshot, new AbortController().signal);
try {
  await index.start();
  assert.ok(index.adapter(slot.id) instanceof ${prefix}Adapter);
  const endpoint = index.client('${plugin.name}', 'packed-account');
  assert.ok(endpoint instanceof ${prefix}Client); assert.ok(endpoint instanceof ${prefix}Endpoint);
  assert.equal(endpoint.connect, ${prefix}Client.prototype.connect);
  assert.equal(await index.send(endpoint[endpointSpec].identity.id, { conversation: { endpoint: { adapter: '${plugin.name}', id: String(endpoint[endpointSpec].identity.id) }, kind: 'private', id: 'peer' }, payload: 'hi' }), 'stub-message-id:peer:string');
} finally { await index.stop(); }
`);
  console.log(`${plugin.name}: packed public classes + convention runtime identity`);
  await run(process.execPath, [path.join(consumer, 'runtime.mjs')], consumer);
}

const temp = await mkdtemp(path.join(tmpdir(), 'zhin-plugin-scaffold-'));
try {
  const packs = path.join(temp, 'packs');
  const host = path.join(temp, 'host');
  await mkdir(packs);
  await mkdir(host);

  const workspace = [...readWorkspaceGraph().values()].map((entry) => ({ ...entry, dir: path.join(repo, entry.dir) }));
  for (const entry of workspace) entry.manifest = JSON.parse(await readFile(path.join(entry.dir, 'package.json'), 'utf8'));
  const closure = resolveWorkspacePackClosure(workspace, STACK_ROOTS);

  if (build) {
    console.log(`Building ${closure.length} stack packages and @zhin.js/cli…`);
    await run('pnpm', [...[...STACK_ROOTS, '@zhin.js/cli'].flatMap((name) => ['--filter', `${name}...`]), 'build'], repo);
  }

  console.log(`Packing ${closure.length} candidate packages…`);
  const packed = new Map();
  const problems = [];
  for (const entry of closure) {
    const before = new Set(await readdir(packs));
    await run('pnpm', ['pack', '--pack-destination', packs], entry.dir);
    const created = (await readdir(packs)).filter((file) => file.endsWith('.tgz') && !before.has(file));
    if (created.length !== 1) throw new Error(`Expected one tarball for ${entry.name}`);
    const file = path.join(packs, created[0]);
    packed.set(entry.name, { tarball: file });
    const packedTarball = await tarball(file);
    problems.push(...publishProblems(entry.name, packedTarball), ...testingManifestProblems(entry.name, packedTarball));
  }
  if (problems.length > 0) throw new Error(`Packed manifests are not publishable:\n  ${problems.join('\n  ')}`);

  // Host workspace = an author's repo: plugins/* are scaffolded by the built CLI.
  await writeFile(path.join(host, 'package.json'), `${JSON.stringify({ name: 'scaffold-host', private: true, type: 'module' }, null, 2)}\n`);
  await writeFile(path.join(host, 'pnpm-workspace.yaml'), "packages:\n  - 'plugins/*'\n");
  // Official entry for external authors: `zhin new <name> --standalone` (no host app needed).
  await mkdir(path.join(host, 'plugins'));
  for (const plugin of PLUGINS) {
    console.log(`zhin new ${plugin.name} --standalone --type ${plugin.type}`);
    await run(process.execPath, [cli, 'new', plugin.name, '--standalone', '--type', plugin.type, '--skip-install'], path.join(host, 'plugins'));
    const generated = JSON.parse(await readFile(path.join(host, 'plugins', plugin.name, 'package.json'), 'utf8'));
    // This clean author project must advertise this release's real minimum BEFORE tarball overrides
    // are installed; testing only against newer tarballs would conceal a falsely broad peer claim.
    for (const field of ['peerDependencies', 'devDependencies']) {
      for (const [name, range] of Object.entries(generated[field] ?? {})) {
        if (!isStackPackage(name)) continue;
        const version = workspace.find(entry => entry.name === name)?.manifest.version;
        if (!version || range !== `^${version}`) throw new Error(`${plugin.name}: ${field}.${name} declares ${range}, expected release floor ^${version}`);
      }
    }
  }
  const hostManifest = JSON.parse(await readFile(path.join(host, 'package.json'), 'utf8'));
  // pnpm overrides do not reach auto-installed peers, so the test kit's peers that the
  // scaffold does not declare itself (@zhin.js/runtime, @zhin.js/tool) are declared at the
  // host root (resolve-peers-from-workspace-root) to come from the candidate tarballs too.
  const testingPeers = Object.keys(workspace.find((entry) => entry.name === '@zhin.js/testing').manifest.peerDependencies ?? {})
    .filter((name) => name !== 'zhin.js');
  hostManifest.devDependencies = Object.fromEntries(testingPeers.map((name) => [name, `file:${packed.get(name).tarball}`]));
  const candidates = [...packed.keys()].map((name) => ({ name }));
  await writeFile(
    path.join(host, 'package.json'),
    `${JSON.stringify(withWorkspaceTarballOverrides(hostManifest, candidates, packed), null, 2)}\n`,
  );

  console.log('Installing scaffolded plugins against packed tarballs…');
  await run('pnpm', ['install', '--no-frozen-lockfile'], host);
  const duplicates = await duplicateStackProblems(host);
  if (duplicates.length > 0) throw new Error(`Scaffolded plugins install duplicate zhin.js packages:\n  ${duplicates.join('\n  ')}`);

  for (const plugin of PLUGINS) {
    const dir = path.join(host, 'plugins', plugin.name);
    const manifest = JSON.parse(await readFile(path.join(dir, 'package.json'), 'utf8'));
    if (JSON.stringify(manifest).includes('"latest"')) throw new Error(`${plugin.name}: package.json still uses "latest"`);
    console.log(`${plugin.name}: vitest`);
    await run('pnpm', ['test'], dir);
    console.log(`${plugin.name}: tsc --noEmit`);
    await run('pnpm', ['typecheck'], dir);
    console.log(`${plugin.name}: pnpm pack`);
    const before = new Set(await readdir(packs));
    await run('pnpm', ['pack', '--pack-destination', packs], dir);
    const created = (await readdir(packs)).filter((file) => file.endsWith('.tgz') && !before.has(file));
    const { files, manifest: packedManifest } = await tarball(path.join(packs, created[0]));
    const missing = [...plugin.js, ...LIBRARY_FILES].filter((file) => !files.has(file));
    if (missing.length > 0) throw new Error(`${plugin.name}: tarball is missing built JavaScript: ${missing.join(', ')}`);
    const layout = layoutProblems(plugin.name, files);
    if (layout.length > 0) throw new Error(layout.join('\n'));
    // Runtime entries import library code from lib/ (rewritten from src/), which must be packed.
    const { stdout: entry } = await run('tar', ['-xzOf', path.join(packs, created[0]), 'package/plugin.js'], repo);
    if (!/from ["']\.\/lib\/index\.js["']/u.test(entry)) throw new Error(`${plugin.name}: plugin.js does not import ./lib/index.js`);
    // postpack removes the generated sibling JavaScript again.
    if (await exists(path.join(dir, 'plugin.js'))) throw new Error(`${plugin.name}: postpack left plugin.js behind`);
    if (!files.has(packedManifest.zhin.entry.replace(/^\.\//u, ''))) {
      throw new Error(`${plugin.name}: zhin.entry ${packedManifest.zhin.entry} is not in the tarball`);
    }
    if (plugin.type === 'adapter') await checkPackedAdapterConsumer(plugin, packedManifest, path.join(packs, created[0]), dir, temp);
    // The author-facing check must accept what `zhin new` generates, warnings included.
    console.log(`${plugin.name}: zhin plugin check --strict`);
    await run(process.execPath, [cli, 'plugin', 'check', '--strict'], dir);
  }
  console.log(`PASS: built CLI → zhin new --standalone (${PLUGINS.map((plugin) => plugin.type).join('/')}) → packed tarballs → vitest + tsc → pnpm pack ships plugin.js + lib/ (.d.ts), no sources/tests/configs → zhin plugin check --strict; one copy of each zhin.js package; no development condition in ${closure.length} packed manifests.`);
} finally {
  if (keep) console.log(`kept ${temp}`);
  else await rm(temp, { recursive: true, force: true });
}
