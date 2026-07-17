#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(packageRoot, '../../..');
const packageManager = JSON.parse(
  fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'),
).packageManager;
const budgetBytes = 5 * 1024 * 1024;
const stack = [
  { dir: 'packages/next/kernel', name: '@zhin.js/next-kernel' },
  { dir: 'packages/next/feature-kit', name: '@zhin.js/next-feature-kit' },
  { dir: 'packages/next/runtime', name: '@zhin.js/next-runtime' },
];
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

function main() {
  for (const item of stack) run('pnpm', ['--filter', item.name, 'build']);

  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'zhin-next-size-'));
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
        name: 'zhin-next-size-fixture',
        private: true,
        packageManager,
        dependencies: { '@zhin.js/next-runtime': overrides['@zhin.js/next-runtime'] },
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
    console.log(`next-runtime production install: ${formatMb(bytes)}`);
    console.log(`budget: ${formatMb(budgetBytes)}`);
    if (bytes > budgetBytes) {
      throw new Error(`next-runtime exceeds its ${formatMb(budgetBytes)} budget`);
    }
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

main();
