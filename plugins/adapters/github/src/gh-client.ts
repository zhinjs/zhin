/**
 * GitHub CLI (`gh`) 客户端封装
 *
 * 支持三种认证方式：
 * 1. gh CLI 默认凭据（gh auth login）
 * 2. GitHub App — JWT → Installation Token（自动续期）
 * 3. 个人 OAuth Token（用户绑定 / Device Flow）
 *
 * 零外部依赖，使用 Node.js 原生模块。
 */

import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';

// ── GitHub App 认证配置 ──────────────────────────────────────────────

export interface AppAuth {
  appId: string | number;
  /** PEM 格式私钥内容，或私钥文件路径 */
  privateKey: string;
}

export interface GhClientOptions {
  /** GitHub Enterprise 主机名（默认 github.com） */
  host?: string;
  /** 覆盖 gh CLI 默认认证的 Personal Access Token / OAuth Token */
  token?: string;
  /** GitHub App 认证 — 自动管理 Installation Token */
  appAuth?: AppAuth;
}

export class GhClient {
  private host?: string;
  private token?: string;
  private _appAuth?: AppAuth;
  private _resolvedKey?: string;
  private _user: string | null = null;
  /** Installation Token 缓存: installationId → { token, expiresAt } */
  private _installationTokens = new Map<number, { token: string; expiresAt: number }>();
  /** repo(小写) → installationId */
  private _repoToInstallation = new Map<string, number>();
  /** 所有 Installation 信息 */
  private _allInstallations: Array<{ id: number; account: { login: string; type: string }; target_type: string }> = [];
  /** 上次 syncInstallations 时间 (ms) */
  private _lastSyncTime = 0;

  constructor(options: GhClientOptions = {}) {
    this.host = options.host;
    this.token = options.token;
    this._appAuth = options.appAuth;
  }

  /** 创建使用指定 token 的副本（共享 host 配置，不继承 App 认证） */
  withToken(token: string): GhClient {
    return new GhClient({ host: this.host, token });
  }

  get authenticatedUser() { return this._user; }

  // ── 底层执行 ──────────────────────────────────────────────────────

  private exec(args: string[], stdin?: string): Promise<string> {
    const fullArgs = this.host ? [...args, '--hostname', this.host] : args;
    const env = this.token
      ? { ...process.env, GH_TOKEN: this.token }
      : undefined;
    return new Promise((resolve, reject) => {
      const proc = spawn('gh', fullArgs, { stdio: ['pipe', 'pipe', 'pipe'], env });
      let stdout = '';
      let stderr = '';
      proc.stdout.on('data', (d: Buffer) => (stdout += d.toString()));
      proc.stderr.on('data', (d: Buffer) => (stderr += d.toString()));
      proc.on('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'ENOENT') reject(new Error('gh CLI 未安装，请先安装: https://cli.github.com/'));
        else reject(err);
      });
      proc.on('close', (code) => {
        if (code === 0) resolve(stdout);
        else
          reject(
            Object.assign(new Error(stderr.trim() || `gh exited with code ${code}`), {
              stdout,
              stderr,
              exitCode: code,
            }),
          );
      });
      if (stdin !== undefined) proc.stdin.write(stdin);
      proc.stdin.end();
    });
  }

  // ── API 调用 ──────────────────────────────────────────────────────

  /**
   * 确保 App 认证的 Installation Token 有效（自动按 repo 查找对应安装）
   * @param repo 仓库全名（owner/repo），用于选择正确的 Installation
   */
  private async ensureTokenForRepo(repo?: string): Promise<void> {
    if (!this._appAuth) return;
    let installId: number | undefined;
    if (repo) {
      const key = repo.toLowerCase();
      installId = this._repoToInstallation.get(key);
      if (!installId) {
        // Owner 级别匹配（安装在整个账号/组织上）
        const owner = key.split('/')[0];
        for (const inst of this._allInstallations) {
          if (inst.account.login.toLowerCase() === owner) {
            installId = inst.id;
            break;
          }
        }
      }
      // 懒加载重新发现（5 分钟冷却）
      if (!installId && Date.now() - this._lastSyncTime > 5 * 60_000) {
        await this.syncInstallations();
        installId = this._repoToInstallation.get(key);
        if (!installId) {
          const owner = key.split('/')[0];
          for (const inst of this._allInstallations) {
            if (inst.account.login.toLowerCase() === owner) {
              installId = inst.id;
              break;
            }
          }
        }
      }
    }
    // 回退到第一个安装
    if (!installId && this._allInstallations.length) {
      installId = this._allInstallations[0].id;
    }
    if (!installId) return;
    const cached = this._installationTokens.get(installId);
    if (cached && cached.expiresAt > Date.now() + 60_000) {
      this.token = cached.token;
      return;
    }
    await this.refreshInstallationToken(installId);
  }

  async request<T = any>(
    method: string,
    path: string,
    body?: any,
    headers?: Record<string, string>,
  ): Promise<{ ok: boolean; status: number; data: T }> {
    // 从路径自动检测 repo 以选择正确的 Installation Token
    const repoMatch = path.match(/^\/repos\/([^/?]+\/[^/?]+)/);
    await this.ensureTokenForRepo(repoMatch?.[1]);
    const args = ['api', path, '--method', method];
    if (body) args.push('--input', '-');
    if (headers) {
      for (const [k, v] of Object.entries(headers)) {
        args.push('-H', `${k}: ${v}`);
      }
    }
    try {
      const raw = await this.exec(args, body ? JSON.stringify(body) : undefined);
      let data: any;
      try { data = raw ? JSON.parse(raw) : null; } catch { data = raw; }
      return { ok: true, status: 200, data };
    } catch (err: any) {
      let data: any;
      try { data = err.stdout ? JSON.parse(err.stdout) : { message: err.message }; } catch {
        data = { message: err.stderr?.trim() || err.message };
      }
      return { ok: false, status: err.exitCode || 0, data };
    }
  }

  private get<T = any>(path: string) { return this.request<T>('GET', path); }
  private post<T = any>(path: string, body?: any) { return this.request<T>('POST', path, body); }
  private patch<T = any>(path: string, body?: any) { return this.request<T>('PATCH', path, body); }
  private put<T = any>(path: string, body?: any) { return this.request<T>('PUT', path, body); }
  private del<T = any>(path: string, body?: any) { return this.request<T>('DELETE', path, body); }

  // ── 认证验证 ──────────────────────────────────────────────────────

  async verifyAuth(): Promise<{ ok: boolean; user: string; message: string }> {
    // App 认证模式：自动发现所有安装
    if (this._appAuth) {
      try {
        await this.syncInstallations();
        if (!this._allInstallations.length) {
          return { ok: false, user: '', message: 'GitHub App 没有任何安装，请先在 GitHub 上安装 App' };
        }
        // 用 JWT 查询 App 信息（/app 端点只接受 JWT 认证，不能用 Installation Token）
        const key = this.resolvePrivateKey();
        const jwt = GhClient.createJWT(this._appAuth.appId, key);
        const baseUrl = this.host ? `https://${this.host}/api/v3` : 'https://api.github.com';
        const appRes = await fetch(`${baseUrl}/app`, {
          headers: { Authorization: `Bearer ${jwt}`, Accept: 'application/vnd.github+json' },
        });
        if (appRes.ok) {
          const appData = (await appRes.json()) as { name: string; slug: string; client_id?: string };
          const name = `${appData.slug || appData.name}[bot]`;
          this._user = name;
          this._appSlug = appData.slug || null;
          if (appData.client_id) this._clientId = appData.client_id;
          const repos = this._repoToInstallation.size;
          return { ok: true, user: name, message: `GitHub App: ${name} (${this._allInstallations.length} 安装, ${repos} 仓库)` };
        }
        const errBody = await appRes.text();
        return { ok: false, user: '', message: `App Token 验证失败 (${appRes.status}): ${errBody}` };
      } catch (e: any) {
        return { ok: false, user: '', message: e.message || 'App 认证失败' };
      }
    }
    // Token 模式（用户绑定）或 gh CLI 默认模式
    try {
      if (this.token) {
        // 直接用 token 查 /user
        const r = await this.get<{ login: string }>('/user');
        if (r.ok) {
          this._user = r.data.login;
          return { ok: true, user: r.data.login, message: `token: ${r.data.login}` };
        }
        return { ok: false, user: '', message: 'Token 无效' };
      }
      await this.exec(['auth', 'status']);
      const raw = await this.exec(['api', '/user', '--jq', '.login']);
      const login = raw.trim();
      this._user = login;
      return { ok: true, user: login, message: `gh CLI: ${login}` };
    } catch (e: any) {
      return { ok: false, user: '', message: e.message || 'gh 认证检查失败' };
    }
  }

  // ── Issue 评论 (聊天核心) ─────────────────────────────────────────

  async createIssueComment(repo: string, issueNumber: number, body: string) {
    return this.post<{ id: number; html_url: string }>(`/repos/${repo}/issues/${issueNumber}/comments`, { body });
  }

  async deleteIssueComment(repo: string, commentId: number) {
    return this.del(`/repos/${repo}/issues/comments/${commentId}`);
  }

  async createPRComment(repo: string, prNumber: number, body: string) {
    return this.createIssueComment(repo, prNumber, body);
  }

  async deletePRReviewComment(repo: string, commentId: number) {
    return this.del(`/repos/${repo}/pulls/comments/${commentId}`);
  }

  // ── Pull Requests ─────────────────────────────────────────────────

  async listPRs(repo: string, state: string = 'open', limit: number = 15) {
    return this.get<any[]>(`/repos/${repo}/pulls?state=${state}&per_page=${limit}`);
  }

  async getPR(repo: string, number: number) {
    return this.get<any>(`/repos/${repo}/pulls/${number}`);
  }

  async getPRDiff(repo: string, number: number): Promise<{ ok: boolean; data: string }> {
    return this.request('GET', `/repos/${repo}/pulls/${number}`, undefined, {
      Accept: 'application/vnd.github.diff',
    }) as Promise<{ ok: boolean; data: string }>;
  }

  async mergePR(repo: string, number: number, method: string = 'squash') {
    return this.put<any>(`/repos/${repo}/pulls/${number}/merge`, { merge_method: method });
  }

  async createPR(repo: string, title: string, body: string, head: string, base: string = 'main') {
    return this.post<any>(`/repos/${repo}/pulls`, { title, body, head, base });
  }

  async createPRReview(repo: string, number: number, event: 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT', body?: string) {
    return this.post<any>(`/repos/${repo}/pulls/${number}/reviews`, { event, body: body || '' });
  }

  async closePR(repo: string, number: number) {
    return this.patch<any>(`/repos/${repo}/pulls/${number}`, { state: 'closed' });
  }

  // ── Issues ────────────────────────────────────────────────────────

  async listIssues(repo: string, state: string = 'open', limit: number = 15) {
    return this.get<any[]>(`/repos/${repo}/issues?state=${state}&per_page=${limit}&direction=desc`);
  }

  async getIssue(repo: string, number: number) {
    return this.get<any>(`/repos/${repo}/issues/${number}`);
  }

  async createIssue(repo: string, title: string, body?: string, labels?: string[]) {
    return this.post<any>(`/repos/${repo}/issues`, { title, body, labels });
  }

  async closeIssue(repo: string, number: number) {
    return this.patch<any>(`/repos/${repo}/issues/${number}`, { state: 'closed', state_reason: 'completed' });
  }

  // ── Repository ────────────────────────────────────────────────────

  async getRepo(repo: string) {
    return this.get<any>(`/repos/${repo}`);
  }

  async listBranches(repo: string, limit: number = 30) {
    return this.get<any[]>(`/repos/${repo}/branches?per_page=${limit}`);
  }

  async listReleases(repo: string, limit: number = 10) {
    return this.get<any[]>(`/repos/${repo}/releases?per_page=${limit}`);
  }

  async listWorkflowRuns(repo: string, limit: number = 10) {
    return this.get<{ total_count: number; workflow_runs: any[] }>(`/repos/${repo}/actions/runs?per_page=${limit}`);
  }

  // ── Search ───────────────────────────────────────────────────────

  async searchIssues(query: string, limit: number = 15) {
    return this.get<{ total_count: number; items: any[] }>(`/search/issues?q=${encodeURIComponent(query)}&per_page=${limit}`);
  }

  async searchRepos(query: string, limit: number = 15) {
    return this.get<{ total_count: number; items: any[] }>(`/search/repositories?q=${encodeURIComponent(query)}&per_page=${limit}`);
  }

  async searchCode(query: string, limit: number = 15) {
    return this.get<{ total_count: number; items: any[] }>(`/search/code?q=${encodeURIComponent(query)}&per_page=${limit}`);
  }

  // ── Labels ───────────────────────────────────────────────────────

  async listLabels(repo: string) {
    return this.get<any[]>(`/repos/${repo}/labels?per_page=100`);
  }

  async addLabels(repo: string, issueNumber: number, labels: string[]) {
    return this.post<any[]>(`/repos/${repo}/issues/${issueNumber}/labels`, { labels });
  }

  async removeLabel(repo: string, issueNumber: number, label: string) {
    return this.del(`/repos/${repo}/issues/${issueNumber}/labels/${encodeURIComponent(label)}`);
  }

  // ── Assignees ────────────────────────────────────────────────────

  async addAssignees(repo: string, issueNumber: number, assignees: string[]) {
    return this.post<any>(`/repos/${repo}/issues/${issueNumber}/assignees`, { assignees });
  }

  async removeAssignees(repo: string, issueNumber: number, assignees: string[]) {
    return this.del<any>(`/repos/${repo}/issues/${issueNumber}/assignees`, { assignees });
  }

  // ── File Content ─────────────────────────────────────────────────

  async getFileContent(repo: string, filePath: string, ref?: string) {
    const qs = ref ? `?ref=${encodeURIComponent(ref)}` : '';
    return this.get<any>(`/repos/${repo}/contents/${filePath}${qs}`);
  }

  // ── Commits ──────────────────────────────────────────────────────

  async listCommits(repo: string, sha?: string, filePath?: string, limit: number = 15) {
    const params = new URLSearchParams({ per_page: String(limit) });
    if (sha) params.set('sha', sha);
    if (filePath) params.set('path', filePath);
    return this.get<any[]>(`/repos/${repo}/commits?${params}`);
  }

  async compareCommits(repo: string, base: string, head: string) {
    return this.get<any>(`/repos/${repo}/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}`);
  }

  // ── Update Issue / PR ────────────────────────────────────────────

  async updateIssue(repo: string, number: number, data: { title?: string; body?: string; state?: string; labels?: string[]; assignees?: string[] }) {
    return this.patch<any>(`/repos/${repo}/issues/${number}`, data);
  }

  async updatePR(repo: string, number: number, data: { title?: string; body?: string; state?: string; base?: string }) {
    return this.patch<any>(`/repos/${repo}/pulls/${number}`, data);
  }

  // ── Star ─────────────────────────────────────────────────────────

  async starRepo(repo: string) {
    return this.put(`/user/starred/${repo}`);
  }

  async unstarRepo(repo: string) {
    return this.del(`/user/starred/${repo}`);
  }

  async isStarred(repo: string): Promise<boolean> {
    const r = await this.request('GET', `/user/starred/${repo}`);
    return r.ok;
  }

  // ── Fork ─────────────────────────────────────────────────────────

  async forkRepo(repo: string) {
    return this.post(`/repos/${repo}/forks`);
  }

  // ── GitHub App JWT + Installation Token ──────────────────────────

  /** 解析私钥：PEM字符串 或 文件路径 */
  private resolvePrivateKey(): string {
    if (this._resolvedKey) return this._resolvedKey;
    if (!this._appAuth) throw new Error('未配置 App 认证');
    let key = this._appAuth.privateKey;
    if (!key.includes('-----BEGIN')) {
      // 当作文件路径读取
      key = fs.readFileSync(key, 'utf-8');
    }
    this._resolvedKey = key;
    return key;
  }

  /** 生成 GitHub App JWT（有效期 10 分钟） */
  static createJWT(appId: string | number, privateKey: string): string {
    const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
    const now = Math.floor(Date.now() / 1000);
    const payload = Buffer.from(JSON.stringify({
      iat: now - 60,
      exp: now + 600,
      iss: String(appId),
    })).toString('base64url');
    const signature = crypto
      .sign('sha256', Buffer.from(`${header}.${payload}`), privateKey)
      .toString('base64url');
    return `${header}.${payload}.${signature}`;
  }

  /** 使用 JWT 获取指定 Installation 的 Access Token（有效期 1 小时） */
  async refreshInstallationToken(installationId: number): Promise<void> {
    if (!this._appAuth) throw new Error('未配置 App 认证');
    const key = this.resolvePrivateKey();
    const jwt = GhClient.createJWT(this._appAuth.appId, key);
    const baseUrl = this.host
      ? `https://${this.host}/api/v3`
      : 'https://api.github.com';
    const res = await fetch(
      `${baseUrl}/app/installations/${installationId}/access_tokens`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${jwt}`,
          Accept: 'application/vnd.github+json',
        },
      },
    );
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Installation Token 获取失败 (${res.status}): ${body}`);
    }
    const data = (await res.json()) as { token: string; expires_at: string };
    this.token = data.token;
    this._installationTokens.set(installationId, {
      token: data.token,
      expiresAt: new Date(data.expires_at).getTime(),
    });
  }

  /** 发现所有 App 安装及其可访问的仓库 */
  async syncInstallations(): Promise<void> {
    if (!this._appAuth) return;
    const key = this.resolvePrivateKey();
    const jwt = GhClient.createJWT(this._appAuth.appId, key);
    const baseUrl = this.host ? `https://${this.host}/api/v3` : 'https://api.github.com';
    const listRes = await fetch(`${baseUrl}/app/installations`, {
      headers: { Authorization: `Bearer ${jwt}`, Accept: 'application/vnd.github+json' },
    });
    if (!listRes.ok) {
      const errBody = await listRes.text();
      throw new Error(`列出安装失败: ${listRes.status} - ${errBody}`);
    }
    const installations = (await listRes.json()) as Array<{
      id: number; account: { login: string; type: string }; target_type: string;
    }>;
    this._allInstallations = installations;
    this._repoToInstallation.clear();
    for (const inst of installations) {
      try {
        await this.refreshInstallationToken(inst.id);
        const cached = this._installationTokens.get(inst.id);
        if (!cached) continue;
        const repoRes = await fetch(`${baseUrl}/installation/repositories?per_page=100`, {
          headers: { Authorization: `Bearer ${cached.token}`, Accept: 'application/vnd.github+json' },
        });
        if (repoRes.ok) {
          const data = (await repoRes.json()) as { repositories: Array<{ full_name: string }> };
          for (const repo of data.repositories) {
            this._repoToInstallation.set(repo.full_name.toLowerCase(), inst.id);
          }
        }
      } catch {
        // 单个安装失败不影响其他
      }
    }
    this._lastSyncTime = Date.now();
  }

  /** 当前是否使用 App 认证 */
  get isAppAuth(): boolean { return !!this._appAuth; }

  /** 所有已发现的安装 */
  get installations() { return this._allInstallations; }

  /** App 的 slug（verifyAuth 后可用） */
  private _appSlug: string | null = null;
  get appSlug(): string | null { return this._appSlug; }

  /** App 的 client_id（verifyAuth 后从 /app 获取，用于 Device Flow） */
  private _clientId: string | null = null;
  get clientId(): string | null { return this._clientId; }

  // ── 事件轮询 ─────────────────────────────────────────────────────

  /**
   * 获取仓库事件（支持 ETag 条件请求）
   * @returns events 数组 + 新 etag；若 304 未修改则 events 为空
   */
  async listRepoEvents(
    repo: string,
    etag?: string,
  ): Promise<{ events: any[]; etag: string | null }> {
    await this.ensureTokenForRepo(repo);
    const args = ['api', `/repos/${repo}/events?per_page=30`, '--method', 'GET', '--include'];
    if (etag) args.push('-H', `If-None-Match: ${etag}`);
    try {
      const raw = await this.exec(args);
      // --include 输出包含 HTTP 头 + 空行 + body
      const sepIdx = raw.indexOf('\r\n\r\n');
      const headerPart = sepIdx >= 0 ? raw.slice(0, sepIdx) : '';
      const bodyPart = sepIdx >= 0 ? raw.slice(sepIdx + 4) : raw;
      const newEtag = headerPart.match(/etag:\s*"?([^"\r\n]+)"?/i)?.[1] || null;
      let events: any[];
      try { events = JSON.parse(bodyPart); } catch { events = []; }
      return { events: Array.isArray(events) ? events : [], etag: newEtag };
    } catch (err: any) {
      // 304 Not Modified — gh 会以非 0 退出码返回
      if (err.stderr?.includes('304') || err.exitCode === 1) {
        return { events: [], etag: etag || null };
      }
      throw err;
    }
  }

  // ── Device Flow OAuth（多用户绑定） ──────────────────────────────

  /**
   * 第一步：请求设备码
   * GitHub App 不需要 scope 参数（权限由 App 设置决定），OAuth App 可传 scope。
   * 注意：Device Flow 端点在 github.com（而非 api.github.com），需确保网络可达。
   * @returns device_code, user_code, verification_uri, expires_in, interval
   */
  static async deviceFlowRequestCode(clientId: string, host?: string): Promise<{
    device_code: string;
    user_code: string;
    verification_uri: string;
    expires_in: number;
    interval: number;
  }> {
    const baseUrl = host ? `https://${host}` : 'https://github.com';
    const url = `${baseUrl}/login/device/code`;
    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify({ client_id: clientId }),
        signal: AbortSignal.timeout(15_000),
      });
    } catch (e: any) {
      throw new Error(
        `Device Flow 请求失败: 无法连接 ${baseUrl} (${e.cause?.code || e.message})。` +
        `Device Flow 需要访问 github.com（非 api.github.com），请检查网络/代理设置。`,
      );
    }
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      const hint = res.status === 400
        ? ' (请确认 GitHub App 已启用 Device Flow: Settings → Developer settings → GitHub Apps → General)'
        : '';
      throw new Error(`Device Flow 请求失败: ${res.status}${body ? ' — ' + body : ''}${hint}`);
    }
    return res.json();
  }

  /**
   * 第二步：轮询等待用户授权
   * @returns access_token 或 null（超时/拒绝）
   */
  static async deviceFlowPollToken(
    clientId: string,
    deviceCode: string,
    interval: number = 5,
    expiresIn: number = 900,
    host?: string,
  ): Promise<{ access_token: string; token_type: string; scope: string } | null> {
    const baseUrl = host ? `https://${host}` : 'https://github.com';
    const deadline = Date.now() + expiresIn * 1000;
    let pollInterval = interval * 1000;

    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, pollInterval));
      const res = await fetch(`${baseUrl}/login/oauth/access_token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify({
          client_id: clientId,
          device_code: deviceCode,
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        }),
      });
      const data = await res.json() as Record<string, any>;
      if (data.access_token) {
        return { access_token: data.access_token, token_type: data.token_type, scope: data.scope };
      }
      if (data.error === 'slow_down') {
        pollInterval = (data.interval || interval + 5) * 1000;
        continue;
      }
      if (data.error === 'authorization_pending') continue;
      // expired_token / access_denied / 其他错误
      return null;
    }
    return null;
  }
}
