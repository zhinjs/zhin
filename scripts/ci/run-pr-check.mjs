import { execFileSync } from 'node:child_process';
import { writeFileSync, existsSync } from 'node:fs';
import { readScope } from './affected-scope.mjs';

const scope = JSON.parse(process.env.PR_SCOPE);
const root = process.cwd();
const run = (command, args) => execFileSync(command, args, { stdio: 'inherit', env: { ...process.env, NPM_TOKEN: '' } });
const pnpm = args => run('pnpm', args);
const mode = process.argv[2];
if (mode === 'build') {
  if (scope.builds.length) pnpm(['exec', 'turbo', 'run', 'build', '--cache-dir=.turbo/cache', ...scope.builds.map(name => `--filter=${name}...`)]);
  // Only workspace outputs; never node_modules or runner credentials.
  const graph = (await import('../lib/workspace-graph.mjs')).readWorkspaceGraph();
  const outputs = [...graph.values()].flatMap(pkg => ['lib', 'dist'].map(directory => `${pkg.dir}/${directory}`)).filter(path => existsSync(path));
  writeFileSync('.tmp-pr-outputs', outputs.join('\n'));
  run('tar', ['-czf', 'pr-build.tgz', '-T', '.tmp-pr-outputs']);
} else if (mode === 'test') {
  if (existsSync('pr-build.tgz')) run('tar', ['-xzf', 'pr-build.tgz']);
  // Recompute the same immutable scope locally; do not trust runner file paths from an artifact.
  const selected = readScope(root, scope.base, scope.head).tests;
  if (selected.length) pnpm(['exec', 'vitest', 'run', ...selected, `--shard=${process.env.PR_SHARD}/4`, '--maxWorkers=2', '--passWithNoTests']);
} else if (mode === 'contracts') {
  const changed = readScope(root, scope.base, scope.head);
  const lint = changed.lint.filter(file => existsSync(file));
  if (lint.length) pnpm(['exec', 'eslint', '--no-warn-ignored', ...lint]);
  // Source contracts stay on every PR; browser, packed consumers and the full
  // matrix run in Full validation and the explicit release batch.
  const checks = ['check:architecture', 'check:dependency-policy', 'check:release-plan', 'check:harness-paths',
    'check:no-removed-plugin-api', 'check:api-surface', 'check:plugin-runtime-api', 'check:feature-peers', 'check:doc-links'];
  await Promise.all(checks.map(command => new Promise((resolve, reject) => {
    import('node:child_process').then(({ spawn }) => {
      const child = spawn('pnpm', [command], { stdio: 'inherit', env: { ...process.env, NPM_TOKEN: '' } });
      child.once('error', reject); child.once('exit', code => code === 0 ? resolve() : reject(new Error(`${command} failed (${code})`)));
    }).catch(reject);
  })));
} else throw new Error(`Unknown PR check: ${mode}`);
