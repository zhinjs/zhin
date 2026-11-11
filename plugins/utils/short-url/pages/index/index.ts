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
    zh: '通过 is.gd 创建短链接，并查看本次运行期间创建的记录',
    en: 'Create short links through is.gd and review the ones created since this process started',
  },
  stats: [
    {
      key: 'totalCount',
      label: { zh: '短链数量', en: 'Total Links' },
      value: 'totalCount',
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
      ],
    },
    {
      name: 'remove',
      label: { zh: '从列表移除', en: 'Remove From List' },
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
        { key: 'shortUrl', label: { zh: '短链接', en: 'Short URL' } },
        { key: 'url', label: { zh: '原始链接', en: 'URL' } },
        { key: 'createdAt', label: { zh: '创建时间', en: 'Created At' } },
      ] satisfies readonly {
        readonly key: keyof ShortUrlRecord & string;
        readonly label: { readonly zh: string; readonly en: string };
      }[],
    },
  ],
});
