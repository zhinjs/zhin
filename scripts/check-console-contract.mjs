#!/usr/bin/env node
/**
 * Build the official Console against packed workspace artifacts.
 *
 * This deliberately crosses the publish seam: the Console never sees workspace
 * source or a manually replaced node_modules directory.
 */
import { execFileSync } from 'node:child_process';
import { cp, mkdtemp, mkdir, readFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  resolveWorkspacePackClosure,
  workspaceDependencyNames,
} from './workspace-pack-closure.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const consoleSource = process.env.ZHIN_CONSOLE_DIR
  ? path.resolve(process.env.ZHIN_CONSOLE_DIR)
  : null;

if (!consoleSource) {
  console.error('ZHIN_CONSOLE_DIR must point to a checkout of github.com/zhinjs/console');
  process.exit(2);
}

const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'zhin-console-contract-'));
const packDir = path.join(tempRoot, 'packs');
const consoleDir = path.join(tempRoot, 'console');

function pnpm(args, cwd) {
  execFileSync('pnpm', args, { cwd, stdio: 'inherit', env: process.env });
}

function readPackedManifest(tarball) {
  return JSON.parse(execFileSync(
    'tar',
    ['-xOf', tarball, 'package/package.json'],
    { encoding: 'utf8' },
  ));
}

async function listWorkspacePackages() {
  const listed = JSON.parse(execFileSync(
    'pnpm',
    ['list', '--recursive', '--depth', '-1', '--json'],
    { cwd: repoRoot, encoding: 'utf8', env: process.env },
  ));
  const packages = [];
  for (const entry of listed) {
    if (!entry.name || !entry.path) continue;
    const manifest = JSON.parse(await readFile(path.join(entry.path, 'package.json'), 'utf8'));
    packages.push({ name: entry.name, dir: entry.path, manifest });
  }
  return packages;
}

async function readPackedPackages() {
  const result = new Map();
  for (const name of await readdir(packDir)) {
    if (!name.endsWith('.tgz')) continue;
    const tarball = path.join(packDir, name);
    const manifest = readPackedManifest(tarball);
    result.set(manifest.name, { tarball, manifest });
  }
  return result;
}

try {
  await mkdir(packDir, { recursive: true });
  const workspacePackages = await listWorkspacePackages();
  const workspaceByName = new Map(workspacePackages.map((entry) => [entry.name, entry]));
  const packClosure = resolveWorkspacePackClosure(workspacePackages, [
    '@zhin.js/console-protocol',
    '@zhin.js/client',
  ]);
  const buildArgs = packClosure.flatMap(({ name }) => ['--filter', name]);
  pnpm([...buildArgs, 'build'], repoRoot);
  for (const entry of packClosure) {
    pnpm(['pack', '--pack-destination', packDir], entry.dir);
  }

  await cp(consoleSource, consoleDir, {
    recursive: true,
    filter(source) {
      const relative = path.relative(consoleSource, source);
      if (!relative) return true;
      const first = relative.split(path.sep)[0];
      return first !== '.git' && first !== 'node_modules' && first !== 'dist';
    },
  });

  const packedPackages = await readPackedPackages();
  const protocolPack = packedPackages.get('@zhin.js/console-protocol');
  const clientPack = packedPackages.get('@zhin.js/client');
  if (!protocolPack || !clientPack) {
    throw new Error('Packed Console protocol/client artifacts are missing');
  }
  const protocolManifest = protocolPack.manifest;
  const clientManifest = clientPack.manifest;
  if (clientManifest.dependencies?.['@zhin.js/console-protocol'] !== protocolManifest.version) {
    throw new Error(
      'Packed @zhin.js/client must depend on the packed @zhin.js/console-protocol version',
    );
  }
  for (const entry of packClosure) {
    const packed = packedPackages.get(entry.name);
    if (!packed) throw new Error(`Packed workspace artifact is missing: ${entry.name}`);
    for (const dependencyName of workspaceDependencyNames(entry.manifest, workspaceByName)) {
      const expectedVersion = workspaceByName.get(dependencyName).manifest.version;
      const actualVersion = packed.manifest.dependencies?.[dependencyName]
        ?? packed.manifest.optionalDependencies?.[dependencyName]
        ?? packed.manifest.peerDependencies?.[dependencyName];
      if (actualVersion !== expectedVersion) {
        throw new Error(
          `Packed ${entry.name} requires ${dependencyName}@${String(actualVersion)}; `
          + `expected local ${expectedVersion}`,
        );
      }
    }
  }
  pnpm(['install', '--frozen-lockfile'], consoleDir);
  pnpm([
    'add', '--save-prod', '--save-exact',
    ...packClosure.map(({ name }) => `file:${packedPackages.get(name).tarball}`),
  ], consoleDir);
  pnpm(['build'], consoleDir);
  console.log('Console publish-contract check passed.');
} finally {
  if (process.env.KEEP_CONSOLE_CONTRACT_TEMP === '1') {
    console.log(`Preserved contract workspace: ${tempRoot}`);
  } else {
    await rm(tempRoot, { recursive: true, force: true });
  }
}
