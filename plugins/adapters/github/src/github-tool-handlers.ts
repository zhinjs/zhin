import { formatCompact, type Message } from 'zhin.js';
import { getCurrentCommMessage } from '@zhin.js/agent/security';
import { GhClient } from './gh-client.js';
import type { EventType } from './types.js';
import { getAdapter, getGithubAgentDeps } from './github-agent-deps.js';

function oauthModel() {
  const db = getGithubAgentDeps().plugin.root?.inject('database') as any;
  return db?.models?.get('github_oauth_users') as {
    select: () => { where: (q: object) => Promise<any[]> };
    insert: (row: object) => Promise<void>;
    delete: () => { where: (q: object) => Promise<void> };
  } | undefined;
}

function subscriptionsModel() {
  const db = getGithubAgentDeps().plugin.root?.inject('database') as any;
  return db?.models?.get('github_subscriptions') as {
    select: () => { where: (q: object) => Promise<any[]> };
    insert: (row: object) => Promise<void>;
    update: (row: object) => { where: (q: object) => Promise<void> };
    delete: () => { where: (q: object) => Promise<void> };
  } | undefined;
}

export async function executeGithubStar(args: { action: 'star' | 'unstar' | 'check'; repo: string }, commMessage?: Message) {
  const adapter = getAdapter();
  const msg = commMessage ?? getCurrentCommMessage();
  const gh = await adapter.getUserOrDefaultAPI(msg?.$adapter, msg?.$sender.id);
  if (!gh) return '❌ 没有可用的 GitHub bot';
  switch (args.action) {
    case 'star': {
      const r = await gh.starRepo(args.repo);
      return r.ok ? `⭐ 已 Star ${args.repo}` : `❌ ${r.data?.message || JSON.stringify(r.data)}`;
    }
    case 'unstar': {
      const r = await gh.unstarRepo(args.repo);
      return r.ok ? `💔 已取消 Star ${args.repo}` : `❌ ${r.data?.message || JSON.stringify(r.data)}`;
    }
    case 'check': {
      const starred = await gh.isStarred(args.repo);
      return starred ? `⭐ 已 Star ${args.repo}` : `☆ 尚未 Star ${args.repo}`;
    }
    default:
      return `❌ 未知操作: ${args.action}`;
  }
}

export async function executeGithubBind(_args: Record<string, never>, commMessage?: Message) {
  const adapter = getAdapter();
  const { plugin } = getGithubAgentDeps();
  const msg = commMessage ?? getCurrentCommMessage();
  if (!msg?.$adapter || !msg?.$sender?.id) return '❌ 无法获取当前用户信息';

  const clientId = adapter.getClientId();
  if (!clientId) return '❌ Endpoint 未配置 GitHub App 或 App 无 client_id，无法进行账号绑定';

  const model = oauthModel();
  if (!model) return '❌ 数据库未就绪';

  const [existing] = await model.select().where({ platform: msg.$adapter, platform_uid: msg.$sender.id });
  if (existing) {
    return `⚠️ 你已绑定 GitHub 账号: ${existing.github_login}\n如需重新绑定，请先执行 github_unbind`;
  }

  try {
    const host = adapter.getHost();
    const codeResp = await GhClient.deviceFlowRequestCode(clientId, host);
    const tokenPromise = GhClient.deviceFlowPollToken(
      clientId, codeResp.device_code, codeResp.interval, codeResp.expires_in, host,
    );

    const replyMsg = [
      '🔗 请在浏览器中打开以下链接进行授权：',
      `   ${codeResp.verification_uri}`,
      '',
      `📋 输入验证码: **${codeResp.user_code}**`,
      '',
      `⏳ 等待授权中…（${Math.floor(codeResp.expires_in / 60)} 分钟内有效）`,
    ].join('\n');

    tokenPromise.then(async (tokenData) => {
      if (!tokenData) {
        plugin.logger.warn(formatCompact({ op: 'device_flow', ok: false, platform: msg.$adapter, sender: msg.$sender.id }));
        return;
      }

      const userGh = new GhClient({ host, token: tokenData.access_token });
      const authResult = await userGh.verifyAuth();
      const login = authResult.ok ? authResult.user : 'unknown';

      await model.insert({
        id: Date.now(),
        platform: msg.$adapter,
        platform_uid: msg.$sender.id,
        github_login: login,
        access_token: tokenData.access_token,
        created_at: Date.now(),
      });
      plugin.logger.debug(formatCompact({ op: 'bind', platform: msg.$adapter, sender: msg.$sender.id, login }));

      if (msg?.$reply) {
        await msg.$reply(`✅ GitHub 账号绑定成功！\n👤 ${login}`);
      }
    }).catch((err) => {
      plugin.logger.error('GitHub Device Flow 错误:', err);
    });

    return replyMsg;
  } catch (e: unknown) {
    return `❌ Device Flow 启动失败: ${e instanceof Error ? e.message : String(e)}`;
  }
}

export async function executeGithubUnbind(_args: Record<string, never>, commMessage?: Message) {
  const msg = commMessage ?? getCurrentCommMessage();
  if (!msg?.$adapter || !msg?.$sender?.id) return '❌ 无法获取当前用户信息';

  const model = oauthModel();
  if (!model) return '❌ 数据库未就绪';

  const [existing] = await model.select().where({ platform: msg.$adapter, platform_uid: msg.$sender.id });
  if (!existing) return '📭 你尚未绑定 GitHub 账号';

  await model.delete().where({ id: existing.id });
  return `✅ 已解除 GitHub 账号绑定: ${existing.github_login}`;
}

export async function executeGithubWhoami(_args: Record<string, never>, commMessage?: Message) {
  const adapter = getAdapter();
  const msg = commMessage ?? getCurrentCommMessage();
  if (!msg?.$adapter || !msg?.$sender?.id) return '❌ 无法获取当前用户信息';

  const model = oauthModel();
  if (!model) return '❌ 数据库未就绪';

  const [existing] = await model.select().where({ platform: msg.$adapter, platform_uid: msg.$sender.id });
  if (!existing) return '📭 你尚未绑定 GitHub 账号\n🔗 使用 github_bind 绑定你的账号';

  const userGh = new GhClient({ host: adapter.getHost(), token: existing.access_token });
  const auth = await userGh.verifyAuth();
  if (auth.ok) {
    return `👤 已绑定 GitHub 账号: ${auth.user}\n📅 绑定时间: ${new Date(existing.created_at).toLocaleString('zh-CN')}`;
  }
  return `⚠️ 已绑定账号 ${existing.github_login}，但 Token 已失效\n🔗 请执行 github_unbind 后重新 github_bind`;
}

export async function executeGithubInstall() {
  const adapter = getAdapter();
  const slug = adapter.getAppSlug();
  if (!slug) return '❌ Endpoint 未配置 GitHub App';
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
}

export async function executeGithubSubscribe(args: { repo: string; events?: string }, commMessage?: Message) {
  const msg = commMessage ?? getCurrentCommMessage();
  if (!msg?.$adapter || !msg?.$sender.id || !msg?.$channel?.id || !msg?.$endpoint) {
    return '❌ 无法获取当前聊天通道信息';
  }

  const model = subscriptionsModel();
  if (!model) return '❌ 数据库未就绪';

  const validEvents: EventType[] = ['push', 'issue', 'star', 'fork', 'unstar', 'pull_request'];
  const events: EventType[] = args.events
    ? args.events.split(',').map((s) => s.trim()).filter((e): e is EventType => validEvents.includes(e as EventType))
    : validEvents;
  if (!events.length) return `❌ 无效的事件类型，可选: ${validEvents.join(', ')}`;

  const [existing] = await model.select().where({
    repo: args.repo,
    target_id: msg.$channel?.id,
    adapter: msg.$adapter,
    endpoint: msg.$endpoint,
  });
  if (existing) {
    await model.update({ events, target_type: msg.$channel?.type || 'private' }).where({ id: existing.id });
    return `✅ 已更新订阅 ${args.repo}\n📡 事件: ${events.join(', ')}`;
  }

  await model.insert({
    id: Date.now(),
    repo: args.repo,
    events,
    target_id: msg.$channel?.id,
    target_type: msg.$channel?.type || 'private',
    adapter: msg.$adapter,
    endpoint: msg.$endpoint,
  });
  return `✅ 已订阅 ${args.repo}\n📡 事件: ${events.join(', ')}\n📌 通知将推送到当前通道`;
}

export async function executeGithubUnsubscribe(args: { repo: string }, commMessage?: Message) {
  const msg = commMessage ?? getCurrentCommMessage();
  if (!msg?.$adapter || !msg?.$channel?.id || !msg?.$endpoint) {
    return '❌ 无法获取当前聊天通道信息';
  }

  const model = subscriptionsModel();
  if (!model) return '❌ 数据库未就绪';

  const [existing] = await model.select().where({
    repo: args.repo,
    target_id: msg.$channel?.id,
    adapter: msg.$adapter,
    endpoint: msg.$endpoint,
  });
  if (!existing) return `📭 当前通道未订阅 ${args.repo}`;

  await model.delete().where({ id: existing.id });
  return `✅ 已取消订阅 ${args.repo}`;
}

export async function executeGithubSubscriptions(_args: Record<string, never>, commMessage?: Message) {
  const msg = commMessage ?? getCurrentCommMessage();
  if (!msg?.$adapter || !msg?.$channel?.id || !msg?.$endpoint) {
    return '❌ 无法获取当前聊天通道信息';
  }

  const model = subscriptionsModel();
  if (!model) return '❌ 数据库未就绪';

  const subs = await model.select().where({
    target_id: msg.$channel?.id,
    adapter: msg.$adapter,
    endpoint: msg.$endpoint,
  });
  if (!subs?.length) return '📭 当前通道没有任何 GitHub 订阅';

  return `📋 当前通道订阅 (${subs.length}):\n\n` +
    subs.map((s: any) => {
      const events = Array.isArray(s.events) ? s.events : [];
      return `  📦 ${s.repo}\n     📡 ${events.join(', ') || '(无事件)'}`;
    }).join('\n\n');
}
