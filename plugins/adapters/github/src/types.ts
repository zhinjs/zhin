// ── Bot 配置 ─────────────────────────────────────────────────────────
//  GitHub App 认证: app_id + private_key → JWT → Installation Token
//  OAuth 用户授权: client_id + client_secret → 用户绑定 GitHub 账号

export interface GitHubBotConfig {
  context: 'github';
  /** Bot 标识名称 */
  name: string;
  /** GitHub App ID */
  app_id: number;
  /** GitHub App 私钥 PEM 内容或文件路径 */
  private_key: string;
  /** Installation ID (不填则自动获取第一个) */
  installation_id?: number;
  /** Webhook 签名密钥 */
  webhook_secret?: string;
  /** GitHub App OAuth: Client ID (在 App 设置页获取) */
  client_id?: string;
  /** GitHub App OAuth: Client Secret */
  client_secret?: string;
}

// ── OAuth 用户绑定 ───────────────────────────────────────────────────

export interface GitHubOAuthUser {
  id: number;
  /** 聊天平台名称 (icqq / kook / discord ...) */
  platform: string;
  /** 聊天平台用户 ID */
  platform_uid: string;
  /** GitHub 用户名 */
  github_login: string;
  /** GitHub 用户 ID */
  github_id: number;
  /** OAuth access_token */
  access_token: string;
  /** 授权范围 */
  scope: string;
  created_at: Date;
  updated_at: Date;
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
