import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parse } from 'yaml';
import { affectedScope, readPlannedScope, scopeOutputs } from './affected-scope.mjs';

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })));

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'zhin-ci-scope-')); roots.push(root);
  const write = (path: string, value: string) => {
    mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), value);
  };
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init', '-q', '-b', 'main'); git('config', 'user.name', 'Fixture'); git('config', 'user.email', 'test@example.invalid');
  for (const path of ['scripts/ci/affected-scope.mjs', 'scripts/ci/run-pr-check.mjs', 'scripts/ci/validation-plan.mjs', 'scripts/lib/workspace-graph.mjs']) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    copyFileSync(new URL(`../../${path}`, import.meta.url), join(root, path));
  }
  write('pnpm-workspace.yaml', "packages:\n  - 'packages/*'\n");
  write('packages/app/package.json', JSON.stringify({ name: '@fixture/app' }));
  write('packages/other/package.json', JSON.stringify({ name: '@fixture/other' }));
  git('add', '-A'); git('commit', '-qm', 'baseline'); const base = git('rev-parse', 'HEAD');
  const tests = Array.from({ length: 720 }, (_, index) => `packages/app/tests/${String(index).padStart(4, '0')}-${'x'.repeat(100)}.test.ts`);
  for (const file of tests) write(file, "it('fixture', () => {});\n");
  // A global change must continue selecting every package and every test file.
  write('pnpm-lock.yaml', 'lockfileVersion: 9.0\n');
  git('add', '-A'); git('commit', '-qm', 'large global change'); const head = git('rev-parse', 'HEAD');
  write('event.json', JSON.stringify({ pull_request: { base: { sha: base }, head: { sha: 'c'.repeat(40) } } }));
  // A test-only preload captures pnpm on every OS, without relying on POSIX shell stubs.
  // The planner, git queries and job entrypoint still run in actual child Node processes.
  write('capture-commands.mjs', `import childProcess from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { EventEmitter } from 'node:events';
const capture = args => appendFileSync(process.env.CI_SCOPE_CAPTURE, JSON.stringify({
  args, base: process.env.PR_SCOPE_BASE, head: process.env.PR_SCOPE_HEAD,
  expandedScope: Object.hasOwn(process.env, 'PR_SCOPE'),
}) + '\\n');
const exec = childProcess.execFileSync;
childProcess.execFileSync = (command, args, options) => {
  if (command === 'pnpm') { capture(args); return Buffer.alloc(0); }
  if (command === 'tar') return Buffer.alloc(0);
  return exec(command, args, options);
};
const spawn = childProcess.spawn;
childProcess.spawn = (command, args, options) => {
  if (command !== 'pnpm') return spawn(command, args, options);
  capture(args); const child = new EventEmitter(); queueMicrotask(() => child.emit('exit', 0)); return child;
};
syncBuiltinESMExports();
`);
  // Synthetic output for the archive list; the command recorder never builds workspace code.
  write('packages/app/lib/index.js', 'export const fixture = true;\n');
  const env = { ...process.env, NPM_TOKEN: '', GITHUB_EVENT_NAME: 'pull_request',
    GITHUB_EVENT_PATH: join(root, 'event.json'), GITHUB_SHA: head, GITHUB_OUTPUT: join(root, 'outputs'),
    CI_SCOPE_CAPTURE: join(root, 'commands.jsonl'), PR_SHARD: '2' };
  return { root, base, head, git, tests, env };
}

describe('bounded PR scope transport', () => {
  it('runs the real planner and all job consumers without transporting expanded lists', () => {
    const f = fixture();
    const changed = [...f.tests, 'pnpm-lock.yaml'];
    const expanded = { ...affectedScope({ changed, tests: f.tests, packages: [
      { name: '@fixture/app', dir: 'packages/app', dependencies: [] },
      { name: '@fixture/other', dir: 'packages/other', dependencies: [] },
    ] }), changed, base: f.base, head: f.head };
    const legacyValue = JSON.stringify(expanded);
    expect(Buffer.byteLength(legacyValue)).toBeGreaterThan(128 * 1024);
    // Linux rejects the old single environment entry before the requested process runs.
    if (process.platform === 'linux') {
      expect(spawnSync(process.execPath, ['--version'], { env: { ...process.env, PR_SCOPE: legacyValue } }).error)
        .toMatchObject({ code: 'E2BIG' });
    }
    execFileSync(process.execPath, ['scripts/ci/affected-scope.mjs'], { cwd: f.root, env: f.env, stdio: 'pipe' });
    const output = readFileSync(f.env.GITHUB_OUTPUT, 'utf8');
    expect(Buffer.byteLength(output)).toBeLessThan(256);
    const outputs = Object.fromEntries(output.trim().split('\n').map(line => line.split('=')));
    expect(outputs).toEqual({ base: f.base, head: f.head, builds: 'true', tests: 'true' });
    expect(scopeOutputs(expanded)).toEqual({ base: f.base, head: f.head, builds: true, tests: true });
    const env = { ...f.env, PR_SCOPE_BASE: outputs.base, PR_SCOPE_HEAD: outputs.head };
    for (const mode of ['build', 'test', 'contracts']) {
      execFileSync(process.execPath, ['--import', pathToFileURL(join(f.root, 'capture-commands.mjs')).href,
        'scripts/ci/run-pr-check.mjs', mode], { cwd: f.root, env, stdio: 'pipe' });
    }
    const commands = readFileSync(f.env.CI_SCOPE_CAPTURE, 'utf8').trim().split('\n').map(line => JSON.parse(line)) as {
      args: string[]; base: string; head: string; expandedScope: boolean;
    }[];
    expect(commands).toHaveLength(12);
    expect(commands.every(command => command.base === f.base && command.head === f.head && !command.expandedScope)).toBe(true);
    expect(commands.find(command => command.args.includes('turbo'))?.args).toEqual([
      'exec', 'turbo', 'run', 'build', '--cache-dir=.turbo/cache', '--filter=@fixture/app...', '--filter=@fixture/other...',
    ]);
    expect(commands.find(command => command.args.includes('vitest'))?.args).toEqual([
      'exec', 'vitest', 'run', ...f.tests, '--shard=2/4', '--maxWorkers=2', '--passWithNoTests',
    ]);
    expect(commands.find(command => command.args.includes('eslint'))?.args).toEqual(['exec', 'eslint', '--no-warn-ignored', ...f.tests]);
    expect(commands.filter(command => command.args.length === 1).map(command => command.args[0]).sort()).toEqual([
      'check:architecture', 'check:dependency-policy', 'check:release-plan', 'check:harness-paths',
      'check:no-removed-plugin-api', 'check:api-surface', 'check:plugin-runtime-api', 'check:feature-peers', 'check:doc-links',
    ].sort());
  });

  it('fails closed on missing, mutable, or mismatched scope commits', () => {
    const base = 'a'.repeat(40), head = 'b'.repeat(40);
    for (const env of [{}, { PR_SCOPE_BASE: base, PR_SCOPE_HEAD: 'main' },
      { PR_SCOPE_BASE: '0'.repeat(40), PR_SCOPE_HEAD: head }]) {
      expect(() => readPlannedScope(process.cwd(), env)).toThrow('Missing or invalid immutable PR scope commits');
    }
    expect(() => readPlannedScope(process.cwd(), { PR_SCOPE_BASE: base, PR_SCOPE_HEAD: head, GITHUB_SHA: base }))
      .toThrow('does not match the workflow candidate');
    expect(() => readPlannedScope(process.cwd(), { PR_SCOPE_BASE: base, PR_SCOPE_HEAD: head, GITHUB_SHA: head }))
      .toThrow('does not match the checked-out candidate');
  });

  it('wires every job to the same bounded planner references', () => {
    const workflow = parse(readFileSync(new URL('../../.github/workflows/ci.yml', import.meta.url), 'utf8'));
    expect(workflow.jobs.plan.outputs).not.toHaveProperty('scope');
    expect(workflow.jobs.plan.outputs.base).toBe('${{ steps.scope.outputs.base }}');
    expect(workflow.jobs.plan.outputs.head).toBe('${{ steps.scope.outputs.head }}');
    for (const mode of ['build', 'test', 'contracts']) {
      const step = workflow.jobs[mode].steps.find((step: { run?: string }) => step.run === `node scripts/ci/run-pr-check.mjs ${mode}`);
      expect(step.env).not.toHaveProperty('PR_SCOPE');
      expect(step.env).toMatchObject({ PR_SCOPE_BASE: '${{ needs.plan.outputs.base }}', PR_SCOPE_HEAD: '${{ needs.plan.outputs.head }}' });
    }
  });
});
