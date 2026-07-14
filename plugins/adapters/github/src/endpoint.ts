/**
 * GitHub Endpoint 实现（基于 gh CLI）
 */
import { formatCompact, Endpoint, Message, segment, SendContent, SendOptions, type MessageSegment,
  coerceQrcodeSegmentsToText,
  expandInteractiveSegmentsInContent,
} from 'zhin.js';
import { buildChannelId, parseChannelId, type GitHubEndpointConfig, type IssueCommentPayload, type PRReviewCommentPayload, type PRReviewPayload } from './types.js';

import type { GitHubAdapter } from './adapter.js';
import { GhClient } from './gh-client.js';
import { fromCanonicalSegments, toCanonicalSegments } from './segment-mapper.js';

/** GitHub @mention：支持 zhin-ai[bot] 等 App bot 用户名 */
const GITHUB_MENTION_RE = /@([^\s@]+(?:\[bot\])?)/g;

export function parseMarkdown(md: string): MessageSegment[] {
  const segments: MessageSegment[] = [];
  let lastIdx = 0;
  let match: RegExpExecArray | null;
  while ((match = GITHUB_MENTION_RE.exec(md)) !== null) {
    if (match.index > lastIdx) segments.push({ type: 'text', data: { text: md.slice(lastIdx, match.index) } });
    segments.push({ type: 'at', data: { id: match[1], name: match[1], text: match[0] } });
    lastIdx = match.index + match[0].length;
  }
  if (lastIdx < md.length) segments.push({ type: 'text', data: { text: md.slice(lastIdx) } });
  return segments.length ? segments : [{ type: 'text', data: { text: md } }];
}

export function shouldAutoReplyRepo(config: GitHubEndpointConfig, repo: string): boolean {
  const list = config.auto_reply_repos;
  if (!list?.length) return false;
  const key = repo.toLowerCase();
  return list.some((r) => r.toLowerCase() === key);
}

export function enrichGithubInboundMessage<T extends object>(
  message: Message<T>,
  config: GitHubEndpointConfig,
  gh: GhClient,
  repo: string,
): Message<T> {
  const botLogin = config.bot_login || gh.getBotLogin();
  if (botLogin && shouldAutoReplyRepo(config, repo)) {
    const hasBotAt = message.$content.some(
      (seg) => (seg.type === 'at' || seg.type === 'mention') && seg.data?.id === botLogin,
    );
    if (!hasBotAt) {
      message.$content = [
        { type: 'at', data: { id: botLogin, name: botLogin, text: `@${botLogin}` } },
        ...message.$content,
      ];
    }
  }
  return message;
}

export function toMarkdown(content: SendContent): string {
  if (!Array.isArray(content)) content = [content];
  return content.map(seg => {
    if (typeof seg === 'string') return seg;
    switch (seg.type) {
      case 'text': return seg.data.text || '';
      case 'mention': return `@${seg.data.name || seg.data.target}`;
      case 'at': return `@${seg.data.name || seg.data.id}`;
      case 'image': return seg.data.url ? `![image](${seg.data.url})` : '[image]';
      case 'link': return `[${seg.data.text || seg.data.url}](${seg.data.url})`;
      default: return seg.data?.text || `[${seg.type}]`;
    }
  }).join('');
}

export class GitHubEndpoint implements Endpoint<GitHubEndpointConfig, IssueCommentPayload> {
  $connected = false;
  gh: GhClient;
  /** App bot 登录名，供 @ 触发匹配 */
  $platformUserId?: string;

  get $id() { return this.$config.name; }

  get logger() {
    return this.adapter.plugin.logger;
  }

  constructor(public adapter: GitHubAdapter, public $config: GitHubEndpointConfig) {
    const { host, app_id, private_key } = $config;
    const appAuth = app_id && private_key
      ? { appId: app_id, privateKey: private_key }
      : undefined;
    this.gh = new GhClient({ host, appAuth });
  }

  async $connect(): Promise<void> {
    const result = await this.gh.verifyAuth();
    if (!result.ok) throw new Error(`GitHub 认证失败: ${result.message}`);
    this.$platformUserId = this.$config.bot_login || this.gh.getBotLogin() || undefined;
    this.$connected = true;
    this.logger.debug(formatCompact({ endpoint: this.$id, bot: this.$platformUserId }));
  }

  async $disconnect(): Promise<void> {
    this.$connected = false;
    this.logger.debug(formatCompact({ endpoint: this.$id, disconnect: true }));
  }

  $formatMessage(payload: IssueCommentPayload): Message<IssueCommentPayload> {
    const repo = payload.repository.full_name;
    const number = payload.issue.number;
    const isPR = 'pull_request' in (payload.issue as any);
    const channelId = buildChannelId(repo, isPR ? 'pr' : 'issue', number);
    const gh = this.gh;

    const result = Message.from(payload, {
      $id: payload.comment.id.toString(),
      $adapter: 'github',
      $endpoint: this.$config.name,
      $sender: { id: payload.sender.login, name: payload.sender.login },
      $channel: { id: channelId, type: 'group' },
      $content: toCanonicalSegments(parseMarkdown(payload.comment.body)),
      $raw: payload.comment.body,
      $timestamp: new Date(payload.comment.created_at).getTime(),
      $recall: async () => { await gh.deleteIssueComment(repo, payload.comment.id); },
      $reply: async (content: SendContent, quote?: boolean | string): Promise<string> => {
        const text = toMarkdown(content);
        const finalBody = quote ? `> ${payload.comment.body.split('\n')[0]}\n\n${text}` : text;
        const r = await gh.createIssueComment(repo, number, finalBody);
        return r.ok ? r.data.id.toString() : '';
      },
    });
    return result;
  }

  formatPRReviewComment(payload: PRReviewCommentPayload): Message<PRReviewCommentPayload> {
    const repo = payload.repository.full_name;
    const number = payload.pull_request.number;
    const channelId = buildChannelId(repo, 'pr', number);
    const gh = this.gh;

    const body = payload.comment.path
      ? `**${payload.comment.path}**\n${payload.comment.diff_hunk ? '```diff\n' + payload.comment.diff_hunk + '\n```\n' : ''}${payload.comment.body}`
      : payload.comment.body;

    return Message.from(payload, {
      $id: payload.comment.id.toString(),
      $adapter: 'github',
      $endpoint: this.$config.name,
      $sender: { id: payload.sender.login, name: payload.sender.login },
      $channel: { id: channelId, type: 'group' },
      $content: toCanonicalSegments(parseMarkdown(body)),
      $raw: body,
      $timestamp: new Date(payload.comment.created_at).getTime(),
      $recall: async () => { await gh.deletePRReviewComment(repo, payload.comment.id); },
      $reply: async (content: SendContent): Promise<string> => {
        const r = await gh.createPRComment(repo, number, toMarkdown(content));
        return r.ok ? r.data.id.toString() : '';
      },
    });
  }

  formatPRReview(payload: PRReviewPayload): Message<PRReviewPayload> | null {
    if (!payload.review.body) return null;
    const repo = payload.repository.full_name;
    const number = payload.pull_request.number;
    const channelId = buildChannelId(repo, 'pr', number);
    const gh = this.gh;

    const stateLabel: Record<string, string> = {
      approved: '✅ APPROVED', changes_requested: '🔄 CHANGES REQUESTED',
      commented: '💬 COMMENTED', dismissed: '❌ DISMISSED',
    };
    const body = `**[${stateLabel[payload.review.state] || payload.review.state}]**\n${payload.review.body}`;

    return Message.from(payload, {
      $id: payload.review.id.toString(),
      $adapter: 'github',
      $endpoint: this.$config.name,
      $sender: { id: payload.sender.login, name: payload.sender.login },
      $channel: { id: channelId, type: 'group' },
      $content: toCanonicalSegments(parseMarkdown(body)),
      $raw: body,
      $timestamp: new Date(payload.review.submitted_at).getTime(),
      $recall: async () => {},
      $reply: async (content: SendContent): Promise<string> => {
        const r = await gh.createPRComment(repo, number, toMarkdown(content));
        return r.ok ? r.data.id.toString() : '';
      },
    });
  }

  async $sendMessage(options: SendOptions): Promise<string> {
    const parsed = parseChannelId(options.id);
    if (!parsed) throw new Error(`无效的 GitHub channel ID: ${options.id}`);

    const expanded = expandInteractiveSegmentsInContent(coerceQrcodeSegmentsToText(options.content ?? ''));
    const arr = Array.isArray(expanded) ? expanded : [expanded];
    const canonical = arr.map((s) => (typeof s === 'string' ? { type: 'text' as const, data: { text: s } } : s));
    const text = toMarkdown(fromCanonicalSegments(canonical));
    const r = parsed.type === 'issue'
      ? await this.gh.createIssueComment(parsed.repo, parsed.number, text)
      : await this.gh.createPRComment(parsed.repo, parsed.number, text);
    if (!r.ok) throw new Error(`发送失败: ${JSON.stringify(r.data)}`);

    this.logger.debug(`${this.$id} send → ${options.id}: ${text.slice(0, 80)}...`);
    return r.data.id.toString();
  }

  async $recallMessage(id: string): Promise<void> {
    this.logger.warn(formatCompact( { op: 'recall', ok: false, error: 'use message.$recall()' }));
  }
}
