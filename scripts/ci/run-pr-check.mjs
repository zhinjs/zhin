import { execFileSync } from 'node:child_process';
import { writeFileSync, existsSync, unlinkSync } from 'node:fs';
import { readPlannedScope } from './affected-scope.mjs';

const root = process.cwd();
// Never put expanded scope JSON in an environment variable: Linux limits each
// env entry to 128 KiB, which can prevent even the job's shell from starting.
const scope = readPlannedScope(root);
const run = (command, args) => execFileSync(command, args, { stdio: 'inherit', env: { ...process.env, NPM_TOKEN: '' } });
const pnpm = args => run('pnpm', args);
const mode = process.argv[2];
if (mode === 'build') {
  if (scope.builds.length) pnpm(['exec', 'turbo', 'run', 'build', '--cache-dir=.turbo/cache', ...scope.builds.map(name => `--filter=${name}...`)]);
  // Only workspace outputs; never node_modules or runner credentials.
  const graph = (await import('../lib/workspace-graph.mjs')).readWorkspaceGraph();
  const outputs = [...graph.values()].flatMap(pkg => ['lib', 'dist'].map(directory => `${pkg.dir}/${directory}`)).filter(path => existsSync(path));
  writeFileSync('.tmp-pr-outputs', outputs.join('\n'));
  try { run('tar', ['-czf', 'pr-build.tgz', '-T', '.tmp-pr-outputs']); }
  finally { unlinkSync('.tmp-pr-outputs'); }
} else if (mode === 'test') {
  if (existsSync('pr-build.tgz')) run('tar', ['-xzf', 'pr-build.tgz']);
  const selected = scope.tests;
  if (selected.length) pnpm(['exec', 'vitest', 'run', ...selected, `--shard=${process.env.PR_SHARD}/4`, '--maxWorkers=2', '--passWithNoTests']);
} else if (mode === 'contracts') {
  const lint = scope.lint.filter(file => existsSync(file));
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
