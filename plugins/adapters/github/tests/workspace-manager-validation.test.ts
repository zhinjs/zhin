import { describe, it, expect } from 'vitest';
import {
  WorkspaceManager,
  assertRepoFullName,
  assertGitRefName,
} from '../src/workspace-manager.js';
import type { GhClient } from '../src/gh-client.js';

describe('assertRepoFullName', () => {
  it('accepts valid owner/name pairs', () => {
    for (const repo of ['owner/repo', 'zhin.js/zhin', 'a-b_c.d/e', 'A1/B2']) {
      expect(() => assertRepoFullName(repo)).not.toThrow();
    }
  });

  it('rejects option/path injection and malformed names', () => {
    for (const repo of [
      '--upload-pack=x',
      '../etc',
      'a;b',
      'owner/repo/extra',
      'owner',
      '',
      'owner//repo',
      'owner/repo.git evil',
      '-o/repo',
      'owner/-x',
    ]) {
      expect(() => assertRepoFullName(repo)).toThrow(TypeError);
    }
  });
});

describe('assertGitRefName', () => {
  it('accepts valid branch/ref names', () => {
    for (const ref of ['main', 'feature/foo', 'zhin/bot/issue-42', 'v1.2.3', 'fix_a-b']) {
      expect(() => assertGitRefName(ref)).not.toThrow();
    }
  });

  it('rejects option injection, traversal and illegal chars', () => {
    for (const ref of [
      '--upload-pack=x',
      '-d',
      '',
      'bad ref..x',
      'a;b',
      'a b',
      'a\tb',
      'a~b',
      'a^b',
      'a:b',
      'a?b',
      'a*b',
      'a[b',
      'a\\b',
      'a`b',
      'foo/',
      'foo.',
    ]) {
      expect(() => assertGitRefName(ref)).toThrow(TypeError);
    }
  });
});

describe('WorkspaceManager input validation', () => {
  const createManager = () => {
    const calls: string[] = [];
    const gh = {
      isAppAuth: true,
      ensureInstallationTokenForRepo: async () => {
        calls.push('token');
        return 'token';
      },
      getBotIdentity: async () => ({ login: 'bot', email: 'bot@example.com' }),
      buildCloneUrl: (repo: string, token: string) => {
        calls.push('cloneUrl');
        return `https://x:${token}@github.com/${repo}.git`;
      },
    } as unknown as GhClient;
    return { manager: new WorkspaceManager(gh, '/tmp/zhin-ws-test'), calls };
  };

  it('getRepoPath rejects invalid repo before joining path', () => {
    const { manager } = createManager();
    expect(() => manager.getRepoPath('../etc')).toThrow(TypeError);
    expect(() => manager.getRepoPath('--upload-pack=x')).toThrow(TypeError);
  });

  it('ensureRepo rejects invalid repo before touching git/token', async () => {
    const { manager, calls } = createManager();
    await expect(manager.ensureRepo('--upload-pack=x')).rejects.toThrow(TypeError);
    await expect(manager.ensureRepo('../etc')).rejects.toThrow(TypeError);
    expect(calls).toEqual([]);
  });

  it('checkoutBranch rejects invalid branch/baseRef before touching git/token', async () => {
    const { manager, calls } = createManager();
    await expect(manager.checkoutBranch('owner/repo', '--upload-pack=x', 'main')).rejects.toThrow(TypeError);
    await expect(manager.checkoutBranch('owner/repo', 'feat', 'bad ref..x')).rejects.toThrow(TypeError);
    await expect(manager.checkoutBranch('../etc', 'feat', 'main')).rejects.toThrow(TypeError);
    expect(calls).toEqual([]);
  });

  it('commitAndPush rejects invalid repo/branch before touching git/token', async () => {
    const { manager, calls } = createManager();
    await expect(manager.commitAndPush('--upload-pack=x', 'main', 'msg')).rejects.toThrow(TypeError);
    await expect(manager.commitAndPush('owner/repo', '', 'msg')).rejects.toThrow(TypeError);
    expect(calls).toEqual([]);
  });
});
