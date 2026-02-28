/**
 * GitHub REST API 客户端
 *
 * 两种认证方式：
 *  1. GitHub App (JWT): app_id + private_key → JWT → Installation Access Token
 *  2. OAuth User: access_token → 以用户身份调用 API
 *
 * 零外部依赖，使用 Node.js 原生 crypto + fetch
 */

import crypto from 'node:crypto';

const API_BASE = 'https://api.github.com';
const ACCEPT = 'application/vnd.github+json';
const API_VERSION = '2022-11-28';

// ── JWT ──────────────────────────────────────────────────────────────

function createAppJWT(appId: number, privateKey: string): string {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    iss: appId,
    iat: now - 60,
    exp: now + 600,
  })).toString('base64url');

  const sign = crypto.createSign('RSA-SHA256');
  sign.update(`${header}.${payload}`);
  const signature = sign.sign(privateKey, 'base64url');

  return `${header}.${payload}.${signature}`;
}

// ── API Client ───────────────────────────────────────────────────────

export class GitHubAPI {
  private installationToken: string | null = null;
  private tokenExpiresAt = 0;
  private _user: string | null = null;

  constructor(
    private appId: number,
    private privateKey: string,
    private installationId?: number,
  ) {}

  get authenticatedUser() { return this._user; }

  private async getToken(): Promise<string> {
    if (this.installationToken && Date.now() < this.tokenExpiresAt - 60_000) {
      return this.installationToken;
    }

    const jwt = createAppJWT(this.appId, this.privateKey);

    if (!this.installationId) {
      const res = await fetch(`${API_BASE}/app/installations`, {
        headers: { Authorization: `Bearer ${jwt}`, Accept: ACCEPT, 'X-GitHub-Api-Version': API_VERSION },
      });
      if (!res.ok) throw new Error(`获取 installations 失败: ${res.status} ${await res.text()}`);
      const installations = await res.json() as any[];
      if (!installations.length) throw new Error('此 GitHub App 没有任何 installation');
      this.installationId = installations[0].id;
    }

    const res = await fetch(`${API_BASE}/app/installations/${this.installationId}/access_tokens`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${jwt}`, Accept: ACCEPT, 'X-GitHub-Api-Version': API_VERSION },
    });
    if (!res.ok) throw new Error(`获取 installation token 失败: ${res.status} ${await res.text()}`);
    const data = await res.json() as { token: string; expires_at: string };
    this.installationToken = data.token;
    this.tokenExpiresAt = new Date(data.expires_at).getTime();
    return this.installationToken;
  }

  async request<T = any>(method: string, path: string, body?: any): Promise<{ ok: boolean; status: number; data: T }> {
    const token = await this.getToken();
    const url = path.startsWith('http') ? path : `${API_BASE}${path}`;
    const res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: ACCEPT,
        'X-GitHub-Api-Version': API_VERSION,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let data: any;
    try { data = JSON.parse(text); } catch { data = text; }
    return { ok: res.ok, status: res.status, data };
  }

  private async get<T = any>(path: string) { return this.request<T>('GET', path); }
  private async post<T = any>(path: string, body?: any) { return this.request<T>('POST', path, body); }
  private async patch<T = any>(path: string, body?: any) { return this.request<T>('PATCH', path, body); }
  private async put<T = any>(path: string, body?: any) { return this.request<T>('PUT', path, body); }
  private async del<T = any>(path: string) { return this.request<T>('DELETE', path); }

  // ── 连接验证 ──────────────────────────────────────────────────────

  async verifyAuth(): Promise<{ ok: boolean; user: string; message: string }> {
    try {
      await this.getToken();
      const jwt = createAppJWT(this.appId, this.privateKey);
      const res = await fetch(`${API_BASE}/app`, {
        headers: { Authorization: `Bearer ${jwt}`, Accept: ACCEPT, 'X-GitHub-Api-Version': API_VERSION },
      });
      if (!res.ok) return { ok: false, user: '', message: `App 认证失败: ${res.status}` };
      const app = await res.json() as { name: string; slug: string };
      this._user = `${app.slug}[bot]`;
      return { ok: true, user: this._user, message: `GitHub App: ${app.name}` };
    } catch (e: any) {
      return { ok: false, user: '', message: e.message };
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
    const token = await this.getToken();
    const res = await fetch(`${API_BASE}/repos/${repo}/pulls/${number}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github.diff',
        'X-GitHub-Api-Version': API_VERSION,
      },
    });
    return { ok: res.ok, data: await res.text() };
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
}

// ── OAuth Token Exchange ─────────────────────────────────────────────

export async function exchangeOAuthCode(
  clientId: string,
  clientSecret: string,
  code: string,
): Promise<{ access_token: string; scope: string; token_type: string }> {
  const res = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code }),
  });
  if (!res.ok) throw new Error(`OAuth token exchange failed: ${res.status}`);
  const data = await res.json() as any;
  if (data.error) throw new Error(`OAuth error: ${data.error_description || data.error}`);
  return data;
}

// ── OAuth User API Client ────────────────────────────────────────────

type ApiResult<T = any> = { ok: boolean; status: number; data: T };

export class GitHubOAuthClient {
  constructor(private accessToken: string) {}

  async request<T = any>(method: string, path: string, body?: any): Promise<ApiResult<T>> {
    const url = path.startsWith('http') ? path : `${API_BASE}${path}`;
    const res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        Accept: ACCEPT,
        'X-GitHub-Api-Version': API_VERSION,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let data: any;
    try { data = JSON.parse(text); } catch { data = text; }
    return { ok: res.ok, status: res.status, data };
  }

  async getUser(): Promise<ApiResult<{ login: string; id: number; name: string | null; avatar_url: string }>> {
    return this.request('GET', '/user');
  }

  async starRepo(repo: string): Promise<ApiResult> {
    return this.request('PUT', `/user/starred/${repo}`);
  }

  async unstarRepo(repo: string): Promise<ApiResult> {
    return this.request('DELETE', `/user/starred/${repo}`);
  }

  async isStarred(repo: string): Promise<boolean> {
    const res = await this.request('GET', `/user/starred/${repo}`);
    return res.status === 204;
  }

  async forkRepo(repo: string): Promise<ApiResult> {
    return this.request('POST', `/repos/${repo}/forks`);
  }

  async createIssue(repo: string, title: string, body?: string, labels?: string[]): Promise<ApiResult> {
    return this.request('POST', `/repos/${repo}/issues`, { title, body, labels });
  }

  async createPR(repo: string, title: string, body: string, head: string, base: string = 'main'): Promise<ApiResult> {
    return this.request('POST', `/repos/${repo}/pulls`, { title, body, head, base });
  }
}
