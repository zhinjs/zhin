#!/usr/bin/env node
/** Published database/IM/Agent type contracts. Build the workspace before running. */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { readWorkspaceGraph } from './lib/workspace-graph.mjs';
import { resolveWorkspacePackClosure, withWorkspaceTarballOverrides } from './workspace-pack-closure.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const execute = promisify(execFile);
const artifact = await mkdtemp(join(process.env.TMPDIR ?? '/tmp', 'zhin-database-types-'));
const archives = join(artifact, 'archives');
await mkdir(archives);
process.stdout.write(JSON.stringify({ artifact, phase: 'pack' }) + '\n');
const entries = await Promise.all([...readWorkspaceGraph().values()].map(async entry => ({
  ...entry, manifest: JSON.parse(await readFile(join(repo, entry.dir, 'package.json'), 'utf8')),
})));
const closure = resolveWorkspacePackClosure(entries, ['@zhin.js/agent', 'zhin.js']);
const workspaceNames = new Set(entries.map(entry => entry.name));
const packed = new Map();
const checks = [];

async function run({ command = 'pnpm', args, cwd, label }) {
  let result;
  try { result = { status: 0, ...await execute(command, args, { cwd, maxBuffer: 32 * 1024 * 1024, env: { ...process.env, NPM_TOKEN: '' } }) }; }
  catch (error) { result = { status: error.code, stdout: error.stdout ?? '', stderr: error.stderr ?? '' }; }
  const output = result.stdout + '\n' + result.stderr;
  await writeFile(join(artifact, `${label}.log`), output);
  return { status: result.status, output };
}
function passed(result) { assert.equal(result.status, 0, result.output); }

/** Exact already-installed versions: avoid an offline test resolving newer transitives. */
async function installedPackage({ name, directory }) {
  const require = createRequire(join(directory, 'package.json'));
  let location;
  try { location = require.resolve(`${name}/package.json`); }
  catch {
    let current = dirname(require.resolve(name));
    while (current !== dirname(current)) {
      try {
        const manifest = JSON.parse(await readFile(join(current, 'package.json'), 'utf8'));
        if (manifest.name === name) return { directory: current, manifest };
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
      current = dirname(current);
    }
    throw new Error(`Cannot locate installed ${name}`);
  }
  location = await realpath(location);
  return { directory: dirname(location), manifest: JSON.parse(await readFile(location, 'utf8')) };
}
async function externalSnapshot(roots) {
  const overrides = {}, visited = new Set();
  async function visit(input) {
    const entry = await installedPackage(input);
    const key = `${entry.manifest.name}@${entry.manifest.version}`;
    if (visited.has(key)) return;
    visited.add(key);
    for (const name of Object.keys(entry.manifest.dependencies ?? {})) {
      const child = await installedPackage({ name, directory: entry.directory });
      overrides[`${key}>${name}`] = child.manifest.version;
      await visit({ name, directory: entry.directory });
    }
  }
  for (const input of roots) await visit(input);
  return overrides;
}

for (const entry of closure) {
  const before = new Set(await readdir(archives));
  passed(await run({ args: ['pack', '--pack-destination', archives], cwd: join(repo, entry.dir), label: `pack-${entry.name.replaceAll('/', '-')}` }));
  const added = (await readdir(archives)).filter(file => file.endsWith('.tgz') && !before.has(file));
  assert.equal(added.length, 1, `Expected one archive for ${entry.name}`);
  const tarball = join(archives, added[0]);
  packed.set(entry.name, { tarball, sha256: createHash('sha256').update(await readFile(tarball)).digest('hex') });
}

const externalNames = ['ai', 'zod', '@ai-sdk/openai', 'typescript', '@types/node'];
const externalRoots = externalNames.map(name => ({ name,
  directory: ['ai', 'zod', '@ai-sdk/openai'].includes(name) ? join(repo, 'packages/im/ai') : repo,
}));
for (const entry of closure) for (const name of Object.keys(entry.manifest.dependencies ?? {})) {
  if (!workspaceNames.has(name)) externalRoots.push({ name, directory: join(repo, entry.dir) });
}
const baseOverrides = await externalSnapshot(externalRoots);
const baseDependencies = Object.fromEntries(['@zhin.js/database', '@zhin.js/core', '@zhin.js/agent', 'zhin.js']
  .map(name => [name, `file:${packed.get(name).tarball}`]));
for (const input of externalRoots.slice(0, externalNames.length)) {
  baseDependencies[input.name] = (await installedPackage(input)).manifest.version;
}
const fixtures = join(repo, 'tests/fixtures/database-types');
const tsc = ['exec', 'tsc', '--ignoreConfig', '--noEmit', '--strict', '--module', 'nodenext', '--moduleResolution', 'nodenext', '--target', 'es2022', '--lib', 'es2022', '--types', 'node'];

async function consumer({ name, additions = {}, overrides = {} }) {
  const directory = join(artifact, name);
  await mkdir(directory);
  const manifest = withWorkspaceTarballOverrides({ name: `database-types-${name}`, version: '1.0.0', private: true,
    type: 'module', packageManager: 'pnpm@9.0.2', dependencies: { ...baseDependencies, ...additions },
    pnpm: { overrides: { ...baseOverrides, ...overrides } },
  }, closure, packed);
  await writeFile(join(directory, 'package.json'), JSON.stringify(manifest, null, 2));
  await writeFile(join(directory, '.npmrc'), 'auto-install-peers=false\nstrict-peer-dependencies=false\n');
  passed(await run({ args: ['install', '--offline', '--ignore-scripts', '--no-optional'], cwd: directory, label: `install-${name}` }));
  const installedModules = await realpath(join(directory, 'node_modules'));
  for (const dependency of ['@zhin.js/database', '@zhin.js/core', '@zhin.js/agent', 'zhin.js']) {
    const location = await realpath(join(directory, 'node_modules', dependency));
    assert.ok(location.startsWith(installedModules + '/'), `${dependency} must resolve from installed archives`);
  }
  for (const file of ['root.ts', 'third-party.ts', 'mysql.ts', 'pg.ts', 'mongodb.ts', 'redis.ts', 'runtime.mjs']) {
    await copyFile(join(fixtures, file), join(directory, file));
  }
  return directory;
}

const neutral = await consumer({ name: 'neutral' });
passed(await run({ args: [...tsc, 'root.ts', 'third-party.ts'], cwd: neutral, label: 'neutral-strict' }));
const neutralFiles = await run({ args: [...tsc, '--listFilesOnly', 'root.ts', 'third-party.ts'], cwd: neutral, label: 'neutral-type-files' });
passed(neutralFiles);
assert.doesNotMatch(neutralFiles.output.replaceAll('\\', '/'), /\/@zhin\.js\/database\/lib\/dialects\/(?:mysql|pg|mongodb|redis)\.d\.ts/u);
passed(await run({ command: process.execPath, args: ['runtime.mjs'], cwd: neutral, label: 'neutral-runtime' }));
checks.push('Database/Core/Agent/Zhin neutral roots, real generic augmentation, ESM/CJS and lazy SDK runtime');
const absentPg = await run({ args: [...tsc, 'pg.ts'], cwd: neutral, label: 'selected-pg-missing-types' });
assert.notEqual(absentPg.status, 0);
assert.match(absentPg.output, /TS2307: Cannot find module 'pg'/u);
assert.doesNotMatch(absentPg.output, /Cannot find module '(?:mongodb|mysql2(?:\/promise)?|redis)'/u);
checks.push('Selecting missing PG types reports PG only');

const pgTypesRoot = { name: '@types/pg', directory: join(repo, 'basic/database') };
const pgTypesDirectory = await consumer({ name: 'pg-types-only',
  additions: { '@types/pg': (await installedPackage(pgTypesRoot)).manifest.version },
  overrides: await externalSnapshot([pgTypesRoot]),
});
passed(await run({ args: [...tsc, 'pg.ts'], cwd: pgTypesDirectory, label: 'pg-types-only-strict' }));
passed(await run({ command: process.execPath, args: ['--input-type=module', '-e',
  `import assert from 'node:assert/strict'; import {createRequire} from 'node:module'; const require=createRequire(import.meta.url); assert.throws(()=>require.resolve('pg'),{code:'MODULE_NOT_FOUND'}); const {Registry}=await import('@zhin.js/database'); await assert.rejects(Registry.create('pg',{}).start(),/pg/);`],
  cwd: pgTypesDirectory, label: 'pg-types-only-no-runtime',
}));
checks.push('PG declarations alone compile, but do not provide the runtime driver');

for (const [dialect, driver] of [['mysql', 'mysql2'], ['pg', 'pg'], ['mongodb', 'mongodb'], ['redis', 'redis']]) {
  const roots = [{ name: driver, directory: join(repo, 'basic/database') }];
  if (dialect === 'pg') roots.push({ name: '@types/pg', directory: join(repo, 'basic/database') });
  const additions = {};
  for (const input of roots) additions[input.name] = (await installedPackage(input)).manifest.version;
  const directory = await consumer({ name: dialect, additions, overrides: await externalSnapshot(roots) });
  passed(await run({ args: [...tsc, `${dialect}.ts`], cwd: directory, label: `${dialect}-strict` }));
  const files = await run({ args: [...tsc, '--listFilesOnly', `${dialect}.ts`], cwd: directory, label: `${dialect}-type-files` });
  passed(files);
  const loaded = files.output.replaceAll('\\', '/');
  for (const other of ['mysql', 'pg', 'mongodb', 'redis'].filter(value => value !== dialect)) {
    assert.ok(!loaded.includes(`/@zhin.js/database/lib/dialects/${other}.d.ts`), `${dialect} loaded unselected ${other} declarations`);
  }
  passed(await run({ command: process.execPath, args: ['--input-type=module', '-e', `await import(${JSON.stringify(driver)}); process.stdout.write('selected driver loaded without connecting\\n');`], cwd: directory, label: `${dialect}-runtime-import` }));
  checks.push(`${dialect}: actual selected driver installation, full native config, concrete generic result`);
}

await writeFile(join(artifact, 'verification.json'), JSON.stringify({ passed: true, artifacts: [...packed], checks,
  strict: true, skipLibCheck: false, sourceAliases: false, externalDatabaseConnections: 0, embeddedDatabaseRuns: 2, artifact }, null, 2));
process.stdout.write(JSON.stringify({ passed: true, artifact, archivedPackages: packed.size, checks }) + '\n');
