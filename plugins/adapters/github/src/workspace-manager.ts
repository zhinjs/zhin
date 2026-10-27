/**
 * Managed git workspaces for GitHub App Bot development flow.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createMessages, type Locale } from 'zhin.js/i18n';
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
export function assertRepoFullName(repo: string, locale?: Locale): string {
  if (
    typeof repo !== 'string' ||
    !REPO_FULL_NAME_RE.test(repo) ||
    repo.split('/').some((seg) => seg === '' || seg.startsWith('-') || /^\.+$/.test(seg))
  ) {
    throw new TypeError(t(locale, 'invalidRepo', { value: JSON.stringify(repo) }));
  }
  return repo;
}

/**
 * 校验 git ref 名称，拒绝选项注入（`-` 前缀）与 git 非法字符。
 */
export function assertGitRefName(ref: string, locale?: Locale): string {
  if (typeof ref !== 'string' || ref.length === 0) {
    throw new TypeError(t(locale, 'invalidRef', { value: JSON.stringify(ref) }));
  }
  if (
    ref.startsWith('-') ||
    ref.includes('..') ||
    containsIllegalGitRefCharacter(ref) ||
    ref.endsWith('/') ||
    ref.endsWith('.')
  ) {
    throw new TypeError(t(locale, 'invalidRef', { value: JSON.stringify(ref) }));
  }
  return ref;
}

export class WorkspaceManager {
  constructor(
    private readonly gh: GhClient,
    private readonly rootDir: string,
  ) {}

  getRepoPath(repo: string, locale?: Locale): string {
    repo = assertRepoFullName(repo, locale);
    const [owner, name] = repo.split('/');
    return path.join(this.rootDir, owner, name);
  }

  private runGit(cwd: string, args: string[], env?: NodeJS.ProcessEnv, locale?: Locale): Promise<string> {
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
        if (err.code === 'ENOENT') reject(new Error(t(locale, 'missingGit')));
        else reject(err);
      });
      proc.on('close', (code) => {
        if (code === 0) resolve(stdout);
        else reject(new Error(stderr.trim() || `git ${args.join(' ')} failed (${code})`));
      });
    });
  }

  configureBotGit(repoPath: string, identity: GitHubBotIdentity, locale?: Locale): Promise<void> {
    return Promise.all([
      this.runGit(repoPath, ['config', 'user.name', identity.login], undefined, locale),
      this.runGit(repoPath, ['config', 'user.email', identity.email], undefined, locale),
    ]).then(() => undefined);
  }

  async ensureRepo(repo: string, locale?: Locale): Promise<string> {
    repo = assertRepoFullName(repo, locale);
    if (!this.gh.isAppAuth) {
      throw new Error(t(locale, 'appRequired'));
    }
    const token = await this.gh.ensureInstallationTokenForRepo(repo);
    if (!token) throw new Error(t(locale, 'repoTokenUnavailable', { repo }));

    const repoPath = this.getRepoPath(repo, locale);
    fs.mkdirSync(path.dirname(repoPath), { recursive: true });

    const identity = await this.gh.getBotIdentity();
    if (!identity) throw new Error(t(locale, 'missingIdentity'));

    const cloneUrl = this.gh.buildCloneUrl(repo, token);
    if (!fs.existsSync(path.join(repoPath, '.git'))) {
      await this.runGit(path.dirname(repoPath), ['clone', cloneUrl, path.basename(repoPath)], undefined, locale);
    } else {
      await this.runGit(repoPath, ['remote', 'set-url', 'origin', cloneUrl], undefined, locale);
      await this.runGit(repoPath, ['fetch', 'origin', '--prune'], undefined, locale);
    }

    await this.configureBotGit(repoPath, identity, locale);
    return repoPath;
  }

  async checkoutBranch(repo: string, branch: string, baseRef: string, locale?: Locale): Promise<string> {
    repo = assertRepoFullName(repo, locale);
    branch = assertGitRefName(branch, locale);
    baseRef = assertGitRefName(baseRef, locale);
    const repoPath = await this.ensureRepo(repo, locale);
    const localBranches = await this.runGit(repoPath, ['branch', '--list', branch], undefined, locale);
    if (localBranches.trim()) {
      await this.runGit(repoPath, ['checkout', branch], undefined, locale);
      await this.runGit(repoPath, ['pull', '--rebase', 'origin', branch], undefined, locale).catch(async () => {
        await this.runGit(repoPath, ['fetch', 'origin', branch], undefined, locale);
      });
      return repoPath;
    }

    const remoteBranch = await this.runGit(repoPath, ['ls-remote', '--heads', 'origin', branch], undefined, locale);
    if (remoteBranch.trim()) {
      await this.runGit(repoPath, ['checkout', '-B', branch, `origin/${branch}`], undefined, locale);
      return repoPath;
    }

    await this.runGit(repoPath, ['fetch', 'origin', baseRef], undefined, locale);
    await this.runGit(repoPath, ['checkout', '-B', branch, `origin/${baseRef}`], undefined, locale);
    return repoPath;
  }

  async commitAndPush(repo: string, branch: string, message: string, locale?: Locale): Promise<string> {
    repo = assertRepoFullName(repo, locale);
    branch = assertGitRefName(branch, locale);
    const repoPath = this.getRepoPath(repo, locale);
    if (!fs.existsSync(repoPath)) {
      throw new Error(t(locale, 'missingWorkspace', { path: repoPath }));
    }

    const token = await this.gh.ensureInstallationTokenForRepo(repo);
    if (!token) throw new Error(t(locale, 'missingToken'));
    await this.runGit(repoPath, ['remote', 'set-url', 'origin', this.gh.buildCloneUrl(repo, token)], undefined, locale);

    const status = await this.runGit(repoPath, ['status', '--porcelain'], undefined, locale);
    if (!status.trim()) return t(locale, 'noChanges');

    await this.runGit(repoPath, ['add', '-A'], undefined, locale);
    await this.runGit(repoPath, ['commit', '-m', message], undefined, locale);
    await this.runGit(repoPath, ['push', '-u', 'origin', branch], undefined, locale);
    return t(locale, 'pushed', { branch });
  }
}
const t = createMessages({
  invalidRepo: { 'zh-CN': '非法的仓库全名: {value}', en: 'Invalid repository name: {value}' },
  invalidRef: { 'zh-CN': '非法的 git ref: {value}', en: 'Invalid git ref: {value}' },
  missingGit: { 'zh-CN': 'git 未安装', en: 'git is not installed' },
  appRequired: { 'zh-CN': 'GitHub App 认证未配置，无法托管工作区', en: 'GitHub App authentication is not configured; the workspace is unavailable' },
  repoTokenUnavailable: { 'zh-CN': '无法获取 {repo} 的 Installation Token', en: 'Cannot obtain an Installation Token for {repo}' },
  missingIdentity: { 'zh-CN': '无法解析 GitHub App Bot 身份', en: 'Cannot resolve the GitHub App bot identity' },
  missingWorkspace: { 'zh-CN': '工作区不存在: {path}，请先准备工作区', en: 'Workspace does not exist: {path}. Prepare the workspace first' },
  missingToken: { 'zh-CN': 'Installation Token 不可用', en: 'Installation Token is unavailable' },
  noChanges: { 'zh-CN': '没有可提交的变更', en: 'No changes to commit' },
  pushed: { 'zh-CN': '已 push 到 origin/{branch}', en: 'Pushed to origin/{branch}' },
});
