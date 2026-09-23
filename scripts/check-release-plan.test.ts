import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { findVersionedReleaseBaseline } from './release-version-coverage.mjs';

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));

function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'zhin-release-gate-test-'));
  roots.push(root);
  const write = (file: string, content: string) => {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), content);
  };
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  const commit = () => { git('add', '.'); git('commit', '-qm', 'fixture'); };
  const manifest = (version: string) => write('packages/demo/package.json', JSON.stringify({ name: '@test/demo', version }));
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'test@example.invalid');
  git('config', 'user.name', 'Release test');
  write('package.json', JSON.stringify({ name: 'fixture', private: true, workspaces: ['packages/*'] }));
  write('pnpm-workspace.yaml', 'packages:\n  - packages/*\n');
  write('.changeset/version-policy.json', JSON.stringify({ defaultReleaseType: 'patch' }));
  write('.changeset/config.json', JSON.stringify({ baseBranch: 'main' }));
  write('.changeset/fix.md', '---\n"@test/demo": patch\n---\nFix demo.\n');
  write('packages/demo/src/index.ts', 'export const value = 1;\n');
  write('packages/demo/CHANGELOG.md', '# Demo\n\n## 1.1.0\n');
  manifest('1.1.0');
  mkdirSync(path.join(root, 'scripts'));
  for (const file of ['check-release-plan.mjs', 'release-version-coverage.mjs']) {
    cpSync(new URL(file, import.meta.url), path.join(root, 'scripts', file));
  }
  commit();
  git('update-ref', 'refs/remotes/origin/main', 'HEAD');
  const bump = ({ version = '1.1.1', changelog = true, consume = true } = {}) => {
    manifest(version);
    if (changelog) write('packages/demo/CHANGELOG.md', `# Demo\n\n## ${version}\n\n### Patch Changes\n\nFix demo.\n\n## 1.1.0\n`);
    if (consume) rmSync(path.join(root, '.changeset/fix.md'));
    commit();
  };
  const check = (env = {}) => {
    const result = spawnSync(process.execPath, ['scripts/check-release-plan.mjs'], {
      cwd: root, encoding: 'utf8', env: { ...process.env, GITHUB_HEAD_REF: '', GITHUB_BASE_REF: '', ...env },
    });
    return { status: result.status, output: result.stdout + result.stderr };
  };
  return { root, write, git, commit, bump, check };
}

// The publish job runs on Ubuntu; this CLI gate invokes pnpm without a .cmd shell.
describe.skipIf(process.platform === 'win32')('release plan gate across versioning and publication', () => {
  it('accepts a merged patch release before publication creates its tag', () => {
    const repo = fixture();
    repo.git('checkout', '-qb', 'release');
    repo.bump();
    repo.git('checkout', '-q', 'main');
    repo.git('merge', '--no-ff', '-qm', 'Merge release', 'release');
    const result = repo.check();
    expect(result.output).toContain('Release plan check passed');
    expect(result.status).toBe(0);
  });

  it('accepts the same candidate in a version PR', () => {
    const repo = fixture();
    repo.git('checkout', '-qb', 'changeset-release/main');
    repo.bump();
    expect(repo.check({ GITHUB_HEAD_REF: 'changeset-release/main', GITHUB_BASE_REF: 'main' }).status).toBe(0);
  });

  it.each([false, true])('rejects uncovered changes after versioning (version PR: %s)', (versionPr) => {
    const repo = fixture();
    repo.bump();
    repo.write('packages/demo/src/index.ts', 'export const value = 2;\n');
    repo.commit();
    const result = repo.check(versionPr ? { GITHUB_HEAD_REF: 'changeset-release/main', GITHUB_BASE_REF: 'main' } : {});
    expect(result.status).toBe(1);
    expect(result.output).toContain('Publishable package changes are missing patch changesets');
  });

  it.each(['1.2.0', '2.0.0'])('rejects non-patch version output %s', (version) => {
    const repo = fixture();
    repo.bump({ version });
    expect(repo.check().status).toBe(1);
  });

  it('rejects an unchanged version output', () => {
    const repo = fixture();
    repo.bump({ version: '1.1.0' });
    expect(repo.check().status).toBe(1);
  });

  it('rejects a missing version changelog', () => {
    const repo = fixture();
    repo.bump({ changelog: false });
    expect(repo.check().status).toBe(1);
  });

  it('rejects an unexplained version bump without consumed changesets', () => {
    const repo = fixture();
    rmSync(path.join(repo.root, '.changeset/fix.md'));
    repo.commit();
    repo.bump({ consume: false });
    expect(repo.check().status).toBe(1);
  });

  it('does not accept a deleted empty changeset as versioning evidence', () => {
    const repo = fixture();
    repo.write('.changeset/fix.md', '---\n---\n');
    repo.commit();
    repo.bump();
    expect(repo.check().status).toBe(1);
  });

  it('does not count YAML comments as patch declarations', () => {
    const repo = fixture();
    repo.write('.changeset/fix.md', '---\n# @test/demo: patch\n---\n');
    repo.commit();
    repo.bump();
    const result = repo.check();
    expect(result.status).toBe(1);
    expect(result.output).toContain('missing current version tags');
  });

  it('rejects an unrelated package bumped in the same version commit', () => {
    const repo = fixture();
    repo.write('packages/other/package.json', JSON.stringify({ name: '@test/other', version: '1.1.0' }));
    repo.write('packages/other/CHANGELOG.md', '# Other\n\n## 1.1.0\n');
    repo.commit();
    repo.write('packages/other/package.json', JSON.stringify({ name: '@test/other', version: '1.1.1' }));
    repo.write('packages/other/CHANGELOG.md', '# Other\n\n## 1.1.1\n\n## 1.1.0\n');
    repo.bump();
    const result = repo.check();
    expect(result.status).toBe(1);
    expect(result.output).toContain('@test/other@1.1.1');
  });

  it('accepts a dependent package bumped by Changesets propagation', () => {
    const repo = fixture();
    repo.write('packages/dependent/package.json', JSON.stringify({
      name: '@test/dependent', version: '1.1.0', dependencies: { '@test/demo': 'workspace:^' },
    }));
    repo.write('packages/dependent/CHANGELOG.md', '# Dependent\n\n## 1.1.0\n');
    repo.commit();
    repo.write('packages/dependent/package.json', JSON.stringify({
      name: '@test/dependent', version: '1.1.1', dependencies: { '@test/demo': 'workspace:^' },
    }));
    repo.write('packages/dependent/CHANGELOG.md', '# Dependent\n\n## 1.1.1\n\n## 1.1.0\n');
    repo.bump();
    const result = repo.check();
    expect(result.status).toBe(0);
    expect(result.output).toContain('2 versioned packages awaiting tags');
  });

  it.each([true, false])('reads dependency propagation at the version commit (linked then: %s)', (linkedThen) => {
    const repo = fixture();
    const dependent = (linked: boolean, version: string) => JSON.stringify({
      name: '@test/dependent', version,
      dependencies: linked ? { '@test/demo': 'workspace:^' } : {},
    });
    repo.write('packages/dependent/package.json', dependent(linkedThen, '1.1.0'));
    repo.write('packages/dependent/CHANGELOG.md', '# Dependent\n\n## 1.1.0\n');
    repo.commit();
    repo.write('packages/dependent/package.json', dependent(linkedThen, '1.1.1'));
    repo.write('packages/dependent/CHANGELOG.md', '# Dependent\n\n## 1.1.1\n\n## 1.1.0\n');
    repo.bump();
    const versionCommit = repo.git('rev-parse', 'HEAD');
    repo.write('packages/dependent/package.json', dependent(!linkedThen, '1.1.1'));
    repo.commit();
    expect(findVersionedReleaseBaseline({
      root: repo.root, directory: 'packages/dependent', name: '@test/dependent', version: '1.1.1',
    })).toBe(linkedThen ? versionCommit : undefined);
  });

  it('does not accept a changelog heading that existed before versioning', () => {
    const repo = fixture();
    repo.write('packages/demo/CHANGELOG.md', '# Demo\n\n## 1.1.1\n\n## 1.1.0\n');
    repo.commit();
    repo.bump();
    expect(repo.check().status).toBe(1);
  });

  it('ignores test-only changes after versioning', () => {
    const repo = fixture();
    repo.bump();
    repo.write('packages/demo/tests/example.test.ts', 'it("works", () => {});\n');
    repo.commit();
    expect(repo.check().status).toBe(0);
  });

  it('accepts a changeset covering additional edits after versioning', () => {
    const repo = fixture();
    repo.bump();
    repo.write('packages/demo/src/index.ts', 'export const value = 4;\n');
    repo.write('.changeset/next.md', '---\n"@test/demo": patch\n---\nNext fix.\n');
    repo.commit();
    const result = repo.check();
    expect(result.output).toContain('1 pending patch releases');
    expect(result.status).toBe(0);
  });

  it('still checks changes after an existing publication tag', () => {
    const repo = fixture();
    repo.bump();
    repo.git('tag', '@test/demo@1.1.1');
    repo.write('packages/demo/src/index.ts', 'export const value = 3;\n');
    repo.commit();
    expect(repo.check().status).toBe(1);
  });
});
