/**
 * GitHub 适配器入口：类型扩展、模型、导出、注册
 */
import { usePlugin, type Plugin, type Context, type ToolFeature, type Tool, type ToolContext } from 'zhin.js';
import { GitHubAdapter } from './adapter.js';
import { GhClient } from './gh-client.js';
import type { EventType } from './types.js';

declare module 'zhin.js' {
  interface Adapters {
    github: GitHubAdapter;
  }
  namespace Plugin {
    interface Contexts {
      router: import('@zhin.js/http').Router;
    }
  }
  interface Models {
    github_subscriptions: {
      id: number;
      repo: string;
      events: import('./types.js').EventType[];
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
    github_oauth_users: import('./types.js').GitHubOAuthUser;
  }
}

export * from './types.js';
export { GitHubBot, parseMarkdown, toMarkdown } from './bot.js';
export { GitHubAdapter } from './adapter.js';
export { GhClient } from './gh-client.js';

const plugin = usePlugin();
const { provide, defineModel, useContext, logger } = plugin;

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
  access_token: { type: 'text', nullable: false },
  created_at: { type: 'integer', default: 0 },
});

provide({
  name: 'github',
  description: 'GitHub Adapter — Issues/PRs as chat channels, full repo management via gh CLI',
  mounted: async (p: Plugin) => {
    const adapter = new GitHubAdapter(p);
    await adapter.start();
    return adapter;
  },
  dispose: async (adapter: GitHubAdapter) => {
    await adapter.stop();
  },
} as Context<'github'>);

// 混合模式：有 router + webhook_secret → Webhook 实时；否则 → 轮询降级
useContext('github', (adapter) => {
  if (adapter.hasWebhookConfig) {
    // 尝试注册 Webhook（需要 router Context）
    const router = plugin.inject('router');
    if (router) {
      adapter.setupWebhook(router);
      logger.info('GitHub 事件源: Webhook (实时)');
    } else {
      // router 还没就绪，等它挂载后再注册
      plugin.useContext('router', (r) => {
        adapter.setupWebhook(r);
        logger.info('GitHub 事件源: Webhook (实时, 延迟注册)');
      });
    }
  }
  // Webhook 未配置或未激活时，总是启动轮询作为兜底
  if (!adapter.webhookActive) {
    adapter.startPolling();
    logger.info('GitHub 事件源: 轮询');
  }
  return () => adapter.stopPolling();
});

// ── Tool 工具注册 ─────────────────────────────────────────────────────────
useContext('tool', 'github', (toolService: ToolFeature, adapter: GitHubAdapter) => {
  const tools: Tool[] = [
    // --- Star ---
    {
      name: 'github_star',
      description: 'Star 或取消 Star 一个 GitHub 仓库（使用你绑定的 GitHub 账号，未绑定则用 Bot 默认账号）',
      parameters: {
        type: 'object' as const,
        properties: {
          action: { type: 'string' as const, description: 'star|unstar|check', enum: ['star', 'unstar', 'check'] },
          repo: { type: 'string' as const, description: 'owner/repo (必填)' },
        },
        required: ['action', 'repo'],
      },
      platforms: ['github'],
      tags: ['github'],
      execute: async (args: Record<string, any>, context?: ToolContext) => {
        const gh = await adapter.getUserOrDefaultAPI(context?.platform, context?.senderId);
        if (!gh) return '❌ 没有可用的 GitHub bot';
        const { action, repo } = args;
        switch (action) {
          case 'star': {
            const r = await gh.starRepo(repo);
            return r.ok ? `⭐ 已 Star ${repo}` : `❌ ${r.data?.message || JSON.stringify(r.data)}`;
          }
          case 'unstar': {
            const r = await gh.unstarRepo(repo);
            return r.ok ? `💔 已取消 Star ${repo}` : `❌ ${r.data?.message || JSON.stringify(r.data)}`;
          }
          case 'check': {
            const starred = await gh.isStarred(repo);
            return starred ? `⭐ 已 Star ${repo}` : `☆ 尚未 Star ${repo}`;
          }
          default: return `❌ 未知操作: ${action}`;
        }
      },
    },
    // --- Fork ---
    {
      name: 'github_fork',
      description: 'Fork 一个 GitHub 仓库（使用你绑定的 GitHub 账号，未绑定则用 Bot 默认账号）',
      parameters: {
        type: 'object' as const,
        properties: {
          repo: { type: 'string' as const, description: 'owner/repo (必填)' },
        },
        required: ['repo'],
      },
      platforms: ['github'],
      tags: ['github'],
      execute: async (args: Record<string, any>, context?: ToolContext) => {
        const gh = await adapter.getUserOrDefaultAPI(context?.platform, context?.senderId);
        if (!gh) return '❌ 没有可用的 GitHub bot';
        const r = await gh.forkRepo(args.repo);
        if (!r.ok) return `❌ ${r.data?.message || JSON.stringify(r.data)}`;
        return `🍴 已 Fork ${args.repo} → ${r.data.full_name}\n🔗 ${r.data.html_url}`;
      },
    },
    // --- Bind (Device Flow) ---
    {
      name: 'github_bind',
      description: '绑定你的 GitHub 账号 — 使用 Device Flow 授权，无需输入密码',
      parameters: {
        type: 'object' as const,
        properties: {},
      },
      tags: ['github'],
      execute: async (_args: Record<string, any>, context?: ToolContext) => {
        if (!context?.platform || !context?.senderId) {
          return '❌ 无法获取当前用户信息';
        }
        const clientId = adapter.getClientId();
        if (!clientId) return '❌ Bot 未配置 GitHub App 或 App 无 client_id，无法进行账号绑定';

        const db = plugin.root?.inject('database') as any;
        const model = db?.models?.get('github_oauth_users');
        if (!model) return '❌ 数据库未就绪';

        // 检查是否已绑定
        const [existing] = await model.select().where({ platform: context.platform, platform_uid: context.senderId });
        if (existing) {
          return `⚠️ 你已绑定 GitHub 账号: ${existing.github_login}\n如需重新绑定，请先执行 github_unbind`;
        }

        try {
          const host = adapter.getHost();
          const codeResp = await GhClient.deviceFlowRequestCode(clientId, host);
          // 异步轮询 token（最多等 codeResp.expires_in 秒）
          const tokenPromise = GhClient.deviceFlowPollToken(
            clientId, codeResp.device_code, codeResp.interval, codeResp.expires_in, host,
          );

          // 先回复用户授权链接
          const replyMsg = [
            `🔗 请在浏览器中打开以下链接进行授权：`,
            `   ${codeResp.verification_uri}`,
            ``,
            `📋 输入验证码: **${codeResp.user_code}**`,
            ``,
            `⏳ 等待授权中…（${Math.floor(codeResp.expires_in / 60)} 分钟内有效）`,
          ].join('\n');

          // 在后台等待用户授权完成
          tokenPromise.then(async (tokenData) => {
            if (!tokenData) {
              // 授权超时或被拒绝 — 由于 execute 已经返回了，这里只能通过日志记录
              logger.warn(`GitHub Device Flow 超时/拒绝: ${context.platform}:${context.senderId}`);
              return;
            }

            // 使用 token 获取 GitHub 用户名
            const userGh = new GhClient({ host, token: tokenData.access_token });
            const authResult = await userGh.verifyAuth();
            const login = authResult.ok ? authResult.user : 'unknown';

            await model.insert({
              id: Date.now(),
              platform: context.platform,
              platform_uid: context.senderId,
              github_login: login,
              access_token: tokenData.access_token,
              created_at: Date.now(),
            });
            logger.info(`GitHub 账号绑定成功: ${context.platform}:${context.senderId} → ${login}`);

            // 尝试回复绑定成功消息
            if (context.message?.$reply) {
              await context.message.$reply(`✅ GitHub 账号绑定成功！\n👤 ${login}`);
            }
          }).catch(err => {
            logger.error('GitHub Device Flow 错误:', err);
          });

          return replyMsg;
        } catch (e: any) {
          return `❌ Device Flow 启动失败: ${e.message}`;
        }
      },
    },
    // --- Unbind ---
    {
      name: 'github_unbind',
      description: '解除你绑定的 GitHub 账号',
      parameters: {
        type: 'object' as const,
        properties: {},
      },
      tags: ['github'],
      execute: async (_args: Record<string, any>, context?: ToolContext) => {
        if (!context?.platform || !context?.senderId) {
          return '❌ 无法获取当前用户信息';
        }
        const db = plugin.root?.inject('database') as any;
        const model = db?.models?.get('github_oauth_users');
        if (!model) return '❌ 数据库未就绪';

        const [existing] = await model.select().where({ platform: context.platform, platform_uid: context.senderId });
        if (!existing) return '📭 你尚未绑定 GitHub 账号';

        await model.delete().where({ id: existing.id });
        return `✅ 已解除 GitHub 账号绑定: ${existing.github_login}`;
      },
    },
    // --- Whoami ---
    {
      name: 'github_whoami',
      description: '查看你绑定的 GitHub 账号信息',
      parameters: {
        type: 'object' as const,
        properties: {},
      },
      tags: ['github'],
      execute: async (_args: Record<string, any>, context?: ToolContext) => {
        if (!context?.platform || !context?.senderId) {
          return '❌ 无法获取当前用户信息';
        }
        const db = plugin.root?.inject('database') as any;
        const model = db?.models?.get('github_oauth_users');
        if (!model) return '❌ 数据库未就绪';

        const [existing] = await model.select().where({ platform: context.platform, platform_uid: context.senderId });
        if (!existing) return '📭 你尚未绑定 GitHub 账号\n🔗 使用 github_bind 绑定你的账号';

        // 验证 token 是否仍然有效
        const userGh = new GhClient({ host: adapter.getHost(), token: existing.access_token });
        const auth = await userGh.verifyAuth();
        if (auth.ok) {
          return `👤 已绑定 GitHub 账号: ${auth.user}\n📅 绑定时间: ${new Date(existing.created_at).toLocaleString('zh-CN')}`;
        }
        return `⚠️ 已绑定账号 ${existing.github_login}，但 Token 已失效\n🔗 请执行 github_unbind 后重新 github_bind`;
      },
    },
    // --- Install App ---
    {
      name: 'github_install',
      description: '获取安装 GitHub App 的链接 — 安装后 Bot 可以访问你的仓库，你也可以使用更多功能',
      parameters: {
        type: 'object' as const,
        properties: {},
      },
      tags: ['github'],
      execute: async () => {
        const slug = adapter.getAppSlug();
        if (!slug) return '❌ Bot 未配置 GitHub App';
        const host = adapter.getHost() || 'github.com';
        const installations = adapter.getInstallations();
        let msg = `🔗 请点击以下链接安装 GitHub App 到你的仓库：\n   https://${host}/apps/${slug}/installations/new`;
        if (installations.length) {
          msg += `\n\n📋 当前已安装 (${installations.length}):`;
          for (const inst of installations) {
            msg += `\n  • ${inst.account.login} (${inst.account.type})`;
          }
        }
        return msg;
      },
    },
    // --- Subscribe ---
    {
      name: 'github_subscribe',
      description: '订阅 GitHub 仓库的 Webhook 事件，事件将推送到当前聊天通道',
      parameters: {
        type: 'object' as const,
        properties: {
          repo: { type: 'string' as const, description: 'owner/repo (必填)' },
          events: { type: 'string' as const, description: '要订阅的事件类型，逗号分隔 (push/issue/star/fork/unstar/pull_request)，默认全部' },
        },
        required: ['repo'],
      },
      platforms: ['github'],
      tags: ['github'],
      execute: async (args: Record<string, any>, context?: ToolContext) => {
        if (!context?.platform || !context?.senderId || !context?.sceneId || !context?.botId) {
          return '❌ 无法获取当前聊天通道信息';
        }
        const db = plugin.root?.inject('database') as any;
        const model = db?.models?.get('github_subscriptions');
        if (!model) return '❌ 数据库未就绪';

        const validEvents: EventType[] = ['push', 'issue', 'star', 'fork', 'unstar', 'pull_request'];
        const events: EventType[] = args.events
          ? args.events.split(',').map((s: string) => s.trim()).filter((e: string) => validEvents.includes(e as EventType))
          : validEvents;
        if (!events.length) return `❌ 无效的事件类型，可选: ${validEvents.join(', ')}`;

        const [existing] = await model.select().where({
          repo: args.repo,
          target_id: context.sceneId,
          adapter: context.platform,
          bot: context.botId,
        });
        if (existing) {
          await model.update({ events, target_type: context.scope || 'private' }).where({ id: existing.id });
          return `✅ 已更新订阅 ${args.repo}\n📡 事件: ${events.join(', ')}`;
        }

        await model.insert({
          id: Date.now(),
          repo: args.repo,
          events,
          target_id: context.sceneId,
          target_type: context.scope || 'private',
          adapter: context.platform,
          bot: context.botId,
        });
        return `✅ 已订阅 ${args.repo}\n📡 事件: ${events.join(', ')}\n📌 通知将推送到当前通道`;
      },
    },
    // --- Unsubscribe ---
    {
      name: 'github_unsubscribe',
      description: '取消订阅 GitHub 仓库的 Webhook 事件',
      parameters: {
        type: 'object' as const,
        properties: {
          repo: { type: 'string' as const, description: 'owner/repo (必填)' },
        },
        required: ['repo'],
      },
      platforms: ['github'],
      tags: ['github'],
      execute: async (args: Record<string, any>, context?: ToolContext) => {
        if (!context?.platform || !context?.sceneId || !context?.botId) {
          return '❌ 无法获取当前聊天通道信息';
        }
        const db = plugin.root?.inject('database') as any;
        const model = db?.models?.get('github_subscriptions');
        if (!model) return '❌ 数据库未就绪';

        const [existing] = await model.select().where({
          repo: args.repo,
          target_id: context.sceneId,
          adapter: context.platform,
          bot: context.botId,
        });
        if (!existing) return `📭 当前通道未订阅 ${args.repo}`;

        await model.delete().where({ id: existing.id });
        return `✅ 已取消订阅 ${args.repo}`;
      },
    },
    // --- Subscriptions ---
    {
      name: 'github_subscriptions',
      description: '查看当前聊天通道的 GitHub 仓库订阅列表',
      parameters: {
        type: 'object' as const,
        properties: {},
      },
      platforms: ['github'],
      tags: ['github'],
      execute: async (_args: Record<string, any>, context?: ToolContext) => {
        if (!context?.platform || !context?.sceneId || !context?.botId) {
          return '❌ 无法获取当前聊天通道信息';
        }
        const db = plugin.root?.inject('database') as any;
        const model = db?.models?.get('github_subscriptions');
        if (!model) return '❌ 数据库未就绪';

        const subs = await model.select().where({
          target_id: context.sceneId,
          adapter: context.platform,
          bot: context.botId,
        });
        if (!subs?.length) return '📭 当前通道没有任何 GitHub 订阅';

        return `📋 当前通道订阅 (${subs.length}):\n\n` +
          subs.map((s: any) => {
            const events = Array.isArray(s.events) ? s.events : [];
            return `  📦 ${s.repo}\n     📡 ${events.join(', ') || '(无事件)'}`;
          }).join('\n\n');
      },
    },
  ];

  const disposers = tools.map(t => toolService.addTool(t, plugin.name));
  logger.debug(`GitHub 工具已注册: ${tools.map(t => t.name).join(', ')}`);

  return () => disposers.forEach(d => d());
});

logger.debug('GitHub 适配器已加载 (gh CLI 认证)');
