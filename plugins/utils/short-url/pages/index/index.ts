import { definePage, definePageBlueprint } from '@zhin.js/console-contract';
import type { ShortUrlConsoleStatus, ShortUrlRecord } from '../../plugin.js';

export const meta = definePage({
  title: '短链服务',
  titleI18n: { en: 'Short URL' },
  icon: 'Link',
  order: 59,
  requiredPermissions: ['short-url:read'],
});

export default definePageBlueprint<ShortUrlConsoleStatus>({
  title: { zh: '短链服务', en: 'Short URL' },
  description: {
    zh: '在线创建、管理短链接并查看近期访问与生成记录',
    en: 'Create and manage short links and inspect recent link records',
  },
  stats: [
    {
      key: 'totalCount',
      label: { zh: '短链数量', en: 'Total Links' },
      value: 'totalCount',
    },
    {
      key: 'totalClicks',
      label: { zh: '累计点击', en: 'Total Clicks' },
      value: 'totalClicks',
    },
  ],
  actions: [
    {
      name: 'create',
      label: { zh: '创建短链', en: 'Create Short URL' },
      variant: 'primary',
      fields: [
        {
          key: 'url',
          label: { zh: '原始链接 URL', en: 'Target URL' },
          type: 'text',
          required: true,
        },
        {
          key: 'code',
          label: { zh: '自定义短码 (可选)', en: 'Custom Code (Optional)' },
          type: 'text',
        },
      ],
    },
    {
      name: 'remove',
      label: { zh: '删除短链', en: 'Remove Short URL' },
      variant: 'danger',
      fields: [
        {
          key: 'code',
          label: { zh: '短链编码', en: 'Short Code' },
          type: 'text',
          required: true,
        },
      ],
    },
  ],
  sections: [
    {
      id: 'items',
      layout: 'table',
      rowKey: 'code',
      title: { zh: '近期短链记录', en: 'Recent Short Links' },
      emptyText: { zh: '暂无短链记录', en: 'No short link records yet' },
      items: 'items',
      columns: [
        { key: 'code', label: { zh: '短码', en: 'Code' } },
        { key: 'url', label: { zh: '原始链接', en: 'URL' } },
        { key: 'clicks', label: { zh: '点击量', en: 'Clicks' } },
        { key: 'createdAt', label: { zh: '创建时间', en: 'Created At' } },
      ] satisfies readonly {
        readonly key: keyof ShortUrlRecord & string;
        readonly label: { readonly zh: string; readonly en: string };
      }[],
    },
  ],
});
