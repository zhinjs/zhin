import { definePage, createDeclarativePage } from '@zhin.js/console-contract';
import type { LedgerConsoleSnapshot, LedgerConsoleSubscriber } from '../../src/service.js';

export const meta = definePage({
  title: '记账本',
  titleI18n: { en: 'Ledger' },
  icon: 'Wallet',
  order: 50,
  requiredPermissions: ['ledger:read'],
});

export default createDeclarativePage<LedgerConsoleSnapshot>({
  title: { zh: '记账本', en: 'Ledger' },
  description: {
    zh: '个人记账日报订阅状态与运行配置概览。',
    en: 'Personal expense ledger daily report subscriptions and runtime configuration.',
  },
  stats: [
    {
      key: 'subscriberCount',
      label: { zh: '日报订阅数', en: 'Report Subscribers' },
      value: 'subscriberCount',
    },
    {
      key: 'reportTime',
      label: { zh: '日报发送时间', en: 'Report Time' },
      value: 'reportTime',
    },
    {
      key: 'timezone',
      label: { zh: '统计时区', en: 'Timezone' },
      value: 'timezone',
    },
  ],
  actions: [
    {
      name: 'run-daily-reports',
      label: { zh: '执行日报发送', en: 'Run Daily Reports' },
      variant: 'primary',
    },
  ],
  sections: [
    {
      id: 'subscribers',
      title: { zh: '日报订阅用户', en: 'Daily Report Subscribers' },
      emptyText: { zh: '暂无开启记账日报的用户', en: 'No users have enabled daily reports.' },
      items: 'subscribers',
      columns: [
        { key: 'ownerKey', label: { zh: '用户标识', en: 'Owner Key' } },
        { key: 'reportLocale', label: { zh: '语言', en: 'Locale' } },
        { key: 'lastReportDate', label: { zh: '最近发送日期', en: 'Last Report Date' } },
      ] satisfies readonly { readonly key: keyof LedgerConsoleSubscriber & string; readonly label: { readonly zh: string; readonly en: string } }[],
    },
    {
      id: 'config',
      title: { zh: '配置详情', en: 'Configuration' },
      entries: (data) => [
        { label: 'Timezone', value: data.timezone },
        { label: 'Report Time', value: data.reportTime },
        { label: 'Report When Empty', value: data.reportWhenEmpty ? 'Yes' : 'No' },
      ],
    },
  ],
});
