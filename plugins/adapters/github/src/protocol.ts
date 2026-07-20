/**
 * GitHub webhook / comment helpers — no legacy Adapter/Endpoint / segment-mapper.
 * Canonicalization is owned by gateway/core before endpoint.send.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { pickCredential } from '@zhin.js/adapter';
import {
  buildChannelId,
  type GenericWebhookPayload,
  type IssueCommentPayload,
  type PRReviewCommentPayload,
  type PRReviewPayload,
} from './types.js';

export type {
  EventType,
  GenericWebhookPayload,
  GitHubComment,
  GitHubEndpointConfig,
  GitHubIssue,
  GitHubOAuthUser,
  GitHubPR,
  GitHubRepo,
  GitHubUser,
  IssueCommentPayload,
  ParsedChannel,
  PRReviewCommentPayload,
  PRReviewPayload,
  Subscription,
} from './types.js';

export { buildChannelId, parseChannelId } from './types.js';

/** Plugin Runtime owner config (`plugins.<instanceKey>` / schema.json). */
export interface GithubAdapterConfig {
  readonly name?: string;
  readonly host?: string;
  readonly app_id?: string | number;
  readonly appId?: string | number;
  readonly private_key?: string;
  readonly privateKey?: string;
  readonly webhook_secret?: string;
  readonly webhookSecret?: string;
  readonly webhook_path?: string;
  readonly webhookPath?: string;
  readonly poll_interval?: number;
  readonly pollInterval?: number;
  readonly auto_reply_repos?: readonly string[];
  readonly autoReplyRepos?: readonly string[];
  readonly bot_login?: string;
  readonly botLogin?: string;
  readonly workspace_root?: string;
  readonly workspaceRoot?: string;
  /** Transitional: legacy root `endpoints[]` with `context: github`. */
  readonly endpoints?: ReadonlyArray<Partial<ResolvedGithubConfig> & {
    readonly context?: string;
    readonly app_id?: string | number;
    readonly private_key?: string;
    readonly webhook_secret?: string;
    readonly webhook_path?: string;
    readonly poll_interval?: number;
    readonly auto_reply_repos?: readonly string[];
    readonly bot_login?: string;
    readonly workspace_root?: string;
  }>;
}

export interface ResolvedGithubConfig {
  readonly context: 'github';
  readonly name: string;
  readonly host?: string;
  readonly appId?: string | number;
  readonly privateKey?: string;
  readonly webhookSecret?: string;
  readonly webhookPath: string;
  readonly pollInterval: number;
  readonly autoReplyRepos: readonly string[];
  readonly botLogin?: string;
  readonly workspaceRoot?: string;
}

export interface GithubWireSegment {
  readonly type: string;
  readonly data?: Record<string, unknown>;
}

export interface GithubInboundComment {
  readonly id: string;
  readonly channelId: string;
  readonly sender: string;
  readonly content: string;
  readonly repo: string;
  readonly kind: 'issue_comment' | 'pr_review_comment' | 'pr_review';
  readonly createdAt: number;
}

export function resolveGithubConfig(config: GithubAdapterConfig = {}): ResolvedGithubConfig {
  const entry = config.endpoints?.find((item) => item.context === 'github');
  const appIdRaw = pickCredential(
    config.appId != null ? String(config.appId) : undefined,
    config.app_id != null ? String(config.app_id) : undefined,
    entry?.appId != null ? String(entry.appId) : undefined,
    entry?.app_id != null ? String(entry.app_id) : undefined,
    process.env.GITHUB_APP_ID,
  );
  const appId = appIdRaw ? (Number(appIdRaw) || appIdRaw) : undefined;
  const privateKey = pickCredential(
    config.privateKey,
    config.private_key,
    entry?.privateKey,
    entry?.private_key,
  ) || undefined;
  if (!appId || !privateKey) {
    throw new TypeError(
      'GitHub adapter requires app_id + private_key (plugins.<key> or GITHUB_APP_ID)',
    );
  }
  const name = (typeof config.name === 'string' && config.name)
    || (typeof entry?.name === 'string' && entry.name)
    || process.env.GITHUB_BOT_NAME
    || 'github-bot';
  const webhookSecret = config.webhookSecret ?? config.webhook_secret
    ?? entry?.webhookSecret ?? entry?.webhook_secret
    ?? process.env.GITHUB_WEBHOOK_SECRET
    ?? undefined;
  const host = config.host ?? entry?.host;
  const webhookPath = normalizeWebhookPath(
    config.webhookPath ?? config.webhook_path ?? entry?.webhookPath ?? entry?.webhook_path
    ?? '/github/webhook',
  );
  const pollInterval = Number(
    config.pollInterval ?? config.poll_interval ?? entry?.pollInterval ?? entry?.poll_interval ?? 60,
  ) || 60;
  const autoReplyRepos = [
    ...(config.autoReplyRepos ?? config.auto_reply_repos
      ?? entry?.autoReplyRepos ?? entry?.auto_reply_repos ?? []),
  ];
  const botLogin = config.botLogin ?? config.bot_login ?? entry?.botLogin ?? entry?.bot_login;
  const workspaceRoot = config.workspaceRoot ?? config.workspace_root
    ?? entry?.workspaceRoot ?? entry?.workspace_root;

  return {
    context: 'github',
    name,
    ...(host ? { host } : {}),
    ...(appId != null ? { appId } : {}),
    ...(privateKey ? { privateKey } : {}),
    ...(webhookSecret ? { webhookSecret } : {}),
    webhookPath,
    pollInterval,
    autoReplyRepos,
    ...(botLogin ? { botLogin } : {}),
    ...(workspaceRoot ? { workspaceRoot } : {}),
  };
}

export function normalizeWebhookPath(path: string): string {
  const trimmed = path.trim() || '/github/webhook';
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

export function shouldAutoReplyRepo(
  config: Pick<ResolvedGithubConfig, 'autoReplyRepos'>,
  repo: string,
): boolean {
  const list = config.autoReplyRepos;
  if (!list.length) return false;
  const key = repo.toLowerCase();
  return list.some((r) => r.toLowerCase() === key);
}

/** Prepend synthetic @bot for auto_reply repos (gateway text path). */
export function enrichInboundContent(
  content: string,
  config: Pick<ResolvedGithubConfig, 'autoReplyRepos' | 'botLogin'>,
  botLogin: string | undefined,
  repo: string,
): string {
  const login = config.botLogin || botLogin;
  if (!login || !shouldAutoReplyRepo(config, repo)) return content;
  if (content.includes(`@${login}`)) return content;
  return `@${login} ${content}`;
}

/** Build inbound text for MessageGateway.receive from markdown/comment body. */
export function formatInboundContent(body: string): string {
  return body;
}

/** Build markdown body for Issue/PR comment send. */
export function formatOutboundBody(payload: unknown): string {
  if (typeof payload === 'string') return payload;
  if (payload == null) return '';
  if (!Array.isArray(payload)) {
    if (typeof payload === 'object' && payload !== null && 'text' in payload) {
      return String((payload as { text?: unknown }).text ?? '');
    }
    return String(payload);
  }
  return payload.map((seg) => {
    if (typeof seg === 'string') return seg;
    const item = seg as GithubWireSegment;
    switch (item.type) {
      case 'text':
        return String(item.data?.text ?? '');
      case 'mention':
      case 'at':
        return `@${item.data?.name || item.data?.id || item.data?.target || ''}`;
      case 'image':
        return item.data?.url ? `![image](${item.data.url})` : '[image]';
      case 'link':
        return `[${item.data?.text || item.data?.url || ''}](${item.data?.url || ''})`;
      default:
        return String(item.data?.text ?? `[${item.type}]`);
    }
  }).join('');
}

export function verifyWebhookSignature(
  secret: string,
  rawBody: string,
  signatureHeader: string | undefined,
): boolean {
  if (!signatureHeader?.startsWith('sha256=')) return false;
  const expected = `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`;
  try {
    const a = Buffer.from(signatureHeader);
    const b = Buffer.from(expected);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export function headerValue(
  headers: IncomingMessage['headers'],
  name: string,
): string {
  const raw = headers[name] ?? headers[name.toLowerCase()];
  if (Array.isArray(raw)) return raw[0] ?? '';
  return raw ?? '';
}

export async function readTextBody(
  request: IncomingMessage,
  options: { readonly limit?: number } = {},
): Promise<string> {
  const limit = options.limit ?? 1_048_576;
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > limit) {
      request.destroy();
      throw new Error(`Request body exceeds ${limit} bytes`);
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export function parseIssueCommentInbound(payload: IssueCommentPayload): GithubInboundComment | null {
  if (payload.action !== 'created' || !payload.comment) return null;
  const repo = payload.repository.full_name;
  const isPR = 'pull_request' in (payload.issue as object);
  return {
    id: String(payload.comment.id),
    channelId: buildChannelId(repo, isPR ? 'pr' : 'issue', payload.issue.number),
    sender: payload.sender.login,
    content: payload.comment.body,
    repo,
    kind: 'issue_comment',
    createdAt: new Date(payload.comment.created_at).getTime(),
  };
}

export function parsePrReviewCommentInbound(payload: PRReviewCommentPayload): GithubInboundComment | null {
  if (payload.action !== 'created' || !payload.comment) return null;
  const repo = payload.repository.full_name;
  const body = payload.comment.path
    ? `**${payload.comment.path}**\n${payload.comment.diff_hunk ? `\`\`\`diff\n${payload.comment.diff_hunk}\n\`\`\`\n` : ''}${payload.comment.body}`
    : payload.comment.body;
  return {
    id: String(payload.comment.id),
    channelId: buildChannelId(repo, 'pr', payload.pull_request.number),
    sender: payload.sender.login,
    content: body,
    repo,
    kind: 'pr_review_comment',
    createdAt: new Date(payload.comment.created_at).getTime(),
  };
}

export function parsePrReviewInbound(payload: PRReviewPayload): GithubInboundComment | null {
  if (payload.action !== 'submitted' || !payload.review.body) return null;
  const repo = payload.repository.full_name;
  const stateLabel: Record<string, string> = {
    approved: '✅ APPROVED',
    changes_requested: '🔄 CHANGES REQUESTED',
    commented: '💬 COMMENTED',
    dismissed: '❌ DISMISSED',
  };
  const body = `**[${stateLabel[payload.review.state] || payload.review.state}]**\n${payload.review.body}`;
  return {
    id: String(payload.review.id),
    channelId: buildChannelId(repo, 'pr', payload.pull_request.number),
    sender: payload.sender.login,
    content: body,
    repo,
    kind: 'pr_review',
    createdAt: new Date(payload.review.submitted_at).getTime(),
  };
}

export function formatNotification(event: string, p: GenericWebhookPayload): string {
  const repo = p.repository.full_name;
  const sender = p.sender.login;
  const repoUrl = p.repository.html_url;
  switch (event) {
    case 'push': {
      const branch = p.ref?.replace('refs/heads/', '') || '?';
      const commits = p.commits || [];
      const compareUrl = commits.length >= 2
        ? `${repoUrl}/compare/${commits[0].id.substring(0, 12)}...${commits[commits.length - 1].id.substring(0, 12)}`
        : commits.length === 1 ? `${repoUrl}/commit/${commits[0].id}` : '';
      let msg = `📦 ${repo}\n🌿 ${sender} pushed ${commits.length} commit(s) to \`${branch}\`\n`;
      if (commits.length) {
        msg += '\n';
        msg += commits.slice(0, 5).map((c) =>
          `  • [\`${c.id.substring(0, 7)}\`](${repoUrl}/commit/${c.id}) ${c.message.split('\n')[0]}`,
        ).join('\n');
        if (commits.length > 5) msg += `\n  ... +${commits.length - 5} more`;
      }
      if (compareUrl) msg += `\n\n🔗 ${compareUrl}`;
      return msg;
    }
    case 'issues': {
      const i = p.issue!;
      const act = p.action === 'opened' ? '📝 opened' : p.action === 'closed' ? '✅ closed' : `🔄 ${p.action || 'updated'}`;
      return `🐛 ${repo}\n👤 ${sender} ${act} issue #${i.number}\n📌 ${i.title}\n🔗 ${i.html_url}`;
    }
    case 'star': {
      const starred = p.action !== 'deleted';
      return `${starred ? '⭐' : '💔'} ${repo}\n👤 ${sender} ${starred ? 'starred' : 'unstarred'}\n🔗 ${repoUrl}`;
    }
    case 'fork':
      return `🍴 ${repo}\n👤 ${sender} forked → ${p.forkee!.full_name}\n🔗 ${p.forkee!.html_url}`;
    case 'pull_request': {
      const pr = p.pull_request!;
      const act = p.action === 'opened' ? '📝 opened'
        : p.action === 'closed' ? (pr.state === 'closed' ? '❌ closed' : '✅ merged')
        : `🔄 ${p.action || 'updated'}`;
      return `🔀 ${repo}\n👤 ${sender} ${act} PR #${pr.number}\n📌 ${pr.title}\n🌿 ${pr.head.ref} → ${pr.base.ref}\n🔗 ${pr.html_url}`;
    }
    default:
      return `📬 ${repo}\n📡 ${event}${p.action ? ` (${p.action})` : ''} by ${sender}\n🔗 ${repoUrl}`;
  }
}

/** Parse @mentions in markdown into a flat display string (gateway text path). */
export function parseMarkdownMentions(md: string): string {
  return md;
}
