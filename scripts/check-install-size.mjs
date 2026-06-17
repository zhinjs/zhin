#!/usr/bin/env node
/**
 * ADR 0019 — production node_modules install size gate for zhin.js IM core (<10MB).
 * Packs workspace IM stack so the check reflects unpublished dependency graph (not registry stale core→ai).
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

const IM_BUDGET_BYTES = 10 * 1024 * 1024;

/** bottom-up build order */
const IM_STACK = [
  { dir: 'basic/schema', name: '@zhin.js/schema' },
  { dir: 'basic/logger', name: '@zhin.js/logger' },
  { dir: 'packages/im/kernel', name: '@zhin.js/kernel' },
  { dir: 'basic/database', name: '@zhin.js/database' },
  { dir: 'packages/im/core', name: '@zhin.js/core' },
  { dir: 'packages/im/zhin', name: 'zhin.js' },
];

function run(cmd, opts = {}) {
  execSync(cmd, { stdio: 'inherit', ...opts });
}

function duBytes(dir) {
  const out = execSync(`du -sk ${JSON.stringify(dir)}`, { encoding: 'utf8' });
  const kb = Number.parseInt(out.split(/\s+/)[0], 10);
  return kb * 1024;
}

function packPackage(pkgDir, outDir) {
  const before = new Set(fs.readdirSync(outDir));
  execSync(`pnpm pack --pack-destination ${JSON.stringify(outDir)}`, {
    cwd: pkgDir,
    stdio: 'pipe',
  });
  const created = fs.readdirSync(outDir).filter((f) => f.endsWith('.tgz') && !before.has(f));
  if (created.length !== 1) {
    throw new Error(`Expected one new .tgz from ${pkgDir}, got: ${created.join(', ')}`);
  }
  return path.join(outDir, created[0]);
}

function packImStack(packDir) {
  const overrides = {};
  for (const entry of IM_STACK) {
    const pkgDir = path.join(repoRoot, entry.dir);
    const tgz = packPackage(pkgDir, packDir);
    overrides[entry.name] = `file:${tgz}`;
  }
  return overrides;
}

function measureInstall(overrides) {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'zhin-install-size-'));
  try {
    const pkg = {
      name: 'zhin-install-size-fixture',
      private: true,
      dependencies: {
        'zhin.js': overrides['zhin.js'],
      },
      pnpm: { overrides },
    };
    fs.writeFileSync(path.join(work, 'package.json'), JSON.stringify(pkg, null, 2));
    run('pnpm install --prod', {
      cwd: work,
      stdio: 'pipe',
      env: { ...process.env, NODE_ENV: 'production' },
    });
    return duBytes(path.join(work, 'node_modules'));
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

function formatMb(bytes) {
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function main() {
  console.log('Building IM stack packages…');
  for (const entry of IM_STACK) {
    run(`pnpm --filter ${entry.name} build`, { cwd: repoRoot, stdio: 'pipe' });
  }

  const packDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhin-pack-'));
  try {
    console.log('Packing workspace IM stack…');
    const overrides = packImStack(packDir);

    console.log('Measuring production node_modules for zhin.js IM core…');
    const bytes = measureInstall(overrides);
    console.log(`  zhin.js only: ${formatMb(bytes)} (budget ${formatMb(IM_BUDGET_BYTES)})`);

    if (bytes > IM_BUDGET_BYTES) {
      console.error(`FAIL: zhin.js production install exceeds ${formatMb(IM_BUDGET_BYTES)}`);
      process.exit(1);
    }

    console.log('PASS: zhin.js IM core within install budget.');
  } finally {
    fs.rmSync(packDir, { recursive: true, force: true });
  }
}

main();
