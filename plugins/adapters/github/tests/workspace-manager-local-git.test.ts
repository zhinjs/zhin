import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import type { GhClient } from '../src/gh-client.js';
import { WorkspaceManager } from '../src/workspace-manager.js';

let directory: string | undefined;
afterEach(() => {
  vi.unstubAllEnvs();
  if (directory) rmSync(directory, { recursive: true, force: true });
  directory = undefined;
});

it('preserves clone, new/remote/local branch checkout and push through real local Git', async () => {
  directory = mkdtempSync(path.join(tmpdir(), 'zhin-workspace-args-'));
  // No personal Git config, credentials, hooks or network services enter this fixture.
  const config = path.join(directory, 'gitconfig');
  writeFileSync(config, '[gc]\n\tauto = 0\n');
  vi.stubEnv('GIT_CONFIG_GLOBAL', config);
  vi.stubEnv('GIT_CONFIG_NOSYSTEM', '1');
  vi.stubEnv('GIT_TERMINAL_PROMPT', '0');
  const git = (cwd: string, ...args: string[]) => execFileSync('git', args, {
    cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
  const remote = path.join(directory, 'remote.git');
  git(directory, 'init', '--bare', '--initial-branch=main', remote);
  const seed = path.join(directory, 'seed');
  mkdirSync(seed);
  git(seed, 'init', '--initial-branch=main');
  git(seed, 'config', 'user.name', 'Fixture');
  git(seed, 'config', 'user.email', 'fixture@example.invalid');
  writeFileSync(path.join(seed, 'readme.txt'), 'initial');
  git(seed, 'add', 'readme.txt');
  git(seed, 'commit', '-m', 'initial');
  git(seed, 'push', remote, 'main');
  const client = {
    isAppAuth: true,
    ensureInstallationTokenForRepo: async () => 'synthetic-token',
    getBotIdentity: async () => ({ login: 'fixture-bot', email: 'bot@example.invalid' }),
    buildCloneUrl: () => remote,
  } as unknown as GhClient;
  const manager = new WorkspaceManager(client, path.join(directory, 'first'));
  const workspace = await manager.checkoutBranch('owner/repo', 'feat/localization', 'main', 'en');
  expect(git(workspace, 'branch', '--show-current')).toBe('feat/localization');
  writeFileSync(path.join(workspace, 'readme.txt'), 'updated');
  await expect(manager.commitAndPush('owner/repo', 'feat/localization', 'update', 'en'))
    .resolves.toBe('Pushed to origin/feat/localization');
  const revision = git(workspace, 'rev-parse', 'HEAD');
  expect(git(directory, '--git-dir', remote, 'rev-parse', 'refs/heads/feat/localization')).toBe(revision);
  // Existing local branch: pull --rebase. A second clone: ls-remote and checkout -B.
  await expect(manager.checkoutBranch('owner/repo', 'feat/localization', 'main', 'en')).resolves.toBe(workspace);
  const second = new WorkspaceManager(client, path.join(directory, 'second'));
  const other = await second.checkoutBranch('owner/repo', 'feat/localization', 'main', 'zh-CN');
  expect(git(other, 'rev-parse', 'HEAD')).toBe(revision);
  expect(readFileSync(path.join(other, 'readme.txt'), 'utf8')).toBe('updated');
}, 15_000);
