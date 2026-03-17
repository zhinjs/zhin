/**
 * GitHub Bot 实现
 */
import path from 'node:path';
import fs from 'node:fs';
import {
  Bot,
  Message,
  SendOptions,
  SendContent,
  segment,
  type MessageSegment,
} from 'zhin.js';
import type {
  GitHubBotConfig,
  IssueCommentPayload,
  PRReviewCommentPayload,
  PRReviewPayload,
} from './types.js';
import { buildChannelId, parseChannelId } from './types.js';
import type { GitHubAdapter } from './adapter.js';
import { GitHubAPI } from './api.js';

function resolvePrivateKey(raw: string): string {
  if (raw.includes('-----BEGIN')) return raw;
  const resolved = path.resolve(raw);
  if (fs.existsSync(resolved)) return fs.readFileSync(resolved, 'utf-8');
  throw new Error(`private_key 既不是 PEM 内容也不是有效的文件路径: ${raw}`);
}

export function parseMarkdown(md: string): MessageSegment[] {
  const segments: MessageSegment[] = [];
  const mentionRe = /@(\w[-\w]*)/g;
  let lastIdx = 0;
  let match: RegExpExecArray | null;
  while ((match = mentionRe.exec(md)) !== null) {
    if (match.index > lastIdx) segments.push({ type: 'text', data: { text: md.slice(lastIdx, match.index) } });
    segments.push({ type: 'at', data: { id: match[1], name: match[1], text: match[0] } });
    lastIdx = match.index + match[0].length;
  }
  if (lastIdx < md.length) segments.push({ type: 'text', data: { text: md.slice(lastIdx) } });
  return segments.length ? segments : [{ type: 'text', data: { text: md } }];
}

export function toMarkdown(content: SendContent): string {
  if (!Array.isArray(content)) content = [content];
  return content.map(seg => {
    if (typeof seg === 'string') return seg;
    switch (seg.type) {
      case 'text': return seg.data.text || '';
      case 'at': return `@${seg.data.name || seg.data.id}`;
      case 'image': return seg.data.url ? `![image](${seg.data.url})` : '[image]';
      case 'link': return `[${seg.data.text || seg.data.url}](${seg.data.url})`;
      default: return seg.data?.text || `[${seg.type}]`;
    }
  }).join('');
}

export class GitHubBot implements Bot<GitHubBotConfig, IssueCommentPayload> {
  $connected = false;
  api: GitHubAPI;

  get $id() { return this.$config.name; }

  get logger() {
    return this.adapter.plugin.logger;
  }

  constructor(public adapter: GitHubAdapter, public $config: GitHubBotConfig) {
    const privateKey = resolvePrivateKey($config.private_key);
    this.api = new GitHubAPI($config.app_id, privateKey, $config.installation_id);
  }

  async $connect(): Promise<void> {
    const result = await this.api.verifyAuth();
    if (!result.ok) throw new Error(`GitHub 认证失败: ${result.message}`);
    this.$connected = true;
    this.logger.info(`GitHub bot ${this.$id} 已连接 — ${result.message}`);
  }

  async $disconnect(): Promise<void> {
    this.$connected = false;
    this.logger.info(`GitHub bot ${this.$id} 已断开`);
  }

  $formatMessage(payload: IssueCommentPayload): Message<IssueCommentPayload> {
    const repo = payload.repository.full_name;
    const number = payload.issue.number;
    const isPR = 'pull_request' in (payload.issue as any);
    const channelId = buildChannelId(repo, isPR ? 'pr' : 'issue', number);
    const api = this.api;

    const result = Message.from(payload, {
      $id: payload.comment.id.toString(),
      $adapter: 'github',
      $bot: this.$config.name,
      $sender: { id: payload.sender.login, name: payload.sender.login },
      $channel: { id: channelId, type: 'group' },
      $content: parseMarkdown(payload.comment.body),
      $raw: payload.comment.body,
      $timestamp: new Date(payload.comment.created_at).getTime(),
      $recall: async () => { await api.deleteIssueComment(repo, payload.comment.id); },
      $reply: async (content: SendContent, quote?: boolean | string): Promise<string> => {
        const text = toMarkdown(content);
        const finalBody = quote ? `> ${payload.comment.body.split('\n')[0]}\n\n${text}` : text;
        const r = await api.createIssueComment(repo, number, finalBody);
        return r.ok ? r.data.id.toString() : '';
      },
    });
    return result;
  }

  formatPRReviewComment(payload: PRReviewCommentPayload): Message<PRReviewCommentPayload> {
    const repo = payload.repository.full_name;
    const number = payload.pull_request.number;
    const channelId = buildChannelId(repo, 'pr', number);
    const api = this.api;

    const body = payload.comment.path
      ? `**${payload.comment.path}**\n${payload.comment.diff_hunk ? '```diff\n' + payload.comment.diff_hunk + '\n```\n' : ''}${payload.comment.body}`
      : payload.comment.body;

    return Message.from(payload, {
      $id: payload.comment.id.toString(),
      $adapter: 'github',
      $bot: this.$config.name,
      $sender: { id: payload.sender.login, name: payload.sender.login },
      $channel: { id: channelId, type: 'group' },
      $content: parseMarkdown(body),
      $raw: body,
      $timestamp: new Date(payload.comment.created_at).getTime(),
      $recall: async () => { await api.deletePRReviewComment(repo, payload.comment.id); },
      $reply: async (content: SendContent): Promise<string> => {
        const r = await api.createPRComment(repo, number, toMarkdown(content));
        return r.ok ? r.data.id.toString() : '';
      },
    });
  }

  formatPRReview(payload: PRReviewPayload): Message<PRReviewPayload> | null {
    if (!payload.review.body) return null;
    const repo = payload.repository.full_name;
    const number = payload.pull_request.number;
    const channelId = buildChannelId(repo, 'pr', number);
    const api = this.api;

    const stateLabel: Record<string, string> = {
      approved: '✅ APPROVED', changes_requested: '🔄 CHANGES REQUESTED',
      commented: '💬 COMMENTED', dismissed: '❌ DISMISSED',
    };
    const body = `**[${stateLabel[payload.review.state] || payload.review.state}]**\n${payload.review.body}`;

    return Message.from(payload, {
      $id: payload.review.id.toString(),
      $adapter: 'github',
      $bot: this.$config.name,
      $sender: { id: payload.sender.login, name: payload.sender.login },
      $channel: { id: channelId, type: 'group' },
      $content: parseMarkdown(body),
      $raw: body,
      $timestamp: new Date(payload.review.submitted_at).getTime(),
      $recall: async () => {},
      $reply: async (content: SendContent): Promise<string> => {
        const r = await api.createPRComment(repo, number, toMarkdown(content));
        return r.ok ? r.data.id.toString() : '';
      },
    });
  }

  async $sendMessage(options: SendOptions): Promise<string> {
    const parsed = parseChannelId(options.id);
    if (!parsed) throw new Error(`无效的 GitHub channel ID: ${options.id}`);

    const text = toMarkdown(options.content);
    const r = parsed.type === 'issue'
      ? await this.api.createIssueComment(parsed.repo, parsed.number, text)
      : await this.api.createPRComment(parsed.repo, parsed.number, text);
    if (!r.ok) throw new Error(`发送失败: ${JSON.stringify(r.data)}`);

    this.logger.debug(`${this.$id} send → ${options.id}: ${text.slice(0, 80)}...`);
    return r.data.id.toString();
  }

  async $recallMessage(id: string): Promise<void> {
    this.logger.warn('$recallMessage 需要 repo 信息，请使用 message.$recall()');
  }
}
