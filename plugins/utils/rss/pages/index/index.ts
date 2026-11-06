import { definePage } from '@zhin.js/console-contract';
import { createDeclarativePage } from '@zhin.js/client';

export interface RssSubscriptionItem {
  readonly id: string;
  readonly feedTitle: string;
  readonly url: string;
  readonly adapterName: string;
  readonly endpointId: string;
  readonly channelType: string;
  readonly channelId: string;
  readonly creatorName: string;
  readonly createdAt: string;
  readonly [key: string]: unknown;
}

export interface RssConsoleStatus {
  readonly subscriptionCount: number;
  readonly pollCron: string;
  readonly maxItemsPerPoll: number;
  readonly fetchTimeoutMs: number;
  readonly subscriptions: readonly RssSubscriptionItem[];
}

export const meta = definePage({
  title: 'RSS 订阅',
  titleI18n: { en: 'RSS Subscriptions' },
  icon: 'Rss',
  order: 52,
  requiredPermissions: ['rss:read'],
});

export default createDeclarativePage<RssConsoleStatus>({
  title: { zh: 'RSS 订阅', en: 'RSS Subscriptions' },
  description: {
    zh: '管理 RSS/Atom 订阅源、轮询频率与已读缓存',
    en: 'Manage RSS/Atom feed subscriptions, polling schedule, and seen cache',
  },
  stats: [
    {
      key: 'subscriptionCount',
      label: { zh: '订阅数量', en: 'Subscriptions' },
      value: 'subscriptionCount',
    },
    {
      key: 'pollCron',
      label: { zh: '轮询 Cron', en: 'Poll Cron' },
      value: 'pollCron',
    },
    {
      key: 'maxItemsPerPoll',
      label: { zh: '单次最大推送', en: 'Max Items / Poll' },
      value: 'maxItemsPerPoll',
    },
  ],
  actions: [
    {
      name: 'poll-now',
      label: { zh: '立即轮询', en: 'Poll now' },
      variant: 'primary',
    },
    {
      name: 'clean-seen',
      label: { zh: '清理已读缓存', en: 'Clean seen cache' },
      variant: 'secondary',
    },
  ],
  sections: [
    {
      id: 'subscriptions',
      title: { zh: '当前订阅列表', en: 'Active Subscriptions' },
      emptyText: { zh: '暂无 RSS 订阅', en: 'No RSS subscriptions' },
      items: 'subscriptions',
      columns: [
        { key: 'feedTitle', label: { zh: '标题', en: 'Feed Title' } },
        { key: 'url', label: { zh: '订阅地址', en: 'URL' } },
        { key: 'adapterName', label: { zh: '适配器', en: 'Adapter' } },
        { key: 'channelId', label: { zh: '会话 ID', en: 'Channel ID' } },
        { key: 'createdAt', label: { zh: '创建时间', en: 'Created At' } },
      ],
    },
    {
      id: 'config',
      title: { zh: '配置详情', en: 'Configuration Details' },
      entries: (data) => ({
        pollCron: data.pollCron,
        maxItemsPerPoll: String(data.maxItemsPerPoll),
        fetchTimeoutMs: `${data.fetchTimeoutMs} ms`,
      }),
    },
  ],
});
