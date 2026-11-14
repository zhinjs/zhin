import { definePage, definePageBlueprint } from '@zhin.js/console-contract';

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
  /** Exact destination; shown by its display name. */
  readonly conversation?: unknown;
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

export default definePageBlueprint<RssConsoleStatus>({
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
      name: 'addSubscription',
      label: { zh: '添加订阅', en: 'Add Subscription' },
      variant: 'primary',
      fields: [
        {
          key: 'url',
          label: { zh: 'RSS 订阅源 URL', en: 'RSS Feed URL' },
          type: 'text',
          required: true,
        },
        {
          key: 'title',
          label: { zh: '订阅名称', en: 'Feed Title' },
          type: 'text',
        },
        {
          // Accounts and recent conversations, with manual entry as an advanced option.
          key: 'conversation',
          label: { zh: '推送到会话', en: 'Deliver to' },
          type: 'conversation',
          required: true,
          hint: {
            zh: '从机器人账号的最近会话中选择；找不到时用「手动填写（高级）」输入群号或用户 ID',
            en: 'Pick one of the bot’s recent conversations, or use “Enter manually (advanced)” for a group or user ID',
          },
        },
      ],
    },
    {
      name: 'removeSubscription',
      label: { zh: '移除订阅', en: 'Remove Subscription' },
      variant: 'danger',
      fields: [
        {
          key: 'url',
          label: { zh: 'RSS 订阅源 URL', en: 'RSS Feed URL' },
          type: 'text',
          required: true,
        },
      ],
    },
    {
      name: 'pollNow',
      label: { zh: '立即轮询', en: 'Poll Now' },
      variant: 'secondary',
    },
    {
      name: 'clean-seen',
      label: { zh: '清理已读缓存', en: 'Clean seen cache' },
      variant: 'ghost',
    },
  ],
  sections: [
    {
      id: 'subscriptions',
      layout: 'table',
      title: { zh: '当前订阅列表', en: 'Active Subscriptions' },
      emptyText: { zh: '暂无 RSS 订阅', en: 'No RSS subscriptions' },
      items: 'subscriptions',
      columns: [
        { key: 'feedTitle', label: { zh: '标题', en: 'Feed Title' } },
        { key: 'url', label: { zh: '订阅地址', en: 'URL' } },
        { key: 'conversation', label: { zh: '推送会话', en: 'Delivers to' }, type: 'conversation' },
        { key: 'createdAt', label: { zh: '创建时间', en: 'Created At' } },
      ],
    },
    {
      id: 'config',
      title: { zh: '配置详情', en: 'Configuration Details' },
      entries: [
        { label: 'pollCron', dataKey: 'pollCron' },
        { label: 'maxItemsPerPoll', dataKey: 'maxItemsPerPoll' },
        { label: 'fetchTimeoutMs', value: { $format: '{0} ms', args: ['fetchTimeoutMs'] } },
      ],
    },
  ],
});
