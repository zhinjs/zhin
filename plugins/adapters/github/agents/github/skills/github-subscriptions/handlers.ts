import { createMessages, resolveLocale, type Locale } from 'zhin.js/i18n';
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

export async function executeGithubStar(args: { action: 'star' | 'unstar' | 'check'; repo: string }, client: GithubClient, commMessage?: Message, preference?: Locale) {
  const msg = commMessage ?? getCurrentCommMessage();
  const locale = resolveLocale(preference ?? msg?.locale);
  const gh = await client.getUserOrDefaultApi(msg?.clientAdapter, msg?.sender?.id);
  switch (args.action) {
    case 'star': {
      const r = await gh.starRepo(args.repo);
      return r.ok ? t(locale, 'starred', { repo: args.repo }) : `❌ ${r.data?.message || JSON.stringify(r.data)}`;
    }
    case 'unstar': {
      const r = await gh.unstarRepo(args.repo);
      return r.ok ? t(locale, 'unstarred', { repo: args.repo }) : `❌ ${r.data?.message || JSON.stringify(r.data)}`;
    }
    case 'check': {
      const starred = await gh.isStarred(args.repo);
      return starred ? t(locale, 'starred', { repo: args.repo }) : t(locale, 'notStarred', { repo: args.repo });
    }
    default:
      return t(locale, 'unknownAction', { action: args.action });
  }
}

export async function executeGithubSubscribe(args: { repo: string; events?: string }, client: GithubClient, commMessage?: Message, preference?: Locale) {
  const msg = commMessage ?? getCurrentCommMessage();
  const locale = resolveLocale(preference ?? msg?.locale);
  if (!msg?.clientAdapter || !msg?.sender?.id || !msg?.conversation.id || !msg?.endpointId) {
    return t(locale, 'missingChannel');
  }

  const model = subscriptionsModel(client);
  if (!model) return t(locale, 'databaseNotReady');

  const validEvents: EventType[] = ['push', 'issue', 'star', 'fork', 'unstar', 'pull_request'];
  const events: EventType[] = args.events
    ? args.events.split(',').map((s) => s.trim()).filter((e): e is EventType => validEvents.includes(e as EventType))
    : validEvents;
  if (!events.length) return t(locale, 'invalidEvents', { events: validEvents.join(', ') });

  const [existing] = await model.select().where({
    repo: args.repo,
    target_id: msg.conversation.id,
    adapter: msg.clientAdapter,
    endpoint: msg.endpointId,
  });
  if (existing) {
    await model.update({ events, target_type: msg.conversation.kind || 'private' }).where({ id: existing.id });
    return t(locale, 'updated', { repo: args.repo, events: events.join(', ') });
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
  return t(locale, 'subscribed', { repo: args.repo, events: events.join(', ') });
}

export async function executeGithubUnsubscribe(args: { repo: string }, client: GithubClient, commMessage?: Message, preference?: Locale) {
  const msg = commMessage ?? getCurrentCommMessage();
  const locale = resolveLocale(preference ?? msg?.locale);
  if (!msg?.clientAdapter || !msg?.conversation.id || !msg?.endpointId) {
    return t(locale, 'missingChannel');
  }

  const model = subscriptionsModel(client);
  if (!model) return t(locale, 'databaseNotReady');

  const [existing] = await model.select().where({
    repo: args.repo,
    target_id: msg.conversation.id,
    adapter: msg.clientAdapter,
    endpoint: msg.endpointId,
  });
  if (!existing) return t(locale, 'notSubscribed', { repo: args.repo });

  await model.delete().where({ id: existing.id });
  return t(locale, 'unsubscribed', { repo: args.repo });
}

export async function executeGithubSubscriptions(_args: Record<string, never>, client: GithubClient, commMessage?: Message, preference?: Locale) {
  const msg = commMessage ?? getCurrentCommMessage();
  const locale = resolveLocale(preference ?? msg?.locale);
  if (!msg?.clientAdapter || !msg?.conversation.id || !msg?.endpointId) {
    return t(locale, 'missingChannel');
  }

  const model = subscriptionsModel(client);
  if (!model) return t(locale, 'databaseNotReady');

  const subs = await model.select().where({
    target_id: msg.conversation.id,
    adapter: msg.clientAdapter,
    endpoint: msg.endpointId,
  });
  if (!subs?.length) return t(locale, 'empty');

  return t(locale, 'list', { count: subs.length }) +
    subs.map((s: any) => {
      const events = Array.isArray(s.events) ? s.events : [];
      return `  📦 ${s.repo}\n     📡 ${events.join(', ') || t(locale, 'noEvents')}`;
    }).join('\n\n');
}

const t = createMessages({
  "starred": {
    "zh-CN": "⭐ 已 Star {repo}",
    "en": "⭐ Starred: {repo}"
  },
  "unstarred": {
    "zh-CN": "💔 已取消 Star {repo}",
    "en": "💔 Unstarred: {repo}"
  },
  "notStarred": {
    "zh-CN": "☆ 尚未 Star {repo}",
    "en": "☆ Not starred: {repo}"
  },
  "unknownAction": {
    "zh-CN": "❌ 未知操作: {action}",
    "en": "❌ Unknown action: {action}"
  },
  "missingChannel": {
    "zh-CN": "❌ 无法获取当前聊天通道信息",
    "en": "❌ Current chat channel is unavailable"
  },
  "databaseNotReady": {
    "zh-CN": "❌ 数据库未就绪",
    "en": "❌ Database is not ready"
  },
  "invalidEvents": {
    "zh-CN": "❌ 无效的事件类型，可选: {events}",
    "en": "❌ Invalid event types. Available: {events}"
  },
  "updated": {
    "zh-CN": "✅ 已更新订阅 {repo}\n📡 事件: {events}",
    "en": "✅ Subscription updated: {repo}\n📡 Events: {events}"
  },
  "subscribed": {
    "zh-CN": "✅ 已订阅 {repo}\n📡 事件: {events}\n📌 通知将推送到当前通道",
    "en": "✅ Subscribed to {repo}\n📡 Events: {events}\n📌 Notifications will be sent to this channel"
  },
  "notSubscribed": {
    "zh-CN": "📭 当前通道未订阅 {repo}",
    "en": "📭 This channel is not subscribed to {repo}"
  },
  "unsubscribed": {
    "zh-CN": "✅ 已取消订阅 {repo}",
    "en": "✅ Unsubscribed from {repo}"
  },
  "empty": {
    "zh-CN": "📭 当前通道没有任何 GitHub 订阅",
    "en": "📭 This channel has no GitHub subscriptions"
  },
  "list": {
    "zh-CN": "📋 当前通道订阅 ({count}):\n\n",
    "en": "📋 Channel subscriptions ({count}):\n\n"
  },
  "noEvents": {
    "zh-CN": "(无事件)",
    "en": "(no events)"
  }
});
