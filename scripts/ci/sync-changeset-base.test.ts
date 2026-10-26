import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })));
const require = createRequire(import.meta.url);
const changesets = require.resolve('@changesets/cli/bin.js');
const action = parse(readFileSync(new URL('../../.github/actions/prepare-workspace/action.yml', import.meta.url), 'utf8'));
const syncStep = action.runs.steps.find((step: { name: string }) => step.name === 'sync local main ref for changesets');

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'zhin-ci-changeset-base-')); roots.push(root);
  const origin = join(root, 'origin.git'), seed = join(root, 'seed'), checkout = join(root, 'checkout');
  const gitAt = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  gitAt(root, 'init', '--bare', '-q', '-b', 'main', origin);
  gitAt(root, 'init', '-q', '-b', 'main', seed);
  const git = (...args: string[]) => gitAt(checkout, ...args);
  const sourceGit = (...args: string[]) => gitAt(seed, ...args);
  sourceGit('config', 'user.name', 'Fixture'); sourceGit('config', 'user.email', 'test@example.invalid');
  const write = (file: string, value: string) => { mkdirSync(dirname(join(seed, file)), { recursive: true }); writeFileSync(join(seed, file), value); };
  write('package.json', JSON.stringify({ name: 'fixture', private: true, workspaces: ['packages/*'] }));
  write('pnpm-workspace.yaml', 'packages:\n  - packages/*\n');
  write('packages/demo/package.json', JSON.stringify({ name: '@fixture/demo', version: '1.0.0' }));
  write('packages/demo/index.js', 'export const value = 1;\n');
  write('.changeset/config.json', JSON.stringify({ baseBranch: 'main', changelog: false, commit: false,
    fixed: [], linked: [], access: 'public', updateInternalDependencies: 'patch', ignore: [] }));
  sourceGit('add', '.'); sourceGit('commit', '-qm', 'baseline'); const base = sourceGit('rev-parse', 'HEAD');
  sourceGit('remote', 'add', 'origin', origin); sourceGit('push', '-q', 'origin', 'main');
  sourceGit('checkout', '-qb', 'feature');
  write('packages/demo/index.js', 'export const value = 2;\n');
  write('.changeset/fixture.md', '---\n"@fixture/demo": patch\n---\n\nFix fixture.\n');
  sourceGit('add', '.'); sourceGit('commit', '-qm', 'candidate'); sourceGit('push', '-q', 'origin', 'feature');
  const head = sourceGit('rev-parse', 'HEAD');
  gitAt(root, 'clone', '-q', origin, checkout);
  const run = (event: string, ref: string) => {
    const [command, script] = syncStep.run.split(' ');
    expect(command).toBe('node');
    return spawnSync(process.execPath, [fileURLToPath(new URL(`../../${script}`, import.meta.url))], {
      cwd: checkout, encoding: 'utf8', env: { ...process.env, GITHUB_EVENT_NAME: event, GITHUB_REF: ref },
    });
  };
  const status = () => spawnSync(process.execPath, [changesets, 'status'], { cwd: checkout, encoding: 'utf8' });
  return { root, origin, checkout, git, sourceGit, write, base, head, run, status };
}

describe('Changesets base ref in workflow checkouts', () => {
  it('repairs a manually selected branch and passes the actual Changesets status gate', () => {
    const f = fixture(); f.git('checkout', '-qb', 'feature', 'origin/feature'); f.git('branch', '-D', 'main');
    writeFileSync(join(f.checkout, 'unrelated-local-file'), 'preserve');
    const before = f.status();
    expect(before.status).not.toBe(0);
    expect(before.stdout + before.stderr).toContain('Failed to find where HEAD diverged from "main"');
    expect(f.run('workflow_dispatch', 'refs/heads/feature').status).toBe(0);
    expect(f.git('rev-parse', 'main')).toBe(f.base);
    expect(f.git('rev-parse', 'HEAD')).toBe(f.head);
    expect(f.git('branch', '--show-current')).toBe('feature');
    expect(f.git('remote', 'get-url', 'origin')).toBe(f.origin);
    expect(readFileSync(join(f.checkout, 'unrelated-local-file'), 'utf8')).toBe('preserve');
    expect(f.status().status).toBe(0);
  });

  it.each(['pull_request', 'merge_group', 'workflow_call'])('prepares detached candidates without moving HEAD: %s', event => {
    const f = fixture(); f.git('checkout', '--detach', f.head); f.git('branch', '-D', 'main');
    expect(f.run(event, 'refs/pull/1/merge').status).toBe(0);
    expect(f.git('rev-parse', 'main')).toBe(f.base);
    expect(f.git('rev-parse', 'HEAD')).toBe(f.head);
    expect(f.git('branch', '--show-current')).toBe('');
    expect(f.git('remote', 'get-url', 'origin')).toBe(f.origin);
    expect(f.status().status).toBe(0);
  });

  it('leaves a checked-out main candidate untouched even if origin main advanced', () => {
    const f = fixture(); f.sourceGit('checkout', 'main');
    f.write('upstream.txt', 'advanced'); f.sourceGit('add', '.'); f.sourceGit('commit', '-qm', 'upstream advances');
    f.sourceGit('push', '-q', 'origin', 'main');
    expect(f.sourceGit('rev-parse', 'main')).not.toBe(f.base);
    for (const event of ['workflow_dispatch', 'schedule', 'push']) {
      expect(f.run(event, 'refs/heads/main').status).toBe(0);
      expect(f.git('rev-parse', 'HEAD')).toBe(f.base);
      expect(f.git('rev-parse', 'main')).toBe(f.base);
      expect(f.git('branch', '--show-current')).toBe('main');
    }
    expect(f.status().status).toBe(0);
  });

  it('fails rather than replacing a diverged local main or the candidate', () => {
    const f = fixture();
    f.git('config', 'user.name', 'Fixture'); f.git('config', 'user.email', 'test@example.invalid');
    writeFileSync(join(f.checkout, 'local.txt'), 'local'); f.git('add', '.'); f.git('commit', '-qm', 'local main change');
    const localMain = f.git('rev-parse', 'main');
    f.git('checkout', '-qb', 'feature', 'origin/feature');
    expect(f.run('workflow_dispatch', 'refs/heads/feature').status).not.toBe(0);
    expect(f.git('rev-parse', 'main')).toBe(localMain);
    expect(f.git('rev-parse', 'HEAD')).toBe(f.head);
  });

  it('shares the same ref preparation across the composite action and full matrix', () => {
    const full = parse(readFileSync(new URL('../../.github/workflows/full-validation.yml', import.meta.url), 'utf8'));
    const matrixSync = full.jobs.test.steps.find((step: { name: string }) => step.name === 'sync local main ref for changesets');
    expect(syncStep.if).toBeUndefined(); expect(matrixSync.if).toBeUndefined();
    expect(matrixSync.run).toBe(syncStep.run);
    expect(syncStep.run).toBe('node scripts/ci/sync-changeset-base.mjs');
    expect(full.jobs.checks.steps.some((step: { uses: string }) => step.uses === './.github/actions/prepare-workspace')).toBe(true);
    expect(full.jobs.checks.steps.find((step: { name: string }) => step.name === 'check changeset').run).toBe('pnpm changeset status');
  });
});
