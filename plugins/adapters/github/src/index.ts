/**
 * @zhin.js/adapter-github
 *
 * 把 GitHub 当聊天通道 — Issue/PR 评论区 = 群聊
 * 通过 GitHub App 认证 (JWT → Installation Token)，纯 REST API 对接，零 CLI 依赖
 *
 * 查询 · 管理 · 通知 三合一
 */

import {
  Bot,
  Adapter,
  Plugin,
  Message,
  SendOptions,
  SendContent,
  segment,
  usePlugin,
  ZhinTool,
  type MessageSegment,
} from 'zhin.js';
import type {
  GitHubBotConfig,
  IssueCommentPayload,
  PRReviewCommentPayload,
  PRReviewPayload,
  GenericWebhookPayload,
  EventType,
  Subscription,
  PrAction,
  IssueAction,
  RepoAction,
} from './types.js';
import { parseChannelId, buildChannelId } from './types.js';
import type { GitHubOAuthUser } from './types.js';
import { GitHubAPI, GitHubOAuthClient, exchangeOAuthCode } from './api.js';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

// ============================================================================
// 类型扩展
// ============================================================================

declare module 'zhin.js' {
  namespace Plugin {
    interface Contexts {
      router: import('@zhin.js/http').Router;
    }
  }
  interface Adapters {
    github: GitHubAdapter;
  }
  interface Models {
    github_subscriptions: {
      id: number;
      repo: string;
      events: EventType[];
      target_id: string;
      target_type: 'private' | 'group' | 'channel';
      adapter: string;
      bot: string;
    };
    github_events: {
      id: number;
      repo: string;
      event_type: string;
      payload: any;
    };
    github_oauth_users: GitHubOAuthUser;
  }
}

// ============================================================================
// Plugin 初始化
// ============================================================================

const plugin = usePlugin();
const { provide, defineModel,useContext, root, logger } = plugin;

defineModel('github_subscriptions', {
  id: { type: 'integer', primary: true },
  repo: { type: 'text', nullable: false },
  events: { type: 'json', default: [] },
  target_id: { type: 'text', nullable: false },
  target_type: { type: 'text', nullable: false },
  adapter: { type: 'text', nullable: false },
  bot: { type: 'text', nullable: false },
});

defineModel('github_events', {
  id: { type: 'integer', primary: true },
  repo: { type: 'text', nullable: false },
  event_type: { type: 'text', nullable: false },
  payload: { type: 'json', default: {} },
});

defineModel('github_oauth_users', {
  id: { type: 'integer', primary: true },
  platform: { type: 'text', nullable: false },
  platform_uid: { type: 'text', nullable: false },
  github_login: { type: 'text', nullable: false },
  github_id: { type: 'integer', nullable: false },
  access_token: { type: 'text', nullable: false },
  scope: { type: 'text', default: '' },
  created_at: { type: 'date', nullable: false },
  updated_at: { type: 'date', nullable: false },
});

const VALID_EVENTS: EventType[] = ['push', 'issue', 'star', 'fork', 'unstar', 'pull_request'];

function safeParseEvents(raw: any): EventType[] {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try { const parsed = JSON.parse(raw); if (Array.isArray(parsed)) return parsed; } catch {}
  }
  return [];
}

// OAuth state 存储（内存，5分钟过期）
const oauthStates = new Map<string, { platform: string; platformUid: string; expires: number }>();
const OAUTH_STATE_TTL = 5 * 60 * 1000;

// ============================================================================
// GitHubBot
// ============================================================================

function resolvePrivateKey(raw: string): string {
  if (raw.includes('-----BEGIN')) return raw;
  const resolved = path.resolve(raw);
  if (fs.existsSync(resolved)) return fs.readFileSync(resolved, 'utf-8');
  throw new Error(`private_key 既不是 PEM 内容也不是有效的文件路径: ${raw}`);
}

export class GitHubBot implements Bot<GitHubBotConfig, IssueCommentPayload> {
  $connected = false;
  api: GitHubAPI;

  get $id() { return this.$config.name; }

  constructor(public adapter: GitHubAdapter, public $config: GitHubBotConfig) {
    const privateKey = resolvePrivateKey($config.private_key);
    this.api = new GitHubAPI($config.app_id, privateKey, $config.installation_id);
  }

  async $connect(): Promise<void> {
    const result = await this.api.verifyAuth();
    if (!result.ok) throw new Error(`GitHub 认证失败: ${result.message}`);
    this.$connected = true;
    logger.info(`GitHub bot ${this.$id} 已连接 — ${result.message}`);
  }

  async $disconnect(): Promise<void> {
    this.$connected = false;
    logger.info(`GitHub bot ${this.$id} 已断开`);
  }

  // ── Webhook → Message ──────────────────────────────────────────────

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

  // ── 发送 & 撤回 ───────────────────────────────────────────────────

  async $sendMessage(options: SendOptions): Promise<string> {
    const parsed = parseChannelId(options.id);
    if (!parsed) throw new Error(`无效的 GitHub channel ID: ${options.id}`);

    const text = toMarkdown(options.content);
    const r = parsed.type === 'issue'
      ? await this.api.createIssueComment(parsed.repo, parsed.number, text)
      : await this.api.createPRComment(parsed.repo, parsed.number, text);
    if (!r.ok) throw new Error(`发送失败: ${JSON.stringify(r.data)}`);

    logger.debug(`${this.$id} send → ${options.id}: ${text.slice(0, 80)}...`);
    return r.data.id.toString();
  }

  async $recallMessage(id: string): Promise<void> {
    logger.warn('$recallMessage 需要 repo 信息，请使用 message.$recall()');
  }
}

// ============================================================================
// GitHubAdapter
// ============================================================================

class GitHubAdapter extends Adapter<GitHubBot> {
  get publicUrl(): string | undefined {
    const bot = this.bots.values().next().value as GitHubBot | undefined;
    return bot?.$config.public_url?.replace(/\/+$/, '');
  }

  constructor(plugin: Plugin) {
    super(plugin, 'github', []);
  }

  createBot(config: GitHubBotConfig): GitHubBot {
    return new GitHubBot(this, config);
  }

  async start(): Promise<void> {
    this.registerGitHubTools();
    this.declareSkill({
      description: 'GitHub 全功能适配器：Issue/PR 评论即聊天通道，仓库管理（PR合并/创建/Review、Issue编辑管理）、信息查询（Star/CI/Release/Branch）、全局搜索（issues/repos/code）、标签与指派管理、仓库文件读取、提交历史与分支对比、Webhook 事件通知订阅、OAuth 用户绑定。通过 GitHub App 认证，纯 REST API。',
      keywords: [
        'github', 'pr', 'pull request', 'issue', 'merge', 'review',
        'star', 'fork', 'branch', 'release', 'CI', 'workflow', 'repo',
        '合并', '仓库', '拉取请求', '代码审查', 'search', '搜索',
        'label', '标签', 'assign', '指派', 'file', '文件',
        'commit', '提交', 'compare', '对比', 'edit', '编辑',
      ],
      tags: ['github', 'development', 'git', 'ci-cd'],
      conventions: 'channel ID 格式 owner/repo/issues/N 或 owner/repo/pull/N。repo 参数不填则需要手动指定。',
    });
    await super.start();
  }

  /** 获取第一个可用 bot 的 API (工具用) */
  private getAPI(): GitHubAPI | null {
    const bot = this.bots.values().next().value as GitHubBot | undefined;
    return bot?.api || null;
  }

  // ── OAuth 用户查询 ─────────────────────────────────────────────────

  async getOAuthClient(platform: string, platformUid: string): Promise<GitHubOAuthClient | null> {
    const db = root.inject('database') as any;
    const model = db?.models?.get('github_oauth_users');
    if (!model) return null;
    const [row] = await model.select().where({ platform, platform_uid: platformUid });
    if (!row) return null;
    return new GitHubOAuthClient(row.access_token);
  }

  // ── OAuth 路由 (由 useContext('router') 注入) ─────────────────────

  setupOAuth(router: import('@zhin.js/http').Router): void {
    const OAUTH_SCOPES = 'repo,user';

    router.get('/pub/github/oauth', async (ctx: any) => {
      const state = ctx.query.state as string;
      if (!state || !oauthStates.has(state)) {
        ctx.status = 400;
        ctx.body = 'Invalid or expired state. Please use /github bind to generate a new link.';
        return;
      }

      const bot = this.bots.values().next().value as GitHubBot | undefined;
      const clientId = bot?.$config.client_id;
      if (!clientId) {
        ctx.status = 500;
        ctx.body = 'GitHub App OAuth not configured (missing client_id).';
        return;
      }

      const base = this.publicUrl || ctx.origin;
      const redirectUri = `${base}/pub/github/oauth/callback`;
      const url = `https://github.com/login/oauth/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${OAUTH_SCOPES}&state=${state}`;
      ctx.redirect(url);
    });

    router.get('/pub/github/oauth/callback', async (ctx: any) => {
      const { code, state } = ctx.query as { code?: string; state?: string };
      if (!code || !state) {
        ctx.status = 400;
        ctx.body = 'Missing code or state parameter.';
        return;
      }

      const pending = oauthStates.get(state);
      if (!pending || Date.now() > pending.expires) {
        oauthStates.delete(state);
        ctx.status = 400;
        ctx.body = 'State expired. Please use /github bind to try again.';
        return;
      }
      oauthStates.delete(state);

      const bot = this.bots.values().next().value as GitHubBot | undefined;
      const clientId = bot?.$config.client_id;
      const clientSecret = bot?.$config.client_secret;
      if (!clientId || !clientSecret) {
        ctx.status = 500;
        ctx.body = 'OAuth not configured.';
        return;
      }

      try {
        const tokenData = await exchangeOAuthCode(clientId, clientSecret, code);
        const oauthClient = new GitHubOAuthClient(tokenData.access_token);
        const userRes = await oauthClient.getUser();
        if (!userRes.ok) {
          ctx.status = 500;
          ctx.body = 'Failed to fetch GitHub user info.';
          return;
        }

        const ghUser = userRes.data;
        const db = root.inject('database') as any;
        const model = db?.models?.get('github_oauth_users');
        if (!model) {
          ctx.status = 500;
          ctx.body = 'Database not ready.';
          return;
        }

        const [existing] = await model.select().where({ platform: pending.platform, platform_uid: pending.platformUid });
        if (existing) {
          await model.update({
            github_login: ghUser.login,
            github_id: ghUser.id,
            access_token: tokenData.access_token,
            scope: tokenData.scope || '',
            updated_at: new Date(),
          }).where({ id: existing.id });
        } else {
          await model.insert({
            id: Date.now(),
            platform: pending.platform,
            platform_uid: pending.platformUid,
            github_login: ghUser.login,
            github_id: ghUser.id,
            access_token: tokenData.access_token,
            scope: tokenData.scope || '',
            created_at: new Date(),
            updated_at: new Date(),
          });
        }

        logger.info(`OAuth 绑定成功: ${pending.platform}:${pending.platformUid} → ${ghUser.login}`);

        ctx.type = 'text/html';
        ctx.body = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>绑定成功</title><style>body{font-family:system-ui;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#f5f5f5}div{text-align:center;background:#fff;padding:3rem;border-radius:12px;box-shadow:0 2px 12px rgba(0,0,0,.1)}h1{color:#28a745;margin-bottom:.5rem}p{color:#666}</style></head><body><div><h1>GitHub 账号绑定成功</h1><p>已绑定 GitHub 用户: <strong>${ghUser.login}</strong></p><p>你现在可以关闭这个页面，回到聊天中使用 GitHub 功能了。</p></div></body></html>`;
      } catch (err: any) {
        logger.error('OAuth callback 失败:', err);
        ctx.status = 500;
        ctx.body = `OAuth failed: ${err.message}`;
      }
    });

    logger.debug('GitHub OAuth: GET /pub/github/oauth, GET /pub/github/oauth/callback');
  }

  // ── Webhook 路由 (由 useContext('router') 注入) ────────────────────

  setupWebhook(router: import('@zhin.js/http').Router): void {
    router.post('/pub/github/webhook', async (ctx: any) => {
      try {
        const eventName = ctx.request.headers['x-github-event'] as string;
        const signature = ctx.request.headers['x-hub-signature-256'] as string;
        const payload = ctx.request.body;

        logger.info(`GitHub Webhook: ${eventName} - ${payload?.repository?.full_name || '(no repo)'}`);

        if (eventName === 'ping') {
          logger.info(`GitHub Webhook ping OK — hook_id: ${payload?.hook_id}, zen: ${payload?.zen}`);
          ctx.status = 200;
          ctx.body = { message: 'pong' };
          return;
        }

        if (signature) {
          let verified = false;
          const rawBody = JSON.stringify(payload);
          for (const bot of this.bots.values()) {
            const secret = bot.$config.webhook_secret;
            if (!secret) continue;
            const expected = `sha256=${crypto.createHmac('sha256', secret).update(rawBody).digest('hex')}`;
            if (signature === expected) { verified = true; break; }
          }
          if (!verified) {
            const hasSecret = Array.from(this.bots.values()).some(b => b.$config.webhook_secret);
            if (hasSecret) {
              logger.warn('GitHub Webhook 签名验证失败');
              ctx.status = 401;
              ctx.body = { error: 'Invalid signature' };
              return;
            }
          }
        }

        if (!payload?.repository) {
          ctx.status = 400;
          ctx.body = { error: 'Invalid payload' };
          return;
        }

        const db = root.inject('database') as any;
        const eventsModel = db?.models?.get('github_events');
        if (eventsModel) {
          await eventsModel.insert({ id: Date.now(), repo: payload.repository.full_name, event_type: eventName, payload });
        }

        const bot = this.bots.values().next().value as GitHubBot | undefined;

        if (bot) {
          let message: Message | null = null;

          if (eventName === 'issue_comment' && payload.action === 'created') {
            message = bot.$formatMessage(payload as IssueCommentPayload);
          } else if (eventName === 'pull_request_review_comment' && payload.action === 'created') {
            message = bot.formatPRReviewComment(payload as PRReviewCommentPayload);
          } else if (eventName === 'pull_request_review' && payload.action === 'submitted') {
            message = bot.formatPRReview(payload as PRReviewPayload);
          }

          if (message) {
            const botUser = bot.api.authenticatedUser;
            if (botUser && message.$sender.id === botUser) {
              logger.debug(`忽略 bot 自身评论: ${message.$sender.id}`);
            } else {
              this.emit('message.receive', message);
            }
          }
        }

        await this.dispatchNotification(eventName, payload);

        ctx.status = 200;
        ctx.body = { message: 'OK' };
      } catch (error) {
        logger.error('Webhook 处理失败:', error);
        ctx.status = 500;
        ctx.body = { error: 'Internal server error' };
      }
    });

    logger.debug('GitHub Webhook: POST /pub/github/webhook');
  }

  // ── GitHub 管理工具 ────────────────────────────────────────────────

  private registerGitHubTools(): void {

    // --- PR ---
    this.addTool(
      new ZhinTool('github.pr')
        .desc('GitHub PR 操作：list/view/diff/merge/create/review/close')
        .keyword('pr', 'pull request', '合并', 'merge', 'review', '审查', '拉取请求')
        .tag('github', 'pr')
        .param('action', { type: 'string', description: 'list|view|diff|merge|create|review|close', enum: ['list','view','diff','merge','create','review','close'] }, true)
        .param('repo', { type: 'string', description: 'owner/repo (必填)' }, true)
        .param('number', { type: 'number', description: 'PR 编号' })
        .param('title', { type: 'string', description: 'PR 标题 (create)' })
        .param('body', { type: 'string', description: 'PR 描述 / Review 评语' })
        .param('head', { type: 'string', description: '源分支 (create)' })
        .param('base', { type: 'string', description: '目标分支 (create，默认 main)' })
        .param('state', { type: 'string', description: 'open/closed/all (list)' })
        .param('approve', { type: 'boolean', description: 'review 时 approve' })
        .param('method', { type: 'string', description: 'squash/merge/rebase (merge)' })
        .execute(async (args) => {
          const api = this.getAPI();
          if (!api) return '❌ 没有可用的 GitHub bot';
          const action = args.action as PrAction;
          const repo = args.repo as string;
          const num = args.number as number | undefined;

          switch (action) {
            case 'list': {
              const r = await api.listPRs(repo, (args.state as string) || 'open');
              if (!r.ok) return `❌ ${JSON.stringify(r.data)}`;
              if (!r.data.length) return `📭 没有 ${args.state || 'open'} 状态的 PR`;
              return r.data.map((p: any) =>
                `#${p.number} ${p.draft ? '[Draft] ' : ''}${p.title}\n   👤 ${p.user.login} | 🌿 ${p.head.ref} → ${p.base.ref} | ${p.state}`
              ).join('\n\n');
            }
            case 'view': {
              if (!num) return '❌ 请提供 PR 编号';
              const r = await api.getPR(repo, num);
              if (!r.ok) return `❌ ${JSON.stringify(r.data)}`;
              const p = r.data;
              return [
                `#${p.number} ${p.title}`,
                `👤 ${p.user.login} | ${p.state} | 🌿 ${p.head.ref} → ${p.base.ref}`,
                `📅 ${p.created_at?.split('T')[0]} | +${p.additions} -${p.deletions} (${p.changed_files} files)`,
                p.body ? `\n${p.body.slice(0, 500)}${p.body.length > 500 ? '...' : ''}` : '',
                `\n🔗 ${p.html_url}`,
              ].filter(Boolean).join('\n');
            }
            case 'diff': {
              if (!num) return '❌ 请提供 PR 编号';
              const r = await api.getPRDiff(repo, num);
              if (!r.ok) return `❌ 获取 diff 失败`;
              const lines = r.data.split('\n');
              return lines.length > 100 ? lines.slice(0, 100).join('\n') + `\n\n... (共 ${lines.length} 行)` : r.data;
            }
            case 'merge': {
              if (!num) return '❌ 请提供 PR 编号';
              const r = await api.mergePR(repo, num, (args.method as string) || 'squash');
              return r.ok ? `✅ PR #${num} 已合并` : `❌ ${r.data?.message || JSON.stringify(r.data)}`;
            }
            case 'create': {
              if (!args.title) return '❌ 请提供 PR 标题';
              if (!args.head) return '❌ 请提供源分支 (head)';
              const r = await api.createPR(repo, args.title as string, (args.body as string) || '', args.head as string, (args.base as string) || 'main');
              return r.ok ? `✅ PR 已创建: ${r.data.html_url}` : `❌ ${r.data?.message || JSON.stringify(r.data)}`;
            }
            case 'review': {
              if (!num) return '❌ 请提供 PR 编号';
              const event = args.approve ? 'APPROVE' : 'COMMENT';
              const r = await api.createPRReview(repo, num, event as any, (args.body as string) || undefined);
              return r.ok ? `✅ PR #${num} ${args.approve ? '已批准' : '已评论'}` : `❌ ${r.data?.message}`;
            }
            case 'close': {
              if (!num) return '❌ 请提供 PR 编号';
              const r = await api.closePR(repo, num);
              return r.ok ? `✅ PR #${num} 已关闭` : `❌ ${r.data?.message}`;
            }
            default: return `❌ 未知操作: ${action}`;
          }
        }),
    );

    // --- Issue ---
    this.addTool(
      new ZhinTool('github.issue')
        .desc('GitHub Issue 操作：list/view/create/close/comment')
        .keyword('issue', '问题', 'bug', '创建issue', '关闭issue')
        .tag('github', 'issue')
        .param('action', { type: 'string', description: 'list|view|create|close|comment', enum: ['list','view','create','close','comment'] }, true)
        .param('repo', { type: 'string', description: 'owner/repo (必填)' }, true)
        .param('number', { type: 'number', description: 'Issue 编号' })
        .param('title', { type: 'string', description: 'Issue 标题 (create)' })
        .param('body', { type: 'string', description: 'Issue 内容 / 评论内容' })
        .param('labels', { type: 'string', description: '标签，逗号分隔 (create)' })
        .param('state', { type: 'string', description: 'open/closed/all (list)' })
        .execute(async (args) => {
          const api = this.getAPI();
          if (!api) return '❌ 没有可用的 GitHub bot';
          const action = args.action as IssueAction;
          const repo = args.repo as string;
          const num = args.number as number | undefined;

          switch (action) {
            case 'list': {
              const r = await api.listIssues(repo, (args.state as string) || 'open');
              if (!r.ok) return `❌ ${JSON.stringify(r.data)}`;
              // 过滤掉 PR (GitHub API 的 issues 接口也返回 PR)
              const issues = r.data.filter((i: any) => !i.pull_request);
              if (!issues.length) return `📭 没有 ${args.state || 'open'} 状态的 Issue`;
              return issues.map((i: any) => {
                const labels = i.labels?.map((l: any) => l.name).join(', ') || '';
                return `#${i.number} ${i.title}\n   👤 ${i.user.login}${labels ? ` | 🏷️ ${labels}` : ''} | ${i.state}`;
              }).join('\n\n');
            }
            case 'view': {
              if (!num) return '❌ 请提供 Issue 编号';
              const r = await api.getIssue(repo, num);
              if (!r.ok) return `❌ ${JSON.stringify(r.data)}`;
              const i = r.data;
              return [
                `#${i.number} ${i.title}`,
                `👤 ${i.user.login} | ${i.state} | 📅 ${i.created_at?.split('T')[0]}`,
                i.labels?.length ? `🏷️ ${i.labels.map((l: any) => l.name).join(', ')}` : null,
                i.body ? `\n${i.body.slice(0, 500)}${i.body.length > 500 ? '...' : ''}` : '',
                `\n🔗 ${i.html_url}`,
              ].filter(Boolean).join('\n');
            }
            case 'create': {
              if (!args.title) return '❌ 请提供 Issue 标题';
              const labels = args.labels ? (args.labels as string).split(',').map(s => s.trim()) : undefined;
              const r = await api.createIssue(repo, args.title as string, (args.body as string) || undefined, labels);
              return r.ok ? `✅ Issue 已创建: ${r.data.html_url}` : `❌ ${r.data?.message}`;
            }
            case 'close': {
              if (!num) return '❌ 请提供 Issue 编号';
              const r = await api.closeIssue(repo, num);
              return r.ok ? `✅ Issue #${num} 已关闭` : `❌ ${r.data?.message}`;
            }
            case 'comment': {
              if (!num) return '❌ 请提供 Issue 编号';
              if (!args.body) return '❌ 请提供评论内容';
              const r = await api.createIssueComment(repo, num, args.body as string);
              return r.ok ? `✅ 已评论 Issue #${num}` : `❌ ${JSON.stringify(r.data)}`;
            }
            default: return `❌ 未知操作: ${action}`;
          }
        }),
    );

    // --- Repo ---
    this.addTool(
      new ZhinTool('github.repo')
        .desc('GitHub 仓库查询：info/branches/releases/runs(CI)/stars')
        .keyword('仓库', 'repo', 'star', '分支', 'branch', 'release', '发布', 'CI', 'workflow')
        .tag('github', 'repo')
        .param('action', { type: 'string', description: 'info|branches|releases|runs|stars', enum: ['info','branches','releases','runs','stars'] }, true)
        .param('repo', { type: 'string', description: 'owner/repo (必填)' }, true)
        .param('limit', { type: 'number', description: '返回数量，默认 10' })
        .execute(async (args) => {
          const api = this.getAPI();
          if (!api) return '❌ 没有可用的 GitHub bot';
          const action = args.action as RepoAction;
          const repo = args.repo as string;
          const limit = (args.limit as number) || 10;

          switch (action) {
            case 'info': {
              const r = await api.getRepo(repo);
              if (!r.ok) return `❌ ${JSON.stringify(r.data)}`;
              const d = r.data;
              return [
                `📦 ${d.full_name}${d.private ? ' 🔒' : ''}`,
                d.description ? `📝 ${d.description}` : null,
                `⭐ ${d.stargazers_count} | 🍴 ${d.forks_count} | 👀 ${d.watchers_count}`,
                `🌿 默认分支: ${d.default_branch}`,
                d.license ? `📄 ${d.license.name}` : null,
                d.homepage ? `🌐 ${d.homepage}` : null,
                `📅 创建: ${d.created_at?.split('T')[0]} | 推送: ${d.pushed_at?.split('T')[0]}`,
              ].filter(Boolean).join('\n');
            }
            case 'branches': {
              const r = await api.listBranches(repo, limit);
              if (!r.ok) return `❌ ${JSON.stringify(r.data)}`;
              return r.data.length
                ? `🌿 分支 (${r.data.length}):\n${r.data.map((b: any) => `  • ${b.name}${b.protected ? ' 🔒' : ''}`).join('\n')}`
                : '没有找到分支';
            }
            case 'releases': {
              const r = await api.listReleases(repo, limit);
              if (!r.ok) return `❌ ${JSON.stringify(r.data)}`;
              if (!r.data.length) return '📭 暂无发布';
              return r.data.map((rel: any) =>
                `${rel.prerelease ? '🧪' : '📦'} ${rel.tag_name} — ${rel.name || '(no title)'}\n   📅 ${rel.published_at?.split('T')[0]} | 👤 ${rel.author?.login}`
              ).join('\n\n');
            }
            case 'runs': {
              const r = await api.listWorkflowRuns(repo, limit);
              if (!r.ok) return `❌ ${JSON.stringify(r.data)}`;
              const runs = r.data.workflow_runs || [];
              if (!runs.length) return '📭 暂无 CI 记录';
              return runs.map((run: any) => {
                const icon = run.conclusion === 'success' ? '✅' : run.conclusion === 'failure' ? '❌' : run.status === 'in_progress' ? '🔄' : '⏳';
                return `${icon} #${run.id} ${run.display_title}\n   🌿 ${run.head_branch} | ${run.status}${run.conclusion ? '/' + run.conclusion : ''}`;
              }).join('\n\n');
            }
            case 'stars': {
              const r = await api.getRepo(repo);
              if (!r.ok) return `❌ ${JSON.stringify(r.data)}`;
              return `⭐ ${r.data.stargazers_count} stars | 🍴 ${r.data.forks_count} forks`;
            }
            default: return `❌ 未知查询: ${action}`;
          }
        }),
    );

    // --- Subscribe ---
    this.addTool(
      new ZhinTool('github.subscribe')
        .desc('订阅 GitHub 仓库 Webhook 事件通知（跨平台推送到当前聊天）')
        .tag('github', 'subscription')
        .param('repo', { type: 'string', description: 'owner/repo' }, true)
        .param('events', { type: 'array', description: '事件: push, issue, star, fork, unstar, pr（留空=全部）' })
        .execute(async ({ repo, events: evts = [] }, ctx) => {
          if (!ctx?.message) return '❌ 无法获取消息上下文';
          const msg = ctx.message as Message;
          const repoStr = repo as string;
          if (!repoStr.includes('/')) return '❌ 格式应为 owner/repo';

          const parsed: EventType[] = [];
          for (const e of evts as string[]) {
            const n = e.toLowerCase();
            if (n === 'pr') parsed.push('pull_request');
            else if (VALID_EVENTS.includes(n as EventType)) parsed.push(n as EventType);
            else return `❌ 不支持: ${e}`;
          }
          const subEvents = parsed.length > 0 ? parsed : VALID_EVENTS;
          const db = root.inject('database') as any;
          const model = db?.models?.get('github_subscriptions');
          if (!model) return '❌ 数据库未就绪';

          const where = { repo: repoStr, target_id: msg.$channel.id, target_type: msg.$channel.type, adapter: msg.$adapter, bot: msg.$bot };
          const [existing] = await model.select().where(where);
          const eventsJson = JSON.stringify(subEvents);
          if (existing) {
            await model.update({ events: eventsJson }).where({ id: existing.id });
            return `✅ 已更新订阅 ${repoStr}\n📢 ${subEvents.join(', ')}`;
          }
          const { repo: _r, ...rest } = where;
          await model.insert({ id: Date.now(), repo: repoStr, events: eventsJson, ...rest });
          return `✅ 已订阅 ${repoStr}\n📢 ${subEvents.join(', ')}\n💡 记得在 GitHub App 或仓库 Settings → Webhooks 中配置 Webhook`;
        }),
    );

    // --- Unsubscribe ---
    this.addTool(
      new ZhinTool('github.unsubscribe')
        .desc('取消订阅 GitHub 仓库事件通知')
        .tag('github', 'subscription')
        .param('repo', { type: 'string', description: 'owner/repo' }, true)
        .execute(async ({ repo }, ctx) => {
          if (!ctx?.message) return '❌ 无法获取消息上下文';
          const msg = ctx.message as Message;
          const db = root.inject('database') as any;
          const model = db?.models?.get('github_subscriptions');
          if (!model) return '❌ 数据库未就绪';
          const [sub] = await model.select().where({ repo: repo as string, target_id: msg.$channel.id, target_type: msg.$channel.type, adapter: msg.$adapter, bot: msg.$bot });
          if (!sub) return `❌ 未找到订阅: ${repo}`;
          await model.delete({ id: sub.id });
          return `✅ 已取消订阅 ${repo}`;
        }),
    );

    // --- List subscriptions ---
    this.addTool(
      new ZhinTool('github.subscriptions')
        .desc('查看当前聊天的 GitHub 事件订阅列表')
        .tag('github', 'subscription')
        .execute(async (_args, ctx) => {
          if (!ctx?.message) return '❌ 无法获取消息上下文';
          const msg = ctx.message as Message;
          const db = root.inject('database') as any;
          const model = db?.models?.get('github_subscriptions');
          if (!model) return '❌ 数据库未就绪';
          const subs = await model.select().where({ target_id: msg.$channel.id, target_type: msg.$channel.type, adapter: msg.$adapter, bot: msg.$bot });
          if (!subs?.length) return '📭 当前没有订阅';
          return `📋 订阅 (${subs.length}):\n\n` + subs.map((s: any, i: number) => {
            return `${i + 1}. ${s.repo}\n   📢 ${safeParseEvents(s.events).join(', ')}`;
          }).join('\n\n');
        }),
    );

    // --- GitHub OAuth Bind ---
    this.addTool(
      new ZhinTool('github.bind')
        .desc('绑定 GitHub 账号 — 通过 OAuth 授权，让 bot 以你的身份执行 star/fork 等操作')
        .keyword('github bind', '绑定github', 'github 绑定', 'github 授权')
        .tag('github', 'oauth')
        .execute(async (_args, ctx) => {
          if (!ctx?.message) return '❌ 无法获取消息上下文';
          const msg = ctx.message as Message;

          const bot = this.bots.values().next().value as GitHubBot | undefined;
          if (!bot?.$config.client_id) {
            return '❌ GitHub OAuth 未配置（需要在 bot 配置中添加 client_id 和 client_secret）';
          }

          const nonce = crypto.randomBytes(16).toString('hex');
          const state = `${msg.$adapter}:${msg.$sender.id}:${nonce}`;
          oauthStates.set(state, {
            platform: msg.$adapter,
            platformUid: msg.$sender.id,
            expires: Date.now() + OAUTH_STATE_TTL,
          });

          const baseUrl = this.publicUrl;
          if (!baseUrl) {
            return '❌ 未配置 public_url，无法生成 OAuth 链接\n💡 请在 bot 配置中添加 public_url（如 https://bot.example.com）';
          }
          const link = `${baseUrl}/pub/github/oauth?state=${encodeURIComponent(state)}`;
          const fullText = `🔗 请点击以下链接授权你的 GitHub 账号：\n\n${link}\n\n⏱️ 链接有效期 5 分钟`;

          // 由工具直接发到用户，避免 AI 总结时把链接吞掉
          try {
            const targetAdapter = root.inject(msg.$adapter)
            if (targetAdapter instanceof Adapter) {
              await targetAdapter.sendMessage({
                context: msg.$adapter,
                bot: msg.$bot,
                id: msg.$channel.id,
                type: msg.$channel.type,
                content: fullText,
              });
            }
          } catch (e) {
            logger.warn('github.bind 直发链接失败，将仅通过返回值返回链接', e);
          }

          return '已向当前会话发送绑定链接，请提醒用户查收并点击链接完成授权。';
        }),
    );

    // --- GitHub OAuth Unbind ---
    this.addTool(
      new ZhinTool('github.unbind')
        .desc('解除 GitHub 账号绑定')
        .keyword('github unbind', '解绑github', 'github 解绑')
        .tag('github', 'oauth')
        .execute(async (_args, ctx) => {
          if (!ctx?.message) return '❌ 无法获取消息上下文';
          const msg = ctx.message as Message;
          const db = root.inject('database') as any;
          const model = db?.models?.get('github_oauth_users');
          if (!model) return '❌ 数据库未就绪';

          const [existing] = await model.select().where({ platform: msg.$adapter, platform_uid: msg.$sender.id });
          if (!existing) return '❌ 你还没有绑定 GitHub 账号';

          await model.delete({ id: existing.id });
          return `✅ 已解除 GitHub 账号绑定（${existing.github_login}）`;
        }),
    );

    // --- GitHub OAuth Whoami ---
    this.addTool(
      new ZhinTool('github.whoami')
        .desc('查看当前绑定的 GitHub 账号信息')
        .keyword('github whoami', 'github 我是谁', 'github 账号')
        .tag('github', 'oauth')
        .execute(async (_args, ctx) => {
          if (!ctx?.message) return '❌ 无法获取消息上下文';
          const msg = ctx.message as Message;
          const db = root.inject('database') as any;
          const model = db?.models?.get('github_oauth_users');
          if (!model) return '❌ 数据库未就绪';

          const [existing] = await model.select().where({ platform: msg.$adapter, platform_uid: msg.$sender.id });
          if (!existing) return '❌ 你还没有绑定 GitHub 账号\n💡 使用 /github bind 进行绑定';

          const oauthClient = new GitHubOAuthClient(existing.access_token);
          const userRes = await oauthClient.getUser();
          if (!userRes.ok) {
            return `⚠️ 已绑定 ${existing.github_login}，但 token 可能已失效\n💡 请使用 /github bind 重新授权`;
          }

          const u = userRes.data;
          return [
            `🔗 GitHub 账号已绑定`,
            `👤 ${u.login}${u.name ? ` (${u.name})` : ''}`,
            `🔑 授权范围: ${existing.scope || 'N/A'}`,
            `📅 绑定时间: ${new Date(existing.created_at).toLocaleDateString()}`,
          ].join('\n');
        }),
    );

    // --- GitHub Star (用户级操作) ---
    this.addTool(
      new ZhinTool('github.star')
        .desc('Star / Unstar 一个仓库（使用你的 GitHub 账号）')
        .keyword('star', 'unstar', '收藏', '取消收藏')
        .tag('github', 'user')
        .param('repo', { type: 'string', description: 'owner/repo (必填)' }, true)
        .param('unstar', { type: 'boolean', description: '设为 true 则取消 star' })
        .execute(async (args, ctx) => {
          if (!ctx?.message) return '❌ 无法获取消息上下文';
          const msg = ctx.message as Message;
          const repo = args.repo as string;
          if (!repo.includes('/')) return '❌ 格式应为 owner/repo';

          const oauthClient = await this.getOAuthClient(msg.$adapter, msg.$sender.id);
          if (!oauthClient) {
            return '❌ 你还没有绑定 GitHub 账号，star 需要使用你自己的身份\n💡 使用 /github bind 绑定';
          }

          if (args.unstar) {
            const r = await oauthClient.unstarRepo(repo);
            return r.ok || r.status === 204 ? `✅ 已取消 star: ${repo}` : `❌ 操作失败: ${JSON.stringify(r.data)}`;
          } else {
            const r = await oauthClient.starRepo(repo);
            return r.ok || r.status === 204 ? `⭐ 已 star: ${repo}` : `❌ 操作失败: ${JSON.stringify(r.data)}`;
          }
        }),
    );

    // --- GitHub Fork (用户级操作) ---
    this.addTool(
      new ZhinTool('github.fork')
        .desc('Fork 一个仓库到你的 GitHub 账号')
        .keyword('fork', '复刻')
        .tag('github', 'user')
        .param('repo', { type: 'string', description: 'owner/repo (必填)' }, true)
        .execute(async (args, ctx) => {
          if (!ctx?.message) return '❌ 无法获取消息上下文';
          const msg = ctx.message as Message;
          const repo = args.repo as string;
          if (!repo.includes('/')) return '❌ 格式应为 owner/repo';

          const oauthClient = await this.getOAuthClient(msg.$adapter, msg.$sender.id);
          if (!oauthClient) {
            return '❌ 你还没有绑定 GitHub 账号，fork 需要使用你自己的身份\n💡 使用 /github bind 绑定';
          }

          const r = await oauthClient.forkRepo(repo);
          return r.ok ? `🍴 已 fork: ${r.data.full_name}\n🔗 ${r.data.html_url}` : `❌ 操作失败: ${r.data?.message || JSON.stringify(r.data)}`;
        }),
    );

    // --- Search ---
    this.addTool(
      new ZhinTool('github.search')
        .desc('GitHub 搜索：在 issues/repos/code 中搜索')
        .keyword('search', '搜索', '查找', 'github search')
        .tag('github', 'search')
        .param('action', { type: 'string', description: 'issues|repos|code', enum: ['issues', 'repos', 'code'] }, true)
        .param('query', { type: 'string', description: '搜索关键词' }, true)
        .param('limit', { type: 'number', description: '返回数量，默认 10' })
        .execute(async (args) => {
          const api = this.getAPI();
          if (!api) return '❌ 没有可用的 GitHub bot';
          const q = args.query as string;
          const limit = (args.limit as number) || 10;

          switch (args.action) {
            case 'issues': {
              const r = await api.searchIssues(q, limit);
              if (!r.ok) return `❌ ${JSON.stringify(r.data)}`;
              if (!r.data.items.length) return `📭 没有匹配的 Issue/PR`;
              return `🔍 共 ${r.data.total_count} 条，显示前 ${r.data.items.length}:\n\n` +
                r.data.items.map((i: any) =>
                  `${i.pull_request ? '🔀' : '🐛'} ${i.repository_url.replace('https://api.github.com/repos/', '')}#${i.number}\n   ${i.title}\n   👤 ${i.user.login} | ${i.state}`
                ).join('\n\n');
            }
            case 'repos': {
              const r = await api.searchRepos(q, limit);
              if (!r.ok) return `❌ ${JSON.stringify(r.data)}`;
              if (!r.data.items.length) return `📭 没有匹配的仓库`;
              return `🔍 共 ${r.data.total_count} 条，显示前 ${r.data.items.length}:\n\n` +
                r.data.items.map((repo: any) =>
                  `📦 ${repo.full_name}${repo.private ? ' 🔒' : ''}\n   ${repo.description || '(无描述)'}\n   ⭐ ${repo.stargazers_count} | 🍴 ${repo.forks_count} | 📝 ${repo.language || '?'}`
                ).join('\n\n');
            }
            case 'code': {
              const r = await api.searchCode(q, limit);
              if (!r.ok) return `❌ ${JSON.stringify(r.data)}`;
              if (!r.data.items.length) return `📭 没有匹配的代码`;
              return `🔍 共 ${r.data.total_count} 条，显示前 ${r.data.items.length}:\n\n` +
                r.data.items.map((c: any) =>
                  `📄 ${c.repository.full_name}/${c.path}\n   🔗 ${c.html_url}`
                ).join('\n\n');
            }
            default: return `❌ 未知搜索类型: ${args.action}`;
          }
        }),
    );

    // --- Label ---
    this.addTool(
      new ZhinTool('github.label')
        .desc('GitHub 标签管理：查看/添加/移除 Issue/PR 标签')
        .keyword('label', '标签', 'tag')
        .tag('github', 'label')
        .param('action', { type: 'string', description: 'list|add|remove', enum: ['list', 'add', 'remove'] }, true)
        .param('repo', { type: 'string', description: 'owner/repo (必填)' }, true)
        .param('number', { type: 'number', description: 'Issue/PR 编号 (add/remove 必填)' })
        .param('labels', { type: 'string', description: '标签名，逗号分隔 (add/remove)' })
        .execute(async (args) => {
          const api = this.getAPI();
          if (!api) return '❌ 没有可用的 GitHub bot';
          const repo = args.repo as string;

          switch (args.action) {
            case 'list': {
              const r = await api.listLabels(repo);
              if (!r.ok) return `❌ ${JSON.stringify(r.data)}`;
              if (!r.data.length) return `📭 仓库没有标签`;
              return `🏷️ ${repo} 标签 (${r.data.length}):\n` +
                r.data.map((l: any) => `  • ${l.name}${l.description ? ` — ${l.description}` : ''}`).join('\n');
            }
            case 'add': {
              if (!args.number) return '❌ 请提供 Issue/PR 编号';
              if (!args.labels) return '❌ 请提供标签名';
              const labels = (args.labels as string).split(',').map(s => s.trim());
              const r = await api.addLabels(repo, args.number as number, labels);
              return r.ok ? `✅ 已添加标签: ${labels.join(', ')}` : `❌ ${JSON.stringify(r.data)}`;
            }
            case 'remove': {
              if (!args.number) return '❌ 请提供 Issue/PR 编号';
              if (!args.labels) return '❌ 请提供要移除的标签名';
              const labels = (args.labels as string).split(',').map(s => s.trim());
              const results: string[] = [];
              for (const label of labels) {
                const r = await api.removeLabel(repo, args.number as number, label);
                results.push(r.ok ? `✅ ${label}` : `❌ ${label}: ${r.data?.message || 'failed'}`);
              }
              return results.join('\n');
            }
            default: return `❌ 未知操作: ${args.action}`;
          }
        }),
    );

    // --- Assign ---
    this.addTool(
      new ZhinTool('github.assign')
        .desc('GitHub 指派管理：给 Issue/PR 添加/移除指派人')
        .keyword('assign', '指派', '分配')
        .tag('github', 'assign')
        .param('action', { type: 'string', description: 'add|remove', enum: ['add', 'remove'] }, true)
        .param('repo', { type: 'string', description: 'owner/repo (必填)' }, true)
        .param('number', { type: 'number', description: 'Issue/PR 编号 (必填)' }, true)
        .param('assignees', { type: 'string', description: '用户名，逗号分隔 (必填)' }, true)
        .execute(async (args) => {
          const api = this.getAPI();
          if (!api) return '❌ 没有可用的 GitHub bot';
          const repo = args.repo as string;
          const num = args.number as number;
          const assignees = (args.assignees as string).split(',').map(s => s.trim());

          if (args.action === 'add') {
            const r = await api.addAssignees(repo, num, assignees);
            return r.ok ? `✅ 已指派: ${assignees.join(', ')}` : `❌ ${r.data?.message || JSON.stringify(r.data)}`;
          } else {
            const r = await api.removeAssignees(repo, num, assignees);
            return r.ok ? `✅ 已移除指派: ${assignees.join(', ')}` : `❌ ${r.data?.message || JSON.stringify(r.data)}`;
          }
        }),
    );

    // --- File ---
    this.addTool(
      new ZhinTool('github.file')
        .desc('读取 GitHub 仓库中的文件内容')
        .keyword('file', '文件', '查看文件', '读取文件', 'cat')
        .tag('github', 'file')
        .param('repo', { type: 'string', description: 'owner/repo (必填)' }, true)
        .param('path', { type: 'string', description: '文件路径 (必填)' }, true)
        .param('ref', { type: 'string', description: '分支/tag/commit SHA (可选，默认主分支)' })
        .execute(async (args) => {
          const api = this.getAPI();
          if (!api) return '❌ 没有可用的 GitHub bot';
          const r = await api.getFileContent(args.repo as string, args.path as string, args.ref as string | undefined);
          if (!r.ok) return `❌ ${r.data?.message || JSON.stringify(r.data)}`;

          if (Array.isArray(r.data)) {
            return `📂 ${args.path} (目录，${r.data.length} 项):\n` +
              r.data.map((f: any) => `  ${f.type === 'dir' ? '📁' : '📄'} ${f.name}`).join('\n');
          }

          if (r.data.type === 'file' && r.data.content) {
            const decoded = Buffer.from(r.data.content, 'base64').toString('utf-8');
            const maxLen = 3000;
            const truncated = decoded.length > maxLen;
            return `📄 ${r.data.path} (${r.data.size} bytes)\n\n${decoded.slice(0, maxLen)}${truncated ? `\n\n... (截断，共 ${decoded.length} 字符)` : ''}`;
          }

          return `📄 ${r.data.path} — ${r.data.type} (${r.data.size} bytes)\n🔗 ${r.data.html_url}`;
        }),
    );

    // --- Commits ---
    this.addTool(
      new ZhinTool('github.commits')
        .desc('GitHub 提交查询：列出提交记录或对比两个分支')
        .keyword('commit', '提交', '历史', 'log', 'compare', '对比')
        .tag('github', 'commits')
        .param('action', { type: 'string', description: 'list|compare', enum: ['list', 'compare'] }, true)
        .param('repo', { type: 'string', description: 'owner/repo (必填)' }, true)
        .param('sha', { type: 'string', description: '分支/SHA (list)' })
        .param('path', { type: 'string', description: '按文件路径过滤 (list)' })
        .param('base', { type: 'string', description: '基准分支 (compare)' })
        .param('head', { type: 'string', description: '目标分支 (compare)' })
        .param('limit', { type: 'number', description: '返回数量，默认 10' })
        .execute(async (args) => {
          const api = this.getAPI();
          if (!api) return '❌ 没有可用的 GitHub bot';
          const repo = args.repo as string;

          if (args.action === 'list') {
            const r = await api.listCommits(repo, args.sha as string | undefined, args.path as string | undefined, (args.limit as number) || 10);
            if (!r.ok) return `❌ ${JSON.stringify(r.data)}`;
            if (!r.data.length) return '📭 没有找到提交记录';
            return r.data.map((c: any) =>
              `• ${c.sha.substring(0, 7)} ${c.commit.message.split('\n')[0]}\n  👤 ${c.commit.author?.name || '?'} | 📅 ${c.commit.author?.date?.split('T')[0] || '?'}`
            ).join('\n\n');
          } else {
            if (!args.base || !args.head) return '❌ compare 需要 base 和 head 参数';
            const r = await api.compareCommits(repo, args.base as string, args.head as string);
            if (!r.ok) return `❌ ${r.data?.message || JSON.stringify(r.data)}`;
            const d = r.data;
            return [
              `🔀 ${args.base} ← ${args.head}`,
              `📊 ${d.status} | ${d.ahead_by} ahead, ${d.behind_by} behind`,
              `📝 ${d.total_commits} commits | ${d.files?.length || 0} files changed`,
              d.commits?.length ? '\n最近提交:\n' + d.commits.slice(0, 5).map((c: any) =>
                `  • ${c.sha.substring(0, 7)} ${c.commit.message.split('\n')[0]}`
              ).join('\n') : '',
            ].filter(Boolean).join('\n');
          }
        }),
    );

    // --- Edit (Issue/PR) ---
    this.addTool(
      new ZhinTool('github.edit')
        .desc('编辑 GitHub Issue 或 PR 的标题、正文、状态')
        .keyword('edit', '编辑', '修改', 'update', '更新')
        .tag('github', 'edit')
        .param('type', { type: 'string', description: 'issue|pr', enum: ['issue', 'pr'] }, true)
        .param('repo', { type: 'string', description: 'owner/repo (必填)' }, true)
        .param('number', { type: 'number', description: 'Issue/PR 编号 (必填)' }, true)
        .param('title', { type: 'string', description: '新标题' })
        .param('body', { type: 'string', description: '新正文' })
        .param('state', { type: 'string', description: 'open|closed' })
        .execute(async (args) => {
          const api = this.getAPI();
          if (!api) return '❌ 没有可用的 GitHub bot';
          const repo = args.repo as string;
          const num = args.number as number;

          const data: any = {};
          if (args.title) data.title = args.title;
          if (args.body) data.body = args.body;
          if (args.state) data.state = args.state;

          if (!Object.keys(data).length) return '❌ 请至少提供一个要修改的字段 (title/body/state)';

          const r = args.type === 'pr'
            ? await api.updatePR(repo, num, data)
            : await api.updateIssue(repo, num, data);

          if (!r.ok) return `❌ ${r.data?.message || JSON.stringify(r.data)}`;
          return `✅ ${args.type === 'pr' ? 'PR' : 'Issue'} #${num} 已更新\n🔗 ${r.data.html_url}`;
        }),
    );

    logger.debug('GitHub 工具已注册: pr, issue, repo, search, label, assign, file, commits, edit, subscribe, unsubscribe, subscriptions, bind, unbind, whoami, star, fork');
  }


  // ── 通知推送 ───────────────────────────────────────────────────────

  async dispatchNotification(eventName: string, payload: GenericWebhookPayload): Promise<void> {
    let eventType: EventType | null = null;
    switch (eventName) {
      case 'push': eventType = 'push'; break;
      case 'issues': eventType = 'issue'; break;
      case 'star': eventType = payload.action === 'deleted' ? 'unstar' : 'star'; break;
      case 'fork': eventType = 'fork'; break;
      case 'pull_request': eventType = 'pull_request'; break;
    }
    if (!eventType) {
      logger.debug(`dispatchNotification: 未知事件 ${eventName}，跳过`);
      return;
    }

    const repo = payload.repository.full_name;
    const db = root.inject('database') as any;
    const model = db?.models?.get('github_subscriptions');
    if (!model) {
      logger.warn('dispatchNotification: 数据库模型 github_subscriptions 未就绪');
      return;
    }

    const subs = await model.select().where({ repo });
    logger.debug(`dispatchNotification: ${repo} ${eventName}(${eventType}) — 找到 ${subs?.length || 0} 条订阅`);
    if (!subs?.length) return;

    const text = formatNotification(eventName, payload);
    for (const sub of subs) {
      const s = sub as Subscription;
      const events = safeParseEvents(s.events);
      if (!events.includes(eventType)) {
        logger.debug(`dispatchNotification: ${s.adapter}:${s.target_id} 未订阅 ${eventType}，跳过`);
        continue;
      }
      try {
        const adapter = root.inject(s.adapter as any) as any;
        if (!adapter?.sendMessage) {
          logger.warn(`dispatchNotification: 适配器 ${s.adapter} 不存在或无 sendMessage 方法`);
          continue;
        }
        logger.info(`dispatchNotification: 推送 ${eventType} → ${s.adapter}:${s.bot}:${s.target_id}`);
        await adapter.sendMessage({ context: s.adapter, bot: s.bot, id: s.target_id, type: s.target_type, content: text });
      } catch (e) {
        logger.error(`通知推送失败 → ${s.adapter}:${s.target_id}`, e);
      }
    }
  }
}

// ── 工具函数 ─────────────────────────────────────────────────────────

function parseMarkdown(md: string): MessageSegment[] {
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

function toMarkdown(content: SendContent): string {
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

function formatNotification(event: string, p: GenericWebhookPayload): string {
  const repo = p.repository.full_name;
  const sender = p.sender.login;
  switch (event) {
    case 'push': {
      const branch = p.ref?.replace('refs/heads/', '') || '?';
      const commits = p.commits || [];
      let msg = `📦 ${repo}\n🌿 ${sender} pushed to ${branch}\n\n`;
      if (commits.length) {
        msg += `📝 ${commits.length} commit(s):\n`;
        msg += commits.slice(0, 3).map(c => `  • ${c.id.substring(0, 7)} ${c.message.split('\n')[0]}`).join('\n');
        if (commits.length > 3) msg += `\n  ... +${commits.length - 3} more`;
      }
      return msg;
    }
    case 'issues': {
      const i = p.issue!;
      const act = p.action === 'opened' ? 'opened' : p.action === 'closed' ? 'closed' : 'updated';
      return `🐛 ${repo}\n👤 ${sender} ${act} issue #${i.number}\n📌 ${i.title}`;
    }
    case 'star': {
      const starred = p.action !== 'deleted';
      return `${starred ? '⭐' : '💔'} ${repo}\n👤 ${sender} ${starred ? 'starred' : 'unstarred'}`;
    }
    case 'fork':
      return `🍴 ${repo}\n👤 ${sender} forked → ${p.forkee!.full_name}`;
    case 'pull_request': {
      const pr = p.pull_request!;
      const act = p.action === 'opened' ? 'opened' : p.action === 'closed' ? 'closed' : 'updated';
      return `🔀 ${repo}\n👤 ${sender} ${act} PR #${pr.number}\n📌 ${pr.title}`;
    }
    default:
      return `📬 ${repo}\n${event} by ${sender}`;
  }
}

// ============================================================================
// 注册适配器
// ============================================================================

provide({
  name: 'github',
  description: 'GitHub Adapter — Issues/PRs as chat channels, full repo management via GitHub App',
  mounted: async (p) => {
    const adapter = new GitHubAdapter(p);
    await adapter.start();
    return adapter;
  },
  dispose: async (adapter) => {
    await adapter.stop();
  },
});

useContext('router', 'github', (router, adapter: GitHubAdapter) => {
  adapter.setupWebhook(router);
  adapter.setupOAuth(router);
});

logger.debug('GitHub 适配器已加载 (GitHub App 认证)');
