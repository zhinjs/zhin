#!/usr/bin/env node
/**
 * External plugin author acceptance:
 *   locally built CLI → `zhin new` (normal / service / adapter, non-interactive)
 *   → install against locally packed tarballs (simulates npm)
 *   → generated vitest + tsc → `pnpm pack` ships plugin.js → `zhin plugin check --strict` passes.
 *
 * Also asserts no packed @zhin.js/* manifest still has the source-only
 * `development` → ./src/*.ts condition.
 *
 * Usage: node scripts/check-plugin-scaffold.mjs [--no-build] [--keep]
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { access, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
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
    problems.push(...publishProblems(entry.name, await tarball(file)));
  }
  if (problems.length > 0) throw new Error(`Packed manifests still publish source-only conditions:\n  ${problems.join('\n  ')}`);

  // Host workspace = an author's repo: plugins/* are scaffolded by the built CLI.
  await writeFile(path.join(host, 'package.json'), `${JSON.stringify({ name: 'scaffold-host', private: true, type: 'module' }, null, 2)}\n`);
  await writeFile(path.join(host, 'pnpm-workspace.yaml'), "packages:\n  - 'plugins/*'\n");
  // Official entry for external authors: `zhin new <name> --standalone` (no host app needed).
  await mkdir(path.join(host, 'plugins'));
  for (const plugin of PLUGINS) {
    console.log(`zhin new ${plugin.name} --standalone --type ${plugin.type}`);
    await run(process.execPath, [cli, 'new', plugin.name, '--standalone', '--type', plugin.type, '--skip-install'], path.join(host, 'plugins'));
  }
  const hostManifest = JSON.parse(await readFile(path.join(host, 'package.json'), 'utf8'));
  const candidates = [...packed.keys()].map((name) => ({ name }));
  await writeFile(
    path.join(host, 'package.json'),
    `${JSON.stringify(withWorkspaceTarballOverrides(hostManifest, candidates, packed), null, 2)}\n`,
  );

  console.log('Installing scaffolded plugins against packed tarballs…');
  await run('pnpm', ['install', '--no-frozen-lockfile'], host);

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
    // The author-facing check must accept what `zhin new` generates, warnings included.
    console.log(`${plugin.name}: zhin plugin check --strict`);
    await run(process.execPath, [cli, 'plugin', 'check', '--strict'], dir);
  }
  console.log(`PASS: built CLI → zhin new --standalone (${PLUGINS.map((plugin) => plugin.type).join('/')}) → packed tarballs → vitest + tsc → pnpm pack ships plugin.js + lib/ (.d.ts), no sources/tests/configs → zhin plugin check --strict; no development condition in ${closure.length} packed manifests.`);
} finally {
  if (keep) console.log(`kept ${temp}`);
  else await rm(temp, { recursive: true, force: true });
}
