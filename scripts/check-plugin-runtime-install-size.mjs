#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dependencyClosure, readWorkspaceGraph } from './lib/workspace-graph.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageManager = JSON.parse(
  fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'),
).packageManager;
const budgetBytes = 5 * 1024 * 1024;
const targetName = process.argv[2] ?? '@zhin.js/plugin-runtime';
const workspaceGraph = readWorkspaceGraph();
if (!workspaceGraph.has(targetName)) {
  throw new Error(`Unknown Plugin Runtime install-size target: ${targetName}`);
}
// 打包清单由依赖图推导（scripts/lib/workspace-graph），新增 workspace 依赖无需手改本脚本
const stack = dependencyClosure(targetName);
const forbiddenPackages = /^(?:vite(?:@|_)|@vitejs|lightningcss(?:[-@_]|$))/u;

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
  });
}

function packPackage(directory, output) {
  const before = new Set(fs.readdirSync(output));
  run('pnpm', ['pack', '--pack-destination', output], { cwd: directory });
  const archives = fs.readdirSync(output).filter(
    (file) => file.endsWith('.tgz') && !before.has(file),
  );
  if (archives.length !== 1) {
    throw new Error(`Expected one archive from ${directory}, got ${archives.join(', ')}`);
  }
  return path.join(output, archives[0]);
}

function diskUsage(directory) {
  const output = execFileSync('du', ['-sk', directory], { encoding: 'utf8' });
  return Number.parseInt(output.split(/\s+/u)[0], 10) * 1024;
}

function formatMb(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function largestEntries(directory, limit = 10) {
  return fs.readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({ name: entry.name, bytes: diskUsage(path.join(directory, entry.name)) }))
    .sort((left, right) => right.bytes - left.bytes)
    .slice(0, limit);
}

function main() {
  for (const item of stack) run('pnpm', ['--filter', item.name, 'build']);

  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'zhin-runtime-size-'));
  const archives = path.join(work, 'archives');
  const fixture = path.join(work, 'fixture');
  fs.mkdirSync(archives);
  fs.mkdirSync(fixture);

  try {
    const overrides = {};
    for (const item of stack) {
      overrides[item.name] = `file:${packPackage(path.join(repoRoot, item.dir), archives)}`;
    }
    fs.writeFileSync(
      path.join(fixture, 'package.json'),
      `${JSON.stringify({
        name: 'zhin-runtime-size-fixture',
        private: true,
        packageManager,
        dependencies: { [targetName]: overrides[targetName] },
        pnpm: { overrides },
      }, null, 2)}\n`,
    );
    run('pnpm', [
      'install',
      '--prod',
      '--ignore-scripts',
      '--store-dir',
      path.join(work, 'store'),
    ], {
      cwd: fixture,
      env: { ...process.env, NODE_ENV: 'production' },
    });

    const virtualStore = path.join(fixture, 'node_modules/.pnpm');
    const forbidden = fs.readdirSync(virtualStore).filter((name) => forbiddenPackages.test(name));
    if (forbidden.length > 0) {
      throw new Error(`Forbidden production dependencies: ${forbidden.join(', ')}`);
    }

    const bytes = diskUsage(path.join(fixture, 'node_modules'));
    console.log(`${targetName} production install: ${formatMb(bytes)}`);
    console.log(`budget: ${formatMb(budgetBytes)}`);
    if (bytes > budgetBytes) {
      console.log('largest production packages:');
      for (const entry of largestEntries(virtualStore)) {
        console.log(`- ${entry.name}: ${formatMb(entry.bytes)}`);
      }
      throw new Error(`${targetName} exceeds its ${formatMb(budgetBytes)} budget`);
    }
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

main();
