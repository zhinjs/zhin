#!/usr/bin/env node
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { affectedScope } from './ci/affected-scope.mjs';
import { readWorkspaceGraph } from './lib/workspace-graph.mjs';

const root = resolve(import.meta.dirname, '..');
const args = new Set(process.argv.slice(2));
const skipBuild = args.has('--skip-build');
const withTests = args.has('--with-tests');

const childEnv = {
  ...process.env,
  NPM_TOKEN: '',
  PATH: `${join(root, 'node_modules', '.bin')}:${process.env.PATH ?? ''}`,
  TURBO_TELEMETRY_DISABLED: '1',
  TURBO_CONFIG_DIR_PATH: join(root, '.turbo'),
};
const turboEnv = (() => {
  if (process.platform === 'darwin' && process.env.HOME) {
    try {
      readFileSync(join(process.env.HOME, '.npmrc'));
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'EPERM') {
        return {
          ...childEnv,
          COREPACK_HOME: process.env.COREPACK_HOME ?? join(process.env.HOME, '.cache/node/corepack'),
          HOME: '/tmp',
        };
      }
    }
  }
  return childEnv;
})();

const git = (...gitArgs) =>
  execFileSync('git', gitArgs, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

function resolveBaseCommit() {
  const explicitBase = process.env.PR_SCOPE_BASE;
  if (explicitBase) return explicitBase;
  for (const candidate of ['origin/main', 'main', 'HEAD~1']) {
    try {
      return git('merge-base', candidate, 'HEAD');
    } catch {
      // try next candidate
    }
  }
  return git('rev-parse', 'HEAD');
}

function collectChangedFiles(base) {
  const committed = git('diff', '--name-only', '-z', base, 'HEAD').split('\0').filter(Boolean);
  const working = git('diff', '--name-only', '-z', 'HEAD').split('\0').filter(Boolean);
  const untracked = git('ls-files', '--others', '--exclude-standard', '-z').split('\0').filter(Boolean);
  return [...new Set([...committed, ...working, ...untracked])].filter((file) => existsSync(join(root, file)));
}

function hasOverlappingDelimiterClass(line) {
  const bracketOpen = line.indexOf('\\[');
  if (bracketOpen !== -1) {
    const unsafeBracket = line.indexOf('[^\\]]', bracketOpen + 2);
    if (unsafeBracket !== -1) {
      const nextChar = line[unsafeBracket + 5];
      if (nextChar === '*' || nextChar === '+') {
        return 'overlapping bracket character class (use [^\\[\\]] instead of [^\\]])';
      }
    }
  }
  const angleOpen = line.indexOf('<@');
  if (angleOpen !== -1) {
    for (const token of ['[^>]*', '[^>]+', '[^>\\s]*', '[^>\\s]+']) {
      if (line.indexOf(token, angleOpen + 2) !== -1) {
        return 'overlapping angle-bracket character class (use [^<>] instead of [^>])';
      }
    }
  }
  return null;
}

function checkPolynomialReDoS(files) {
  const codeFiles = files.filter((file) => /\.[cm]?[jt]sx?$/.test(file) && file !== 'scripts/check-ci-preflight.mjs');
  const violations = [];
  for (const file of codeFiles) {
    const content = readFileSync(join(root, file), 'utf8');
    const lines = content.split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      const trimmed = line.trimStart();
      if (trimmed.startsWith('//') || trimmed.startsWith('*')) continue;
      const reason = hasOverlappingDelimiterClass(line);
      if (reason) {
        violations.push(`${file}:${index + 1} — ${reason}`);
      }
    }
  }
  if (violations.length > 0) {
    console.error('Potential polynomial ReDoS regex detected:');
    for (const violation of violations) console.error(`  - ${violation}`);
    process.exit(1);
  }
}

const bin = (name) => join(root, 'node_modules', '.bin', name);
const runSync = (command, commandArgs, env = childEnv) =>
  execFileSync(command, commandArgs, {
    cwd: root,
    stdio: 'inherit',
    env,
  });

const base = resolveBaseCommit();
const changed = collectChangedFiles(base);
const graph = readWorkspaceGraph();
const packages = [...graph.values()].map((pkg) => {
  const manifest = JSON.parse(readFileSync(join(root, pkg.dir, 'package.json'), 'utf8'));
  return {
    ...pkg,
    dependencies: [
      ...new Set([
        ...pkg.dependencies,
        ...Object.keys(manifest.devDependencies ?? {}),
        ...Object.keys(manifest.peerDependencies ?? {}),
        ...(manifest.zhin?.features ?? []).map((feature) => feature.package),
      ]),
    ],
  };
});
const tests = git('ls-files', '-z')
  .split('\0')
  .filter((file) => file.endsWith('.test.ts') && existsSync(join(root, file)));
const testSources = Object.fromEntries(tests.map((file) => [file, readFileSync(join(root, file), 'utf8')]));
const scope = affectedScope({ changed, packages, tests, testSources });

console.log(
  `[ci-preflight] base=${base.slice(0, 8)} changed=${changed.length} builds=${scope.builds.length} tests=${scope.tests.length}`,
);

function checkLockfileImporters(files) {
  const changedManifests = files.filter((file) => file === 'package.json' || file.endsWith('/package.json'));
  if (changedManifests.length === 0) return;
  const lockfileContent = readFileSync(join(root, 'pnpm-lock.yaml'), 'utf8');
  const importersEnd = lockfileContent.indexOf('\npackages:\n');
  const importersText = importersEnd !== -1 ? lockfileContent.slice(0, importersEnd) : lockfileContent;
  const mismatches = [];
  for (const manifestFile of changedManifests) {
    const importerKey = manifestFile === 'package.json' ? '.' : manifestFile.slice(0, -'/package.json'.length);
    const header = importerKey === '.' ? '\n  .:\n' : `\n  ${importerKey}:\n`;
    const startIdx = importersText.indexOf(header);
    if (startIdx === -1) continue;
    const afterHeader = importersText.slice(startIdx + header.length).split(/\r?\n/);
    const lockSpecifiers = new Map();
    let currentDepName = null;
    for (const line of afterHeader) {
      if (line.startsWith('  ') && !line.startsWith('    ') && line.endsWith(':')) break;
      if (line.startsWith('      ') && !line.startsWith('        ') && line.endsWith(':')) {
        const rawKey = line.trim().slice(0, -1);
        currentDepName = rawKey.startsWith("'") && rawKey.endsWith("'") ? rawKey.slice(1, -1) : rawKey;
        continue;
      }
      if (line.startsWith('        specifier: ') && currentDepName) {
        const rawSpec = line.slice('        specifier: '.length).trim();
        lockSpecifiers.set(
          currentDepName,
          rawSpec.startsWith("'") && rawSpec.endsWith("'") ? rawSpec.slice(1, -1) : rawSpec,
        );
        currentDepName = null;
      }
    }
    const manifest = JSON.parse(readFileSync(join(root, manifestFile), 'utf8'));
    const manifestSpecs = new Map([
      ...Object.entries(manifest.dependencies ?? {}),
      ...Object.entries(manifest.devDependencies ?? {}),
      ...Object.entries(manifest.optionalDependencies ?? {}),
    ]);
    for (const [dep, spec] of manifestSpecs) {
      if (lockSpecifiers.get(dep) !== spec) {
        mismatches.push(`${manifestFile}: "${dep}" specifier is "${spec}" in package.json but "${lockSpecifiers.get(dep) ?? '<missing>'}" in pnpm-lock.yaml`);
      }
    }
    for (const [dep, spec] of lockSpecifiers) {
      if (!manifestSpecs.has(dep)) {
        mismatches.push(`${manifestFile}: "${dep}" (${spec}) is still in pnpm-lock.yaml but removed from package.json`);
      }
    }
  }
  if (mismatches.length > 0) {
    console.error('Outdated pnpm-lock.yaml detected (run `pnpm install --lockfile-only --ignore-scripts`):');
    for (const mismatch of mismatches) console.error(`  - ${mismatch}`);
    process.exit(1);
  }
}

checkPolynomialReDoS(changed);
checkLockfileImporters(changed);
runSync(process.execPath, [join(root, 'scripts', 'check-no-platform-branches.mjs')]);

const lintFiles = scope.lint.filter((file) => existsSync(join(root, file)));
if (lintFiles.length > 0) {
  console.log(`[ci-preflight] linting ${lintFiles.length} changed file(s)...`);
  runSync(bin('eslint'), ['--no-warn-ignored', ...lintFiles]);
}

const checks = [
  'check:architecture',
  'check:dependency-policy',
  'check:release-plan',
  'check:harness-paths',
  'check:no-removed-plugin-api',
  'check:api-surface',
  'check:plugin-runtime-api',
  'check:feature-peers',
  'check:doc-links',
  'check:runtime-config-boundaries',
  'check:plugin-runtime-migration-readiness',
  'check:publishing-manifest',
];

console.log(`[ci-preflight] running ${checks.length} contract checks (concurrency=4)...`);
const queue = [...checks];
const runCheck = (command) =>
  new Promise((resolvePromise, rejectPromise) => {
    const child = spawn('pnpm', [command], {
      cwd: root,
      stdio: 'inherit',
      env: childEnv,
    });
    child.once('error', rejectPromise);
    child.once('exit', (code) =>
      code === 0 ? resolvePromise() : rejectPromise(new Error(`${command} failed (${code})`)));
  });

await Promise.all(
  Array.from({ length: Math.min(4, queue.length) }, async () => {
    while (queue.length > 0) await runCheck(queue.shift());
  }),
);

if (!skipBuild && scope.builds.length > 0) {
  console.log(`[ci-preflight] building ${scope.builds.length} affected package(s)...`);
  runSync(
    bin('turbo'),
    [
      'run',
      'build',
      '--cache-dir=.turbo/cache',
      ...scope.builds.map((name) => `--filter=${name}...`),
    ],
    turboEnv,
  );
}

if (withTests && scope.tests.length > 0) {
  console.log(`[ci-preflight] running ${scope.tests.length} affected test file(s)...`);
  runSync(bin('vitest'), ['run', ...scope.tests, '--passWithNoTests']);
}

console.log('[ci-preflight] all selected checks passed.');
