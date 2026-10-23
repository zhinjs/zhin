import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { comparison, planValidation, successfulRun, versionCandidate, versionSource, requireReleaseBatch } from './validation-plan.mjs';
import { verifyVersionTree } from './verify-version-tree.mjs';
import { affectedScope } from './affected-scope.mjs';
import { releaseMode } from './release-mode.mjs';

const sha = 'a'.repeat(40), base = 'b'.repeat(40);
const roots: string[] = [];
afterEach(() => roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })));
const repo = 'zhinjs/zhin';
const evidence = { id: 1, head_sha: sha, repository: { full_name: repo }, event: 'merge_group', status: 'completed', conclusion: 'success' };

describe('validation reuse boundaries', () => {
  it('accepts only a completed same-repository exact-SHA push/merge-group success', async () => {
    for (const invalid of [
      { ...evidence, head_sha: base }, { ...evidence, event: 'pull_request' },
      { ...evidence, status: 'in_progress' }, { ...evidence, conclusion: 'cancelled' },
      { ...evidence, conclusion: 'failure' }, { ...evidence, repository: { full_name: 'fork/zhin' } },
      { ...evidence, id: 2 },
    ]) {
      const found = await successfulRun({ repository: repo, workflow: 'ci.yml', sha, token: 'synthetic', currentRun: '2',
        fetcher: async () => new Response(JSON.stringify({ workflow_runs: [invalid, evidence] })) });
      expect(found).toEqual(evidence);
    }
  });

  it('uses authenticated read-only API with bounded timeout and no title-based lookup', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ workflow_runs: [evidence] })));
    await successfulRun({ repository: repo, workflow: 'ci.yml', sha, token: 'synthetic', currentRun: 2, fetcher });
    const [url, options] = fetcher.mock.calls[0]! as unknown as [URL, RequestInit];
    expect(url.searchParams.get('head_sha')).toBe(sha);
    expect(url.searchParams.get('status')).toBe('success');
    expect(options.signal).toBeDefined();
    expect(options.method ?? 'GET').toBe('GET');
  });

  it('does not confuse a pull-request head with its tested merge ref', () => {
    expect(comparison('pull_request', { pull_request: { base: { sha: base }, head: { sha: 'c'.repeat(40) } } }, sha)).toEqual({ base, head: sha });
    expect(comparison('merge_group', { merge_group: { base_sha: base } }, sha)).toEqual({ base, head: sha });
  });

  it('reuses main only with evidence and fails back to complete validation on missing/error evidence', async () => {
    const options = { eventName: 'push', event: { ref: 'refs/heads/main', before: base }, sha,
      repository: repo, workflow: 'ci.yml', token: 'synthetic', currentRun: 2, git: () => 'M\0src.ts\0' };
    await expect(planValidation({ ...options, findRun: async () => evidence })).resolves.toMatchObject({ mode: 'reuse' });
    await expect(planValidation({ ...options, findRun: async () => undefined })).resolves.toMatchObject({ mode: 'full' });
    await expect(planValidation({ ...options, findRun: async () => { throw new Error('403'); } })).resolves.toMatchObject({ mode: 'full' });
    await expect(planValidation({ ...options, eventName: 'pull_request', event: { pull_request: { base: { sha: base } } }, findRun: async () => evidence })).resolves.toMatchObject({ mode: 'full' });
  });

  it('blocks a version PR or generated merge-group without a successful explicit release batch', async () => {
    const options = { result: { mode: 'version', base }, eventName: 'pull_request',
      event: { pull_request: { head: { ref: 'changeset-release/main' } } }, repository: repo, token: 'synthetic', currentRun: 2 };
    await expect(requireReleaseBatch({ ...options, findRun: async () => undefined })).rejects.toThrow('full release batch');
    await expect(requireReleaseBatch({ ...options, findRun: async () => evidence })).resolves.toBeUndefined();
    await expect(requireReleaseBatch({ ...options, result: { mode: 'full' }, findRun: async () => evidence })).rejects.toThrow('not reproducible');
    await expect(requireReleaseBatch({ ...options, eventName: 'merge_group', event: {}, findRun: async () => undefined })).rejects.toThrow('full release batch');
  });

  it('requires a validated baseline before attempting a generated-version proof', async () => {
    const options = { eventName: 'merge_group', event: { merge_group: { base_sha: base } }, sha,
      repository: repo, workflow: 'ci.yml', token: 'synthetic', currentRun: 2,
      git: () => 'D\0.changeset/patch.md\0M\0packages/a/package.json\0' };
    await expect(planValidation({ ...options, findRun: async () => evidence })).resolves.toMatchObject({ mode: 'version', base, head: sha });
    await expect(planValidation({ ...options, findRun: async () => undefined })).resolves.toMatchObject({ mode: 'full' });
    expect(versionCandidate([{ status: 'M', path: '.github/workflows/ci.yml' }])).toBe(false);
    expect(versionCandidate([{ status: 'M', path: 'package.json' }])).toBe(false);
    expect(versionCandidate([{ status: 'D', path: '.changeset/patch.md' }, { status: 'M', path: 'src/main.ts' }])).toBe(false);
  });
});

function versionFixture() {
  const root = mkdtempSync(join(tmpdir(), 'zhin-ci-version-test-')); roots.push(root);
  const write = (path: string, value: unknown) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), typeof value === 'string' ? value : JSON.stringify(value, null, 2));
  };
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init', '-q', '-b', 'main'); git('config', 'user.name', 'Fixture'); git('config', 'user.email', 'test@example.invalid');
  write('.gitignore', 'node_modules\n');
  write('package.json', { name: 'fixture', private: true, workspaces: ['packages/*'], scripts: { bump: 'touch UNSAFE_SCRIPT_EXECUTED' } });
  write('pnpm-workspace.yaml', 'packages:\n  - packages/*\n');
  write('packages/a/package.json', { name: '@fixture/a', version: '1.0.0' });
  write('packages/a/src/index.ts', 'export const answer = 42;\n');
  write('.changeset/config.json', { changelog: '@changesets/cli/changelog', baseBranch: 'main', access: 'public', commit: false, fixed: [], linked: [], updateInternalDependencies: 'patch', ignore: [] });
  write('.changeset/patch.md', '---\n"@fixture/a": patch\n---\n\nFix fixture.\n');
  git('add', '-A'); git('commit', '-qm', 'source');
  const before = git('rev-parse', 'HEAD');
  const require = createRequire(import.meta.url);
  const cli = require.resolve('@changesets/cli/bin.js');
  symlinkSync(fileURLToPath(new URL('../../node_modules', import.meta.url)), join(root, 'node_modules'), 'dir');
  // The CLI resolves its own dependencies; the fixture has no application lifecycle to run.
  execFileSync(process.execPath, [cli, 'version'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  git('add', '-A'); git('commit', '-qm', 'generated version');
  return { root, git, write, base: before, head: git('rev-parse', 'HEAD'), cli };
}

describe('generated version tree proof', () => {
  it('reproduces real Changesets output and never runs the package bump script', () => {
    const fixture = versionFixture();
    expect(verifyVersionTree(fixture)).toMatchObject({ valid: true });
    expect(existsSync(join(fixture.root, 'UNSAFE_SCRIPT_EXECUTED'))).toBe(false);
    expect(fixture.git('status', '--porcelain')).toBe('');
    expect(fixture.git('worktree', 'list', '--porcelain').match(/^worktree /gm)).toHaveLength(1);
  });

  it('rejects metadata tampering even when all filenames resemble generated version files', () => {
    const fixture = versionFixture();
    fixture.write('packages/a/package.json', { name: '@fixture/a', version: '1.0.1', scripts: { preinstall: 'echo unsafe' } });
    fixture.git('add', '-A'); fixture.git('commit', '-qm', 'disguised source change');
    expect(verifyVersionTree({ ...fixture, head: fixture.git('rev-parse', 'HEAD') })).toMatchObject({ valid: false });
    fixture.write('packages/a/src/index.ts', 'export const answer = 0;\n');
    fixture.git('add', '-A'); fixture.git('commit', '-qm', 'source change');
    expect(verifyVersionTree({ ...fixture, head: fixture.git('rev-parse', 'HEAD') })).toMatchObject({ valid: false });
  });
});

describe('release routing before changeset consumption', () => {
  it('does nothing on ordinary pushes; full validation precedes version generation only on explicit dispatch', () => {
    const fixture = versionFixture();
    expect(releaseMode({ git: fixture.git, before: fixture.base })).toBe('publish');
    expect(releaseMode({ git: fixture.git, manual: true })).toBe('publish');
    expect(versionSource(fixture.git, fixture.head)).toBe(fixture.base);
    fixture.git('checkout', '--detach', fixture.base);
    expect(releaseMode({ git: fixture.git })).toBe('none');
    expect(releaseMode({ git: fixture.git, manual: true })).toBe('prepare');
  });

  it('rejects retrying the same published versions after source changes', () => {
    const fixture = versionFixture();
    fixture.write('packages/a/src/index.ts', 'export const answer = 0;\n');
    fixture.git('add', '-A'); fixture.git('commit', '-qm', 'source drift');
    expect(() => versionSource(fixture.git, fixture.git('rev-parse', 'HEAD'))).toThrow('No unchanged generated release tree');
  });
});

const workflow = (name: string) => parse(readFileSync(new URL(`../../.github/workflows/${name}.yml`, import.meta.url), 'utf8'));
// This file is in scripts/ci: resolve repository fixtures from here.
const load = (path: string) => parse(readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8'));

describe('workflow routing contracts', () => {
  it('fails the required aggregate on planner/build/test failure and keeps merge queue validation', () => {
    const ci = workflow('ci');
    expect(ci.on).toHaveProperty('merge_group');
    expect(ci.jobs.checks.if).toContain('always()');
    expect(ci.jobs.checks.needs).toEqual(['plan', 'contracts', 'build', 'test']);
    const aggregate = ci.jobs.checks.steps[0];
    expect(aggregate.env.PLAN).toBe('${{ needs.plan.result }}');
    for (const variable of ['PLAN', 'CONTRACTS', 'BUILD', 'TEST']) expect(aggregate.run).toContain(`test "$${variable}" = success`);
    expect(ci.jobs.test.strategy.matrix.shard).toEqual([1, 2, 3, 4]);
    expect(JSON.stringify(ci)).not.toMatch(/--coverage|check:created-project|check:all|windows-latest/);
    const full = workflow('full-validation');
    expect(full.on).toHaveProperty('schedule');
    expect(full.on).toHaveProperty('workflow_call');
    expect(full.on).not.toHaveProperty('pull_request');
    expect(full.on).not.toHaveProperty('push');
    expect(full.jobs.test.strategy.matrix['node-version']).toEqual([22, 24, 26]);
    expect(full.jobs.test.strategy.matrix.os).toEqual(['ubuntu-latest', 'windows-latest']);
    expect(JSON.stringify(full.jobs.test)).toContain('--coverage');
  });

  it('has a read-only evidence phase and isolated script-free version tooling', () => {
    const action = load('.github/actions/plan-validation/action.yml');
    const install = action.runs.steps.find((step: { id: string }) => step.id === 'install');
    expect(install.run).toContain('--frozen-lockfile --ignore-scripts --ignore-pnpmfile');
    expect(install.env).toEqual({ NPM_TOKEN: '${{ inputs.npm-token }}' });
    const baseline = action.runs.steps.find((step: { name?: string }) => step.name === 'use validated baseline for version tooling');
    expect(baseline.env.VERSION_BASE).toBe('${{ steps.decide.outputs.base }}');
    expect(action.runs.steps.indexOf(baseline)).toBeLessThan(action.runs.steps.indexOf(install));
    expect(baseline.run).toContain('checkout --detach');
    const proof = action.runs.steps.find((step: { id: string }) => step.id === 'version');
    expect(proof.env.NPM_TOKEN).toBe('');
    expect(action.runs.steps.at(-1).env.FULL).toContain("steps.version.outputs.valid != 'true'");
  });

  it('requires full release validation before versioning and a source receipt before publication', () => {
    const release = workflow('publish');
    expect(release.jobs.plan.steps.at(-1).run).toBe('node scripts/ci/release-mode.mjs');
    expect(release.jobs.validate.uses).toBe('./.github/workflows/full-validation.yml');
    expect(release.jobs.validate.if).toBe("needs.plan.outputs.mode == 'prepare'");
    expect(release.jobs.version.needs).toEqual(['plan', 'validate']);
    expect(release.jobs.version.if).toContain("needs.validate.result == 'success'");
    expect(release.jobs.version.environment).toBeUndefined();
    expect(release.jobs.version.permissions['id-token']).toBeUndefined();
    expect(JSON.stringify(release.jobs.version)).not.toContain('secrets.NPM_TOKEN');
    const action = release.jobs.version.steps.find((step: { uses?: string }) => step.uses?.startsWith('changesets/action@'));
    expect(action.with.publish).toBeUndefined();
    expect(release.jobs.publish.environment).toBe('npm-production');
    expect(release.jobs.publish.needs).toContain('approve-publication');
    const proof = release.jobs['approve-publication'].steps.find((step: { id?: string }) => step.id === 'proof');
    expect(proof.with['release-proof']).toBe('true');
    const commands = release.jobs.publish.steps.map((step: { run?: string }) => step.run).filter(Boolean).join('\n');
    for (const gate of ['pnpm build', 'pnpm check:pack-imports', 'pnpm check:created-project', 'pnpm check:unpublished']) expect(commands).toContain(gate);
    expect(commands).not.toContain('pnpm check:all');
    expect(JSON.stringify(workflow('full-validation').jobs.checks)).toContain('pnpm check:all');
  });
});

describe('affected PR scope', () => {
  const packages = [
    { name: 'base', dir: 'packages/base', dependencies: [] },
    { name: 'app', dir: 'packages/app', dependencies: ['base'] },
    { name: 'other', dir: 'packages/other', dependencies: [] },
    { name: 'docs', dir: 'docs', dependencies: [] },
  ];
  const tests = ['packages/base/tests/a.test.ts', 'packages/app/tests/b.test.ts', 'packages/other/tests/c.test.ts', 'tests/docs/workflow.test.ts', 'scripts/ci/plan.test.ts'];
  it('tests changed packages and downstream consumers, excluding unrelated packages', () => {
    const scope = affectedScope({ changed: ['packages/base/src/deleted.ts'], packages, tests });
    expect(scope.builds).toEqual(['app', 'base']);
    expect(scope.tests).toEqual(['packages/app/tests/b.test.ts', 'packages/base/tests/a.test.ts']);
  });
  it('builds root-test source imports and compiled consumers without widening affected tests', () => {
    const selected = 'tests/docs/workflow.test.ts';
    const scope = affectedScope({ changed: ['.github/workflows/ci.yml'], packages, tests,
      testSources: { [selected]: `import { value } from '../../packages/base/src/index.js';
        const runner = 'packages/app/lib/index.js';` } });
    expect(scope.builds).toEqual(['app', 'base']);
    expect(scope.tests).toEqual(['scripts/ci/plan.test.ts', selected]);
    const sourceChange = affectedScope({ changed: ['packages/base/src/index.ts'], packages, tests,
      testSources: { [selected]: "import { value } from '../../packages/base/src/index.js';" } });
    expect(sourceChange.tests).toContain(selected);
    expect(sourceChange.tests).not.toContain('packages/other/tests/c.test.ts');
  });
  it('covers dynamic workflow/doc contracts and global toolchain changes conservatively', () => {
    expect(affectedScope({ changed: ['.github/workflows/ci.yml'], packages, tests }).tests).toEqual(['scripts/ci/plan.test.ts', 'tests/docs/workflow.test.ts']);
    const global = affectedScope({ changed: ['pnpm-lock.yaml'], packages, tests });
    expect(global.all).toBe(true);
    expect(global.tests).toEqual([...tests].sort());
    expect(global.builds).not.toContain('docs');
  });
});
