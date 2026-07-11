/**
 * GitHub 适配器（基于 gh CLI + App 认证 + Webhook/轮询混合）
 */
import { formatCompact, Adapter, Message, Plugin, OUTBOUND_RICH_SEGMENT_POLICY_TEXT_ONLY } from 'zhin.js';
import crypto from 'node:crypto';
import { GitHubEndpoint } from './endpoint.js';
import type { Router } from '@zhin.js/host-router';
import { type GitHubEndpointConfig, type EventType, type GenericWebhookPayload, type Subscription, type IssueCommentPayload, type PRReviewCommentPayload, type PRReviewPayload } from './types.js';
import type { GhClient } from './gh-client.js';

const VALID_EVENTS: EventType[] = ['push', 'issue', 'star', 'fork', 'unstar', 'pull_request'];

function safeParseEvents(raw: any): EventType[] {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try { const parsed = JSON.parse(raw); if (Array.isArray(parsed)) return parsed; } catch {}
  }
  return [];
}

function formatNotification(event: string, p: GenericWebhookPayload): string {
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
        msg += commits.slice(0, 5).map(c =>
          `  • [\`${c.id.substring(0, 7)}\`](${repoUrl}/commit/${c.id}) ${c.message.split('\n')[0]}`
        ).join('\n');
        if (commits.length > 5) msg += `\n  ... +${commits.length - 5} more`;
      }
      if (compareUrl) msg += `\n\n🔗 ${compareUrl}`;
      return msg;
    }
    case 'issues': {
      const i = p.issue!;
      const act = p.action === 'opened' ? '📝 opened' : p.action === 'closed' ? '✅ closed' : `🔄 ${p.action || 'updated'}`;
      let msg = `🐛 ${repo}\n👤 ${sender} ${act} issue #${i.number}\n📌 ${i.title}`;
      msg += `\n🔗 ${i.html_url}`;
      return msg;
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
      let msg = `🔀 ${repo}\n👤 ${sender} ${act} PR #${pr.number}\n📌 ${pr.title}`;
      msg += `\n🌿 ${pr.head.ref} → ${pr.base.ref}`;
      msg += `\n🔗 ${pr.html_url}`;
      return msg;
    }
    default:
      return `📬 ${repo}\n📡 ${event}${p.action ? ` (${p.action})` : ''} by ${sender}\n🔗 ${repoUrl}`;
  }
}

export class GitHubAdapter extends Adapter<GitHubEndpoint> {
  static override readonly capabilities = ['inbound', 'outbound'] as const;
  static override outboundRichSegmentPolicy = OUTBOUND_RICH_SEGMENT_POLICY_TEXT_ONLY;
  static override interactivePolicy = 'text' as const;

  /** 轮询定时器 */
  private _pollTimer: ReturnType<typeof setInterval> | null = null;
  /** 每个 repo 的 ETag 缓存 */
  private _etags = new Map<string, string>();
  /** 每个 repo 最后处理的事件 ID（防重复） */
  private _lastEventIds = new Map<string, string>();
  /** Webhook 是否已激活 */
  private _webhookActive = false;

  constructor(plugin: Plugin) {
    super(plugin, 'github', []);
  }

  createEndpoint(config: GitHubEndpointConfig): GitHubEndpoint {
    return new GitHubEndpoint(this, config);
  }

  async start(): Promise<void> {
    await super.start();
  }

  async stop(): Promise<void> {
    this.stopPolling();
    await super.stop();
  }

  /** 获取第一个可用 Endpoint 的 GhClient (工具用) */
  getAPI(): GhClient | null {
    const endpoint = this.endpoints.values().next().value as GitHubEndpoint | undefined;
    return endpoint?.gh || null;
  }

  /** 获取指定用户绑定的 GhClient；未绑定则返回 null */
  async getUserAPI(platform: string, platformUid: string): Promise<GhClient | null> {
    const db = this.plugin.root?.inject('database');
    const model = db?.models?.get('github_oauth_users');
    if (!model) return null;
    const [record] = await model.select().where({ platform, platform_uid: platformUid });
    if (!record?.access_token) return null;
    const base = this.getAPI();
    if (!base) return null;
    return base.withToken(record.access_token);
  }

  /** 获取用户 API，若未绑定则降级为 Endpoint 默认的 API */
  async getUserOrDefaultAPI(platform?: string, platformUid?: string): Promise<GhClient | null> {
    if (platform && platformUid) {
      const userApi = await this.getUserAPI(platform, platformUid);
      if (userApi) return userApi;
    }
    return this.getAPI();
  }

  /** 获取第一个 Endpoint 的 client_id（App 认证时从 /app 自动获取） */
  getClientId(): string | null {
    const endpoint = this.endpoints.values().next().value as GitHubEndpoint | undefined;
    return endpoint?.gh.clientId || null;
  }

  /** 获取第一个 Endpoint 的 host 配置 */
  getHost(): string | undefined {
    const endpoint = this.endpoints.values().next().value as GitHubEndpoint | undefined;
    return endpoint?.$config.host;
  }

  /** 获取 App slug（用于生成安装链接） */
  getAppSlug(): string | null {
    const endpoint = this.endpoints.values().next().value as GitHubEndpoint | undefined;
    return endpoint?.gh.appSlug || null;
  }

  /** 获取所有已发现的安装信息 */
  getInstallations() {
    const endpoint = this.endpoints.values().next().value as GitHubEndpoint | undefined;
    return endpoint?.gh.installations || [];
  }

  /** 第一个 Endpoint 是否配置了 Webhook */
  get hasWebhookConfig(): boolean {
    const endpoint = this.endpoints.values().next().value as GitHubEndpoint | undefined;
    return !!endpoint?.$config.webhook_secret;
  }

  /** Webhook 是否已激活 */
  get webhookActive(): boolean {
    return this._webhookActive;
  }

  // ── Webhook ──────────────────────────────────────────────────────

  /** 在 router 上挂载 Webhook 路由（生产环境推荐） */
  setupWebhook(router: Router): void {
    const endpoint = this.endpoints.values().next().value as GitHubEndpoint | undefined;
    if (!endpoint?.$config.webhook_secret) {
      this.plugin.logger.warn(formatCompact( { op: 'webhook', ok: false, error: 'missing webhook_secret' }));
      return;
    }
    const secret = endpoint.$config.webhook_secret;
    const path = endpoint.$config.webhook_path || '/github/webhook';

    router.post(path, async (ctx) => {
      const signature = ctx.get('x-hub-signature-256') as string;
      const event = ctx.get('x-github-event') as string;
      const deliveryId = ctx.get('x-github-delivery') as string;

      if (!signature || !event) {
        ctx.status = 400;
        ctx.body = { error: 'Missing signature or event header' };
        return;
      }

      // HMAC-SHA256 签名验证
      const body = (ctx.request as any).rawBody || JSON.stringify((ctx.request as any).body);
      const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex');
      if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
        this.plugin.logger.warn(formatCompact( { op: 'webhook', ok: false, error: 'invalid signature', delivery: deliveryId }));
        ctx.status = 401;
        ctx.body = { error: 'Invalid signature' };
        return;
      }

      const payload = (ctx.request as any).body;
      ctx.status = 200;
      ctx.body = { ok: true };

      // 异步处理事件，不阻塞响应
      this.handleWebhookPayload(event, payload).catch(e =>
        this.plugin.logger.error(`Webhook 事件处理失败 (${event}):`, e)
      );
    });

    this._webhookActive = true;
    this.plugin.logger.debug(formatCompact( { op: 'webhook', path }));
  }

  /** 处理 Webhook 推送的事件 */
  async handleWebhookPayload(event: string, payload: any): Promise<void> {
    const endpoint = this.endpoints.values().next().value as GitHubEndpoint | undefined;
    const repo = payload.repository?.full_name;

    this.plugin.logger.debug(`Webhook: ${event}${payload.action ? `.${payload.action}` : ''} ${repo || ''}`);

    // 记录事件到数据库
    if (repo) {
      const db = this.plugin.root?.inject('database');
      const eventsModel = db?.models?.get('github_events');
      if (eventsModel) {
        await eventsModel.insert({ id: Date.now(), repo, event_type: event, payload }).catch(() => {});
      }
    }

    // 处理消息类事件（Issue/PR 评论）
    if (endpoint && event === 'issue_comment' && payload.action === 'created' && payload.comment) {
      const message = endpoint.$formatMessage(payload as IssueCommentPayload);
      const botUser = endpoint.gh.authenticatedUser;
      if (!(botUser && message.$sender.id === botUser)) {
        this.emit('message.receive', message);
      }
    }

    if (endpoint && event === 'pull_request_review_comment' && payload.action === 'created' && payload.comment) {
      const message = endpoint.formatPRReviewComment(payload as PRReviewCommentPayload);
      const botUser = endpoint.gh.authenticatedUser;
      if (!(botUser && message.$sender.id === botUser)) {
        this.emit('message.receive', message);
      }
    }

    if (endpoint && event === 'pull_request_review' && payload.action === 'submitted') {
      const message = endpoint.formatPRReview(payload as PRReviewPayload);
      if (message) {
        const botUser = endpoint.gh.authenticatedUser;
        if (!(botUser && message.$sender.id === botUser)) {
          this.emit('message.receive', message);
        }
      }
    }

    // 通知订阅者
    if (repo) {
      const genericPayload: GenericWebhookPayload = {
        action: payload.action,
        repository: payload.repository,
        sender: payload.sender,
        ref: payload.ref,
        commits: payload.commits,
        issue: payload.issue,
        pull_request: payload.pull_request,
        forkee: payload.forkee,
      };
      await this.dispatchNotification(event, genericPayload);
    }
  }

  // ── 事件轮询 ────────────────────────────────────────────────────

  /** 启动事件轮询 */
  startPolling(): void {
    if (this._pollTimer) return;
    const endpoint = this.endpoints.values().next().value as GitHubEndpoint | undefined;
    const interval = (endpoint?.$config.poll_interval || 60) * 1000;
    this.plugin.logger.debug(formatCompact( { op: 'poll', interval_s: interval / 1000 }));

    // 立即执行一次
    this.pollAllRepos().catch(e => this.plugin.logger.error('轮询失败:', e));

    this._pollTimer = setInterval(() => {
      this.pollAllRepos().catch(e => this.plugin.logger.error('轮询失败:', e));
    }, interval);
  }

  /** 停止事件轮询 */
  stopPolling(): void {
    if (this._pollTimer) {
      clearInterval(this._pollTimer);
      this._pollTimer = null;
      this.plugin.logger.debug('GitHub 事件轮询已停止');
    }
  }

  /** 轮询所有已订阅仓库的事件 */
  private async pollAllRepos(): Promise<void> {
    const db = this.plugin.root?.inject('database');
    const model = db?.models?.get('github_subscriptions');
    if (!model) return;

    // 获取所有不重复的订阅仓库
    const allSubs = await model.select();
    const repos = [...new Set((allSubs || []).map((s: Subscription) => s.repo))] as string[];
    if (!repos.length) return;

    const gh = this.getAPI();
    if (!gh) return;

    for (const repo of repos) {
      try {
        await this.pollRepoEvents(repo, gh);
      } catch (e) {
        this.plugin.logger.warn(formatCompact( { op: 'poll', repo, ok: false, error: String(e) }));
      }
    }
  }

  /** 轮询单个仓库的事件 */
  private async pollRepoEvents(repo: string, gh: GhClient): Promise<void> {
    const etag = this._etags.get(repo);
    const { events, etag: newEtag } = await gh.listRepoEvents(repo, etag);
    if (newEtag) this._etags.set(repo, newEtag);
    if (!events.length) return;

    const lastId = this._lastEventIds.get(repo);
    const newEvents: any[] = [];
    for (const ev of events) {
      if (ev.id === lastId) break;
      newEvents.push(ev);
    }
    if (!newEvents.length) return;

    // 记录最新事件 ID
    this._lastEventIds.set(repo, events[0].id);

    // 首次轮询只记录位置，不触发通知（避免启动时大量回溯）
    if (!lastId) {
      this.plugin.logger.debug(`${repo}: 首次轮询，记录位置 (${events[0].id})，跳过 ${events.length} 条历史事件`);
      return;
    }

    this.plugin.logger.debug(`${repo}: ${newEvents.length} 条新事件`);

    const endpoint = this.endpoints.values().next().value as GitHubEndpoint | undefined;

    // 按时间正序处理（API 返回倒序）
    for (const ev of newEvents.reverse()) {
      const eventName = this.mapEventType(ev.type);
      if (!eventName) continue;

      // 构造与 webhook payload 兼容的结构
      const payload: GenericWebhookPayload = {
        action: ev.payload?.action,
        repository: ev.repo ? { full_name: ev.repo.name, html_url: `https://github.com/${ev.repo.name}`, description: '' } : ev.payload?.repository,
        sender: { login: ev.actor?.login || '?', id: ev.actor?.id || 0, html_url: `https://github.com/${ev.actor?.login}` },
        ref: ev.payload?.ref,
        commits: ev.payload?.commits,
        issue: ev.payload?.issue,
        pull_request: ev.payload?.pull_request,
        forkee: ev.payload?.forkee,
      };

      // 记录事件到数据库
      const db = this.plugin.root?.inject('database');
      const eventsModel = db?.models?.get('github_events');
      if (eventsModel) {
        await eventsModel.insert({ id: Date.now(), repo, event_type: eventName, payload: ev.payload }).catch(() => {});
      }

      // 处理消息类事件（Issue/PR 评论）
      if (endpoint && eventName === 'issue_comment' && ev.payload?.action === 'created' && ev.payload?.comment) {
        const message = endpoint.$formatMessage(ev.payload as IssueCommentPayload);
        const botUser = endpoint.gh.authenticatedUser;
        if (!(botUser && message.$sender.id === botUser)) {
          this.emit('message.receive', message);
        }
      }

      // 通知订阅者
      await this.dispatchNotification(eventName, payload);
    }
  }

  /** Events API type → webhook event name */
  private mapEventType(type: string): string | null {
    const map: Record<string, string> = {
      PushEvent: 'push',
      IssuesEvent: 'issues',
      WatchEvent: 'star',
      ForkEvent: 'fork',
      PullRequestEvent: 'pull_request',
      IssueCommentEvent: 'issue_comment',
      PullRequestReviewEvent: 'pull_request_review',
      PullRequestReviewCommentEvent: 'pull_request_review_comment',
    };
    return map[type] || null;
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
      this.plugin.logger.debug(`dispatchNotification: 未知事件 ${eventName}，跳过`);
      return;
    }

    const repo = payload.repository.full_name;
    const db = this.plugin.root?.inject('database');
    const model = db?.models?.get('github_subscriptions');
    if (!model) {
      this.plugin.logger.warn(formatCompact( { op: 'notify', ok: false, error: 'subscriptions model not ready' }));
      return;
    }

    const subs = await model.select().where({ repo });
    this.plugin.logger.debug(`dispatchNotification: ${repo} ${eventName}(${eventType}) — 找到 ${subs?.length || 0} 条订阅`);
    if (!subs?.length) return;

    const text = formatNotification(eventName, payload);
    for (const sub of subs) {
      const s = sub as Subscription;
      const events = safeParseEvents(s.events);
      if (!events.includes(eventType)) {
        this.plugin.logger.debug(`dispatchNotification: ${s.adapter}:${s.target_id} 未订阅 ${eventType}，跳过`);
        continue;
      }
      try {
        const targetAdapter = this.plugin.root?.inject(s.adapter as keyof Plugin.Contexts);
        if (!(targetAdapter instanceof Adapter)) {
          this.plugin.logger.warn(formatCompact( { op: 'notify', ok: false, adapter: s.adapter, error: 'no sendMessage' }));
          continue;
        }
        this.plugin.logger.debug(formatCompact( { op: 'notify', event: eventType, adapter: s.adapter, endpoint: s.endpoint, target: s.target_id }));
        await targetAdapter.sendMessage({ context: s.adapter, endpoint: s.endpoint, id: s.target_id, type: s.target_type, content: text });
      } catch (e) {
        this.plugin.logger.error(`通知推送失败 → ${s.adapter}:${s.target_id}`, e);
      }
    }
  }
}
