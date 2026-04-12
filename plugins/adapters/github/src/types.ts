// ── Bot 配置 ─────────────────────────────────────────────────────────
//  基于 gh CLI 认证：需要系统已安装并认证 gh CLI
//  认证方式：gh auth login

export interface GitHubBotConfig {
  context: 'github';
  /** Bot 标识名称 */
  name: string;
  /** GitHub Enterprise 主机名（默认 github.com） */
  host?: string;
  /** GitHub App ID */
  app_id?: string | number;
  /** GitHub App 私钥（PEM 内容或文件路径） */
  private_key?: string;
  /** Webhook Secret（配置后启用 Webhook 接收事件，不配置则使用轮询） */
  webhook_secret?: string;
  /** Webhook 路由路径（默认 /github/webhook） */
  webhook_path?: string;
  /** 事件轮询间隔（秒，默认 60，Webhook 模式下作为降级备选） */
  poll_interval?: number;
}

// ── Channel ID ───────────────────────────────────────────────────────
//  格式: {owner}/{repo}/issues/{number} 或 {owner}/{repo}/pull/{number}

export interface ParsedChannel {
  repo: string;
  type: 'issue' | 'pr';
  number: number;
}

export function parseChannelId(channelId: string): ParsedChannel | null {
  const issueMatch = channelId.match(/^(.+?\/.+?)\/issues\/(\d+)$/);
  if (issueMatch) return { repo: issueMatch[1], type: 'issue', number: parseInt(issueMatch[2]) };
  const prMatch = channelId.match(/^(.+?\/.+?)\/pull\/(\d+)$/);
  if (prMatch) return { repo: prMatch[1], type: 'pr', number: parseInt(prMatch[2]) };
  return null;
}

export function buildChannelId(repo: string, type: 'issue' | 'pr', number: number): string {
  return type === 'issue' ? `${repo}/issues/${number}` : `${repo}/pull/${number}`;
}

// ── Webhook Payloads ─────────────────────────────────────────────────

export interface GitHubUser {
  login: string;
  id: number;
  html_url: string;
}

export interface GitHubComment {
  id: number;
  body: string;
  user: GitHubUser;
  created_at: string;
  updated_at: string;
  html_url: string;
}

export interface GitHubRepo {
  full_name: string;
  html_url: string;
  description?: string;
}

export interface GitHubIssue {
  number: number;
  title: string;
  html_url: string;
  state: string;
  user: GitHubUser;
}

export interface GitHubPR {
  number: number;
  title: string;
  html_url: string;
  state: string;
  user: GitHubUser;
  head: { ref: string };
  base: { ref: string };
}

export interface IssueCommentPayload {
  action: 'created' | 'edited' | 'deleted';
  comment: GitHubComment;
  issue: GitHubIssue;
  repository: GitHubRepo;
  sender: GitHubUser;
}

export interface PRReviewCommentPayload {
  action: 'created' | 'edited' | 'deleted';
  comment: GitHubComment & { diff_hunk?: string; path?: string };
  pull_request: GitHubPR;
  repository: GitHubRepo;
  sender: GitHubUser;
}

export interface PRReviewPayload {
  action: 'submitted' | 'edited' | 'dismissed';
  review: {
    id: number;
    body: string | null;
    state: 'approved' | 'changes_requested' | 'commented' | 'dismissed';
    user: GitHubUser;
    html_url: string;
    submitted_at: string;
  };
  pull_request: GitHubPR;
  repository: GitHubRepo;
  sender: GitHubUser;
}

export interface GenericWebhookPayload {
  action?: string;
  repository: GitHubRepo;
  sender: GitHubUser;
  ref?: string;
  commits?: Array<{ id: string; message: string; author: { name: string; username?: string }; url: string }>;
  issue?: GitHubIssue;
  pull_request?: GitHubPR;
  forkee?: { full_name: string; html_url: string; owner: { login: string } };
}

// ── Subscription ─────────────────────────────────────────────────────

export type EventType = 'push' | 'issue' | 'star' | 'fork' | 'unstar' | 'pull_request';

export interface Subscription {
  id: number;
  repo: string;
  events: EventType[];
  target_id: string;
  target_type: 'private' | 'group' | 'channel';
  adapter: string;
  bot: string;
}

// ── Tool Action Types ────────────────────────────────────────────────

export type PrAction = 'list' | 'view' | 'diff' | 'merge' | 'create' | 'review' | 'close';
export type IssueAction = 'list' | 'view' | 'create' | 'close' | 'comment';
export type RepoAction = 'info' | 'branches' | 'releases' | 'runs' | 'stars';

// ── OAuth 用户绑定 ───────────────────────────────────────────────────
//  存储各平台用户绑定的 GitHub OAuth Token（Device Flow）

export interface GitHubOAuthUser {
  id: number;
  /** 来源平台 (icqq, kook, discord …) */
  platform: string;
  /** 该平台上的用户 ID */
  platform_uid: string;
  /** GitHub 用户名 */
  github_login: string;
  /** OAuth Access Token */
  access_token: string;
  /** 绑定时间 (ms) */
  created_at: number;
}
