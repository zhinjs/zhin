import type { Message } from 'zhin.js';
import { getCurrentCommMessage } from '@zhin.js/agent/security';
import type { GithubClient } from '../../../../src/client.js';
import type { EventType } from '../../../../src/types.js';

function subscriptionsModel(client: GithubClient) {
  const db = client.database as {
    models?: Map<string, unknown>;
  } | null | undefined;
  return db?.models?.get('github_subscriptions') as {
    select: () => { where: (q: object) => Promise<any[]> };
    insert: (row: object) => Promise<void>;
    update: (row: object) => { where: (q: object) => Promise<void> };
    delete: () => { where: (q: object) => Promise<void> };
  } | undefined;
}

export async function executeGithubStar(args: { action: 'star' | 'unstar' | 'check'; repo: string }, client: GithubClient, commMessage?: Message) {
  const msg = commMessage ?? getCurrentCommMessage();
  const gh = await client.getUserOrDefaultApi(msg?.clientAdapter, msg?.sender?.id);
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

export async function executeGithubSubscribe(args: { repo: string; events?: string }, client: GithubClient, commMessage?: Message) {
  const msg = commMessage ?? getCurrentCommMessage();
  if (!msg?.clientAdapter || !msg?.sender?.id || !msg?.conversation.id || !msg?.endpointId) {
    return '❌ 无法获取当前聊天通道信息';
  }

  const model = subscriptionsModel(client);
  if (!model) return '❌ 数据库未就绪';

  const validEvents: EventType[] = ['push', 'issue', 'star', 'fork', 'unstar', 'pull_request'];
  const events: EventType[] = args.events
    ? args.events.split(',').map((s) => s.trim()).filter((e): e is EventType => validEvents.includes(e as EventType))
    : validEvents;
  if (!events.length) return `❌ 无效的事件类型，可选: ${validEvents.join(', ')}`;

  const [existing] = await model.select().where({
    repo: args.repo,
    target_id: msg.conversation.id,
    adapter: msg.clientAdapter,
    endpoint: msg.endpointId,
  });
  if (existing) {
    await model.update({ events, target_type: msg.conversation.kind || 'private' }).where({ id: existing.id });
    return `✅ 已更新订阅 ${args.repo}\n📡 事件: ${events.join(', ')}`;
  }

  await model.insert({
    id: Date.now(),
    repo: args.repo,
    events,
    target_id: msg.conversation.id,
    target_type: msg.conversation.kind || 'private',
    adapter: msg.clientAdapter,
    endpoint: msg.endpointId,
  });
  return `✅ 已订阅 ${args.repo}\n📡 事件: ${events.join(', ')}\n📌 通知将推送到当前通道`;
}

export async function executeGithubUnsubscribe(args: { repo: string }, client: GithubClient, commMessage?: Message) {
  const msg = commMessage ?? getCurrentCommMessage();
  if (!msg?.clientAdapter || !msg?.conversation.id || !msg?.endpointId) {
    return '❌ 无法获取当前聊天通道信息';
  }

  const model = subscriptionsModel(client);
  if (!model) return '❌ 数据库未就绪';

  const [existing] = await model.select().where({
    repo: args.repo,
    target_id: msg.conversation.id,
    adapter: msg.clientAdapter,
    endpoint: msg.endpointId,
  });
  if (!existing) return `📭 当前通道未订阅 ${args.repo}`;

  await model.delete().where({ id: existing.id });
  return `✅ 已取消订阅 ${args.repo}`;
}

export async function executeGithubSubscriptions(_args: Record<string, never>, client: GithubClient, commMessage?: Message) {
  const msg = commMessage ?? getCurrentCommMessage();
  if (!msg?.clientAdapter || !msg?.conversation.id || !msg?.endpointId) {
    return '❌ 无法获取当前聊天通道信息';
  }

  const model = subscriptionsModel(client);
  if (!model) return '❌ 数据库未就绪';

  const subs = await model.select().where({
    target_id: msg.conversation.id,
    adapter: msg.clientAdapter,
    endpoint: msg.endpointId,
  });
  if (!subs?.length) return '📭 当前通道没有任何 GitHub 订阅';

  return `📋 当前通道订阅 (${subs.length}):\n\n` +
    subs.map((s: any) => {
      const events = Array.isArray(s.events) ? s.events : [];
      return `  📦 ${s.repo}\n     📡 ${events.join(', ') || '(无事件)'}`;
    }).join('\n\n');
}
