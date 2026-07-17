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
const packages = [
  { dir: 'packages/next/kernel', name: '@zhin.js/next-kernel', dependencies: [] },
  {
    dir: 'packages/next/console-contract',
    name: '@zhin.js/next-console-contract',
    dependencies: [],
  },
  {
    dir: 'packages/next/feature-kit',
    name: '@zhin.js/next-feature-kit',
    dependencies: ['@zhin.js/next-kernel'],
  },
  {
    dir: 'packages/next/feature-adapter',
    name: '@zhin.js/next-feature-adapter',
    dependencies: ['@zhin.js/next-kernel', '@zhin.js/next-feature-kit'],
  },
  {
    dir: 'packages/next/feature-command',
    name: '@zhin.js/next-feature-command',
    dependencies: ['@zhin.js/next-kernel', '@zhin.js/next-feature-kit'],
  },
  {
    dir: 'packages/next/feature-component',
    name: '@zhin.js/next-feature-component',
    dependencies: ['@zhin.js/next-kernel', '@zhin.js/next-feature-kit'],
  },
  {
    dir: 'packages/next/feature-middleware',
    name: '@zhin.js/next-feature-middleware',
    dependencies: ['@zhin.js/next-kernel', '@zhin.js/next-feature-kit'],
  },
  {
    dir: 'packages/next/feature-agent',
    name: '@zhin.js/next-feature-agent',
    dependencies: ['@zhin.js/next-kernel', '@zhin.js/next-feature-kit'],
  },
  {
    dir: 'packages/next/feature-mcp',
    name: '@zhin.js/next-feature-mcp',
    dependencies: ['@zhin.js/next-kernel', '@zhin.js/next-feature-kit'],
  },
  {
    dir: 'packages/next/feature-skill',
    name: '@zhin.js/next-feature-skill',
    dependencies: ['@zhin.js/next-kernel', '@zhin.js/next-feature-kit'],
  },
  {
    dir: 'packages/next/feature-tool',
    name: '@zhin.js/next-feature-tool',
    dependencies: ['@zhin.js/next-kernel', '@zhin.js/next-feature-kit'],
  },
  {
    dir: 'packages/next/feature-page',
    name: '@zhin.js/next-feature-page',
    dependencies: [
      '@zhin.js/next-console-contract',
      '@zhin.js/next-kernel',
      '@zhin.js/next-feature-kit',
    ],
  },
  {
    dir: 'packages/next/feature-layout',
    name: '@zhin.js/next-feature-layout',
    dependencies: [
      '@zhin.js/next-console-contract',
      '@zhin.js/next-kernel',
      '@zhin.js/next-feature-kit',
    ],
  },
  {
    dir: 'packages/next/runtime',
    name: '@zhin.js/next-runtime',
    dependencies: ['@zhin.js/next-kernel', '@zhin.js/next-feature-kit'],
  },
  {
    dir: 'packages/next/config-yaml',
    name: '@zhin.js/next-config-yaml',
    dependencies: ['@zhin.js/next-runtime'],
  },
  {
    dir: 'packages/next/im',
    name: '@zhin.js/next-im',
    dependencies: [
      '@zhin.js/next-kernel',
      '@zhin.js/next-feature-adapter',
      '@zhin.js/next-feature-command',
      '@zhin.js/next-feature-component',
      '@zhin.js/next-feature-middleware',
    ],
  },
  {
    dir: 'packages/next/agent',
    name: '@zhin.js/next-agent',
    dependencies: [
      '@zhin.js/next-kernel',
      '@zhin.js/next-feature-agent',
      '@zhin.js/next-feature-mcp',
      '@zhin.js/next-feature-skill',
      '@zhin.js/next-feature-tool',
    ],
  },
  {
    dir: 'packages/next/console',
    name: '@zhin.js/next-console',
    dependencies: [
      '@zhin.js/next-console-contract',
      '@zhin.js/next-kernel',
      '@zhin.js/next-feature-page',
      '@zhin.js/next-feature-layout',
    ],
  },
];
const targetName = process.argv[2] ?? '@zhin.js/next-runtime';
const packagesByName = new Map(packages.map((item) => [item.name, item]));
if (!packagesByName.has(targetName)) {
  throw new Error(`Unknown Next install-size target: ${targetName}`);
}
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

function dependencyClosure(name, visited = new Set(), result = []) {
  if (visited.has(name)) return result;
  const item = packagesByName.get(name);
  if (!item) throw new Error(`Unknown Next package dependency: ${name}`);
  visited.add(name);
  for (const dependency of item.dependencies) dependencyClosure(dependency, visited, result);
  result.push(item);
  return result;
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
      throw new Error(`${targetName} exceeds its ${formatMb(budgetBytes)} budget`);
    }
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

main();
