import { definePage, definePageBlueprint } from '@zhin.js/console-contract';
import type { QrCodeConsoleStatus, QrCodeHistoryItem } from '../../plugin.js';

export const meta = definePage({
  title: '二维码工具',
  titleI18n: { en: 'QR Code' },
  icon: 'QrCode',
  order: 58,
  requiredPermissions: ['qrcode:read'],
});

export default definePageBlueprint<QrCodeConsoleStatus>({
  title: { zh: '二维码工具', en: 'QR Code' },
  description: {
    zh: '在线生成二维码并查看近期生成记录',
    en: 'Generate QR codes online and view recent generation history',
  },
  stats: [
    {
      key: 'recentCount',
      label: { zh: '近期生成数', en: 'Recent Count' },
      value: 'recentCount',
    },
  ],
  actions: [
    {
      name: 'generate',
      label: { zh: '生成二维码', en: 'Generate QR Code' },
      variant: 'primary',
      fields: [
        {
          key: 'text',
          label: { zh: '二维码内容', en: 'QR Content' },
          type: 'text',
          required: true,
        },
        {
          key: 'width',
          label: { zh: '图片尺寸 (px)', en: 'Width (px)' },
          type: 'number',
          defaultValue: '280',
        },
      ],
    },
    {
      name: 'clearHistory',
      label: { zh: '清空记录', en: 'Clear History' },
      variant: 'secondary',
    },
  ],
  sections: [
    {
      id: 'history',
      layout: 'table',
      title: { zh: '最近生成记录', en: 'Recent Generation History' },
      emptyText: { zh: '暂无二维码生成记录', en: 'No QR code generation history' },
      items: 'history',
      columns: [
        { key: 'createdAt', label: { zh: '生成时间', en: 'Created At' } },
        { key: 'content', label: { zh: '内容', en: 'Content' } },
        { key: 'size', label: { zh: '尺寸', en: 'Size' } },
      ] satisfies readonly {
        readonly key: keyof QrCodeHistoryItem & string;
        readonly label: { readonly zh: string; readonly en: string };
      }[],
    },
  ],
});
