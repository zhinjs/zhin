/**
 * Managed git workspaces for GitHub App Bot development flow.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { GhClient, GitHubBotIdentity } from './gh-client.js';

const REPO_FULL_NAME_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const GIT_REF_ILLEGAL_CHARS = new Set('~^:?*[\\`;');

function containsIllegalGitRefCharacter(ref: string): boolean {
  return [...ref].some((character) => {
    const code = character.charCodeAt(0);
    return code <= 31
      || code === 127
      || /\s/u.test(character)
      || GIT_REF_ILLEGAL_CHARS.has(character);
  });
}

/**
 * 校验 GitHub "owner/name" 全名，防止路径穿越与 git 选项注入。
 * 返回通过校验的原值，便于调用方直接使用「已消毒」的变量。
 */
export function assertRepoFullName(repo: string): string {
  if (
    typeof repo !== 'string' ||
    !REPO_FULL_NAME_RE.test(repo) ||
    repo.split('/').some((seg) => seg === '' || seg.startsWith('-') || /^\.+$/.test(seg))
  ) {
    throw new TypeError(`非法的仓库全名: ${JSON.stringify(repo)}`);
  }
  return repo;
}

/**
 * 校验 git ref 名称，拒绝选项注入（`-` 前缀）与 git 非法字符。
 */
export function assertGitRefName(ref: string): string {
  if (typeof ref !== 'string' || ref.length === 0) {
    throw new TypeError(`非法的 git ref: ${JSON.stringify(ref)}`);
  }
  if (
    ref.startsWith('-') ||
    ref.includes('..') ||
    containsIllegalGitRefCharacter(ref) ||
    ref.endsWith('/') ||
    ref.endsWith('.')
  ) {
    throw new TypeError(`非法的 git ref: ${JSON.stringify(ref)}`);
  }
  return ref;
}

export class WorkspaceManager {
  constructor(
    private readonly gh: GhClient,
    private readonly rootDir: string,
  ) {}

  getRepoPath(repo: string): string {
    repo = assertRepoFullName(repo);
    const [owner, name] = repo.split('/');
    return path.join(this.rootDir, owner, name);
  }

  private runGit(cwd: string, args: string[], env?: NodeJS.ProcessEnv): Promise<string> {
    return new Promise((resolve, reject) => {
      const proc = spawn('git', args, {
        cwd,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, ...env },
      });
      let stdout = '';
      let stderr = '';
      proc.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
      proc.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
      proc.on('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'ENOENT') reject(new Error('git 未安装'));
        else reject(err);
      });
      proc.on('close', (code) => {
        if (code === 0) resolve(stdout);
        else reject(new Error(stderr.trim() || `git ${args.join(' ')} failed (${code})`));
      });
    });
  }

  configureBotGit(repoPath: string, identity: GitHubBotIdentity): Promise<void> {
    return Promise.all([
      this.runGit(repoPath, ['config', 'user.name', identity.login]),
      this.runGit(repoPath, ['config', 'user.email', identity.email]),
    ]).then(() => undefined);
  }

  async ensureRepo(repo: string): Promise<string> {
    repo = assertRepoFullName(repo);
    if (!this.gh.isAppAuth) {
      throw new Error('GitHub App 认证未配置，无法托管工作区');
    }
    const token = await this.gh.ensureInstallationTokenForRepo(repo);
    if (!token) throw new Error(`无法获取 ${repo} 的 Installation Token`);

    const repoPath = this.getRepoPath(repo);
    fs.mkdirSync(path.dirname(repoPath), { recursive: true });

    const identity = await this.gh.getBotIdentity();
    if (!identity) throw new Error('无法解析 GitHub App Bot 身份');

    const cloneUrl = this.gh.buildCloneUrl(repo, token);
    if (!fs.existsSync(path.join(repoPath, '.git'))) {
      await this.runGit(path.dirname(repoPath), ['clone', cloneUrl, path.basename(repoPath)]);
    } else {
      await this.runGit(repoPath, ['remote', 'set-url', 'origin', cloneUrl]);
      await this.runGit(repoPath, ['fetch', 'origin', '--prune']);
    }

    await this.configureBotGit(repoPath, identity);
    return repoPath;
  }

  async checkoutBranch(repo: string, branch: string, baseRef: string): Promise<string> {
    repo = assertRepoFullName(repo);
    branch = assertGitRefName(branch);
    baseRef = assertGitRefName(baseRef);
    const repoPath = await this.ensureRepo(repo);
    const localBranches = await this.runGit(repoPath, ['branch', '--list', branch]);
    if (localBranches.trim()) {
      await this.runGit(repoPath, ['checkout', branch]);
      await this.runGit(repoPath, ['pull', '--rebase', 'origin', branch]).catch(async () => {
        await this.runGit(repoPath, ['fetch', 'origin', branch]);
      });
      return repoPath;
    }

    const remoteBranch = await this.runGit(repoPath, ['ls-remote', '--heads', 'origin', branch]);
    if (remoteBranch.trim()) {
      await this.runGit(repoPath, ['checkout', '-B', branch, `origin/${branch}`]);
      return repoPath;
    }

    await this.runGit(repoPath, ['fetch', 'origin', baseRef]);
    await this.runGit(repoPath, ['checkout', '-B', branch, `origin/${baseRef}`]);
    return repoPath;
  }

  async commitAndPush(repo: string, branch: string, message: string): Promise<string> {
    repo = assertRepoFullName(repo);
    branch = assertGitRefName(branch);
    const repoPath = this.getRepoPath(repo);
    if (!fs.existsSync(repoPath)) {
      throw new Error(`工作区不存在: ${repoPath}，请先 github_prepare_workspace`);
    }

    const token = await this.gh.ensureInstallationTokenForRepo(repo);
    if (!token) throw new Error('Installation Token 不可用');
    await this.runGit(repoPath, ['remote', 'set-url', 'origin', this.gh.buildCloneUrl(repo, token)]);

    const status = await this.runGit(repoPath, ['status', '--porcelain']);
    if (!status.trim()) return '没有可提交的变更';

    await this.runGit(repoPath, ['add', '-A']);
    await this.runGit(repoPath, ['commit', '-m', message]);
    await this.runGit(repoPath, ['push', '-u', 'origin', branch]);
    return `已 push 到 origin/${branch}`;
  }
}
