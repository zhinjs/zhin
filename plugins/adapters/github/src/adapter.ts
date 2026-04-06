/**
 * GitHub 适配器
 */
import crypto from 'node:crypto';
import {
  Adapter,
  Plugin,
  Message,
} from 'zhin.js';
import { GitHubBot } from './bot.js';
import type { GitHubBotConfig, EventType, GenericWebhookPayload, Subscription } from './types.js';
import { GitHubAPI, GitHubOAuthClient, exchangeOAuthCode } from './api.js';
import type { IssueCommentPayload, PRReviewCommentPayload, PRReviewPayload } from './types.js';

const VALID_EVENTS: EventType[] = ['push', 'issue', 'star', 'fork', 'unstar', 'pull_request'];

function safeParseEvents(raw: any): EventType[] {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try { const parsed = JSON.parse(raw); if (Array.isArray(parsed)) return parsed; } catch {}
  }
  return [];
}

const oauthStates = new Map<string, { platform: string; platformUid: string; expires: number }>();
const OAUTH_STATE_TTL = 5 * 60 * 1000;

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

export class GitHubAdapter extends Adapter<GitHubBot> {
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
    await super.start();
  }

  /** 获取第一个可用 bot 的 API (工具用) */
  getAPI(): GitHubAPI | null {
    const bot = this.bots.values().next().value as GitHubBot | undefined;
    return bot?.api || null;
  }

  // ── OAuth 用户查询 ─────────────────────────────────────────────────

  async getOAuthClient(platform: string, platformUid: string): Promise<GitHubOAuthClient | null> {
    const db = this.plugin.root?.inject('database') as any;
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
        const db = this.plugin.root?.inject('database') as any;
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

        this.plugin.logger.info(`OAuth 绑定成功: ${pending.platform}:${pending.platformUid} → ${ghUser.login}`);

        ctx.type = 'text/html';
        ctx.body = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>绑定成功</title><style>body{font-family:system-ui;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#f5f5f5}div{text-align:center;background:#fff;padding:3rem;border-radius:12px;box-shadow:0 2px 12px rgba(0,0,0,.1)}h1{color:#28a745;margin-bottom:.5rem}p{color:#666}</style></head><body><div><h1>GitHub 账号绑定成功</h1><p>已绑定 GitHub 用户: <strong>${ghUser.login}</strong></p><p>你现在可以关闭这个页面，回到聊天中使用 GitHub 功能了。</p></div></body></html>`;
      } catch (err: any) {
        this.plugin.logger.error('OAuth callback 失败:', err);
        ctx.status = 500;
        ctx.body = `OAuth failed: ${err.message}`;
      }
    });

    this.plugin.logger.debug('GitHub OAuth: GET /pub/github/oauth, GET /pub/github/oauth/callback');
  }

  // ── Webhook 路由 (由 useContext('router') 注入) ────────────────────

  setupWebhook(router: import('@zhin.js/http').Router): void {
    router.post('/pub/github/webhook', async (ctx: any) => {
      try {
        const eventName = ctx.request.headers['x-github-event'] as string;
        const signature = ctx.request.headers['x-hub-signature-256'] as string;
        const payload = ctx.request.body;

        this.plugin.logger.info(`GitHub Webhook: ${eventName} - ${payload?.repository?.full_name || '(no repo)'}`);

        if (eventName === 'ping') {
          this.plugin.logger.info(`GitHub Webhook ping OK — hook_id: ${payload?.hook_id}, zen: ${payload?.zen}`);
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
              this.plugin.logger.warn('GitHub Webhook 签名验证失败');
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

        const db = this.plugin.root?.inject('database') as any;
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
              this.plugin.logger.debug(`忽略 bot 自身评论: ${message.$sender.id}`);
            } else {
              this.emit('message.receive', message);
            }
          }
        }

        await this.dispatchNotification(eventName, payload);

        ctx.status = 200;
        ctx.body = { message: 'OK' };
      } catch (error) {
        this.plugin.logger.error('Webhook 处理失败:', error);
        ctx.status = 500;
        ctx.body = { error: 'Internal server error' };
      }
    });

    this.plugin.logger.debug('GitHub Webhook: POST /pub/github/webhook');
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
    const db = this.plugin.root?.inject('database') as any;
    const model = db?.models?.get('github_subscriptions');
    if (!model) {
      this.plugin.logger.warn('dispatchNotification: 数据库模型 github_subscriptions 未就绪');
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
        const adapter = this.plugin.root?.inject(s.adapter as any) as any;
        if (!adapter?.sendMessage) {
          this.plugin.logger.warn(`dispatchNotification: 适配器 ${s.adapter} 不存在或无 sendMessage 方法`);
          continue;
        }
        this.plugin.logger.info(`dispatchNotification: 推送 ${eventType} → ${s.adapter}:${s.bot}:${s.target_id}`);
        await adapter.sendMessage({ context: s.adapter, bot: s.bot, id: s.target_id, type: s.target_type, content: text });
      } catch (e) {
        this.plugin.logger.error(`通知推送失败 → ${s.adapter}:${s.target_id}`, e);
      }
    }
  }
}
